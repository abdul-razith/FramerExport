import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { runConvertCommand } from '../../src/convert/index.js';
import { loadState } from '../../src/convert/state.js';
import { npmCommand, spawnManaged, stopAllManaged } from '../../src/convert/verify/proc.js';

// Full conversion of the fixture, then a real `npm install` + `npm run build` (+ lint) of the generated
// Next.js project. Needs network access and several minutes, so it only runs with FEXPORT_E2E=1.
const enabled = process.env.FEXPORT_E2E === '1';
const fixture = path.resolve('tests/fixtures/framer-nudge-mini');
const TEN_MINUTES = 10 * 60_000;
const tmps: string[] = [];

after(async () => {
  await stopAllManaged();
  if (!process.env.KEEP_E2E_TMP) for (const d of tmps) await rm(d, { recursive: true, force: true }).catch(() => {});
});

/** Run npm with an argument array in `cwd`; resolves with the exit code and the combined output tail. */
async function npm(args: string[], cwd: string): Promise<{ code: number | null; output: string }> {
  const proc = spawnManaged(npmCommand, args, { cwd });
  let output = '';
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-20_000);
  };
  proc.child.stdout?.on('data', collect);
  proc.child.stderr?.on('data', collect);
  let timer: NodeJS.Timeout | undefined;
  const code = await Promise.race([
    new Promise<number | null>((resolve) => {
      proc.child.once('exit', (c) => resolve(c));
      proc.child.once('error', (e) => {
        output += `\n${e.message}`;
        resolve(null);
      });
    }),
    new Promise<number | null>((resolve) => {
      timer = setTimeout(() => {
        output += `\nnpm ${args.join(' ')} timed out after ${TEN_MINUTES} ms`;
        void proc.stop().then(() => resolve(null));
      }, TEN_MINUTES);
    }),
  ]);
  clearTimeout(timer);
  return { code, output };
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

test(
  'convert the fixture, then npm install, build and lint the generated project',
  { skip: enabled ? false : 'set FEXPORT_E2E=1 to run', timeout: 4 * TEN_MINUTES },
  async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'fexport e2e '));
    tmps.push(tmp);
    const nextDir = path.join(tmp, 'nudge next');
    const lines: string[] = [];
    const io = { log: (m: string) => lines.push(m), error: (m: string) => lines.push(`ERR ${m}`) };

    const exit = await runConvertCommand([fixture, nextDir, '--yes'], io);
    assert.equal(exit, 0, lines.join('\n'));

    const animations = JSON.parse(await readFile(path.join(nextDir, '.convert', 'analysis', 'animations.json'), 'utf8'));
    assert.ok(Array.isArray(animations), 'animations.json is a JSON array');

    const state = await loadState(nextDir);
    assert.equal(state?.stages.scaffold, 'done');
    assert.equal(state?.stages.tasks, 'needs-ai');

    const install = await npm(['install', '--no-audit', '--no-fund'], nextDir);
    assert.equal(install.code, 0, install.output);

    const build = await npm(['run', 'build'], nextDir);
    assert.equal(build.code, 0, build.output);

    const lint = await npm(['run', 'lint'], nextDir);
    assert.equal(lint.code, 0, lint.output);

    // `next build` must not have rewritten the scaffolded tsconfig (that would read as a user edit).
    const tsconfig = await readFile(path.join(nextDir, 'tsconfig.json'), 'utf8');
    assert.equal(sha256(tsconfig), state?.fileHashes['tsconfig.json']);
  },
);
