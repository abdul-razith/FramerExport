import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export const FIXTURE_ROOT = path.resolve(import.meta.dirname);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** Static server with extensionless routes (`/about` → about.html). `failRoutes` return HTTP 500. */
export async function serveFixture(
  root: string,
  failRoutes: string[] = []
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (failRoutes.includes(pathname.replace(/\/$/, '') || '/')) {
      res.writeHead(500).end('fixture failure');
      return;
    }
    const candidates =
      pathname === '/'
        ? ['index.html']
        : [pathname.slice(1), pathname.slice(1).replace(/\/$/, '') + '.html'];
    for (const candidate of candidates) {
      const file = path.join(root, candidate);
      if (!file.startsWith(root)) break;
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
        return;
      } catch {}
    }
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
