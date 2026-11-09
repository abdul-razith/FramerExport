import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import puppeteer from 'puppeteer';
import { settlePage } from './capture.js';
import { BREAKPOINTS, CAPTURE_WIDTHS, type Breakpoint, type ConversionContext } from './model.js';

function padTo(img: PNG, width: number, height: number): Buffer {
  if (img.width === width && img.height === height) return img.data;
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, width), Math.min(img.height, height), 0, 0);
  return out.data;
}

/** 1 − (differing pixels / total pixels); the smaller image is padded with white. */
export function compareScreenshots(a: string, b: string): number {
  const imgA = PNG.sync.read(fs.readFileSync(a));
  const imgB = PNG.sync.read(fs.readFileSync(b));
  const width = Math.max(imgA.width, imgB.width);
  const height = Math.max(imgA.height, imgB.height);
  const diff = pixelmatch(padTo(imgA, width, height), padTo(imgB, width, height), undefined, width, height, {
    threshold: 0.1,
  });
  return 1 - diff / (width * height);
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => {
      killTree(child);
      output += `\n[timed out after ${timeoutMs / 1000}s]`;
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const tail = (s: string, lines = 200) => s.split('\n').slice(-lines).join('\n');

const slug = (route: string) => (route === '/' ? 'index' : route.slice(1).replace(/\//g, '_'));

/** npm install + build, then screenshot every route at 3 widths and score it against the originals. */
export async function verifyProject(
  nextDir: string,
  pages: { route: string; screenshots: Record<Breakpoint, string> }[],
  ctx: ConversionContext
): Promise<void> {
  ctx.log('Installing dependencies of the generated project...');
  const install = await run('npm', ['install', '--no-audit', '--no-fund'], nextDir, 600000);
  if (!install.ok) {
    ctx.report.build = { ok: false, output: tail(install.output) };
    return;
  }
  ctx.log('Building the generated project...');
  const build = await run('npm', ['run', 'build'], nextDir, 600000);
  ctx.report.build = { ok: build.ok, ...(build.ok ? {} : { output: tail(build.output) }) };
  if (!build.ok) return;

  const port = await freePort();
  const server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: nextDir,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    if (!(await waitForHttp(base + '/', 60000))) throw new Error('next start did not respond');
    const shotDir = path.join(ctx.cacheDir, 'verify');
    await fsp.mkdir(shotDir, { recursive: true });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument('globalThis.__name = (fn) => fn;');
    for (const { route, screenshots } of pages) {
      for (const bp of BREAKPOINTS) {
        if (!screenshots[bp] || !fs.existsSync(screenshots[bp])) continue;
        await page.setViewport({ width: CAPTURE_WIDTHS[bp], height: 900 });
        await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 30000 });
        await settlePage(page);
        const shot = path.join(shotDir, `${slug(route)}-${bp}.png`);
        await page.screenshot({ path: shot as `${string}.png`, fullPage: true });
        ctx.report.similarity.push({ route, width: CAPTURE_WIDTHS[bp], score: compareScreenshots(screenshots[bp], shot) });
      }
    }
  } finally {
    await browser.close();
    killTree(server);
  }
}
