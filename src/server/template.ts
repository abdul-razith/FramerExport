export const SERVE_SCRIPT: string = `#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html':      'text/html; charset=utf-8',
  '.css':       'text/css; charset=utf-8',
  '.js':        'application/javascript; charset=utf-8',
  '.mjs':       'application/javascript; charset=utf-8',
  '.json':      'application/json; charset=utf-8',
  '.png':       'image/png',
  '.jpg':       'image/jpeg',
  '.jpeg':      'image/jpeg',
  '.gif':       'image/gif',
  '.svg':       'image/svg+xml',
  '.webp':      'image/webp',
  '.avif':      'image/avif',
  '.ico':       'image/x-icon',
  '.woff':      'font/woff',
  '.woff2':     'font/woff2',
  '.ttf':       'font/ttf',
  '.otf':       'font/otf',
  '.mp4':       'video/mp4',
  '.webm':      'video/webm',
  '.ogg':       'video/ogg',
  '.mp3':       'audio/mpeg',
  '.framercms': 'application/octet-stream',
};

function sniffImageMime(pathToFile, fallbackMime) {
  try {
    const fd = fs.openSync(pathToFile, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf.length >= 12) {
      const box = buf.toString('latin1', 4, 12);
      if (box === 'ftypavif' || box === 'ftypavis') return 'image/avif';
      if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
      if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
    }
  } catch {}
  return fallbackMime;
}


const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';

  const cleanUrl = url.replace(/^(?:\\/?\\.\\.)+(?=\\/(?:assets|styles|scripts|data|subpages)\\/)/, '');
  let filePath = path.join(ROOT, cleanUrl);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const serveFile = (pathToFile, onMissing) => {
    fs.stat(pathToFile, (err, stats) => {
      if (err || !stats.isFile()) {
        if (onMissing) return onMissing();
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext  = path.extname(pathToFile).toLowerCase();
      let mime = MIME[ext] || 'application/octet-stream';
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.avif') {
        mime = sniffImageMime(pathToFile, mime);
      }
      const range = req.headers.range;

      if (range && (ext === '.mp4' || ext === '.webm' || ext === '.ogg' || ext === '.mp3')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;

        if (start >= stats.size || end >= stats.size || start > end) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + stats.size });
          return res.end();
        }

        res.writeHead(206, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stats.size,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(pathToFile, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        });
        fs.createReadStream(pathToFile).pipe(res);
      }
    });
  };

  if (cleanUrl !== '/index.html' && !path.extname(cleanUrl)) {
    const slug = cleanUrl.replace(/^\\/+|\\/+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
    const serveIndex = () => serveFile(path.join(ROOT, 'index.html'));
    if (slug) {
      return serveFile(path.join(ROOT, 'subpages', slug + '.html'), serveIndex);
    }
    return serveIndex();
  }

  serveFile(filePath, () => {
    if (path.extname(filePath).toLowerCase() === '.html') {
      const subpagePath = path.join(ROOT, 'subpages', path.basename(filePath));
      return serveFile(subpagePath);
    }
    res.writeHead(404);
    res.end('Not found');
  });
});

const ANSI = {
  reset: '\\x1b[0m',
  primary: '\\x1b[38;2;250;178;131m',
  soft: '\\x1b[38;2;255;192;159m',
  text: '\\x1b[38;2;238;238;238m',
  muted: '\\x1b[38;2;128;128;128m',
  border: '\\x1b[38;2;72;72;72m',
  success: '\\x1b[38;2;127;216;143m',
  info: '\\x1b[38;2;86;182;194m',
  accent: '\\x1b[38;2;157;124;216m',
  warning: '\\x1b[38;2;245;167;66m',
  command: '\\x1b[38;2;255;192;159m',
  error: '\\x1b[38;2;224;108;117m',
};

function color(name, value) {
  return ANSI[name] + value + ANSI.reset;
}

function fitValue(value, width) {
  const text = String(value);
  if (text.length <= width) return text;
  if ((text.includes('\\\\') || text.includes('/')) && width > 12) {
    const separator = text.includes('\\\\') ? '\\\\' : '/';
    const prefix = text.startsWith(separator) ? separator : '';
    const parts = text.split(/[\\\\/]+/).filter(Boolean);
    const compact = prefix + parts.map((part, index) => {
      if (index === parts.length - 1) return part;
      if (/^[A-Za-z]:$/.test(part)) return part;
      return part.length > 5 ? part.slice(0, 3) + '..' : part;
    }).join(separator);
    if (compact.length <= width) return compact;
    const tail = Math.max(8, Math.floor(width * 0.45));
    const head = Math.max(0, width - tail - 4);
    return compact.slice(0, head) + separator + '..' + separator + compact.slice(-tail);
  }
  return width <= 3 ? '.'.repeat(Math.max(0, width)) : text.slice(0, width - 2) + '..';
}

function frameLine(label, value, colorName = 'text') {
  const labelText = label.padEnd(10);
  const valueWidth = Math.max(0, 56 - labelText.length);
  const shown = fitValue(value, valueWidth);
  const pad = Math.max(0, 56 - labelText.length - shown.length);
  console.log('  ' + color('border', '│ ') + color('muted', labelText) + color(colorName, shown) + ' '.repeat(pad) + color('border', ' │'));
}

function drawServerUi() {
  console.log('');
  console.log('  ' + color('border', '╭─' + '─'.repeat(56) + '─╮'));
  console.log('  ' + color('border', '│ ') + color('text', '  Framer Export preview server') + ' '.repeat(26) + color('border', ' │'));
  console.log('  ' + color('border', '├─' + '─'.repeat(56) + '─┤'));
  frameLine('URL', 'http://localhost:' + PORT, 'primary');
  frameLine('Root', ROOT, 'soft');
  frameLine('Run', 'node serve.js', 'command');
  frameLine('Mode', 'static mirror + SPA fallback', 'accent');
  console.log('  ' + color('border', '╰─' + '─'.repeat(56) + '─╯'));
  console.log('');
  console.log('  ' + color('success', 'ready') + color('muted', '  press Ctrl+C to stop') + '\\n');
}

server.listen(PORT, () => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const steps = ['Preparing server', 'Checking exported files', 'Binding local port', 'Serving static mirror'];
  const stepColors = ['text', 'info', 'warning', 'success'];
  let i = 0;
  const timer = setInterval(() => {
    const stepIndex = Math.min(steps.length - 1, Math.floor(i / 6));
    const step = steps[stepIndex];
    const dots = color('error', '.'.repeat(i % 4).padEnd(3, ' '));
    process.stdout.write('\\r\\x1B[2K  ' + color('primary', frames[i % frames.length]) + ' ' + color(stepColors[stepIndex], step) + dots);
    i++;
  }, 80);

  setTimeout(() => {
    clearInterval(timer);
    process.stdout.write('\\r\\x1B[2K');
    drawServerUi();
  }, 1280);
});
`;
