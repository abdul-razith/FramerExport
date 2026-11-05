#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const mode = process.env.FAKE_AGENT_MODE || 'edit';

function getTargets() {
  const raw = process.env.FAKE_AGENT_TARGET || '';
  const list = raw.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;

  const pIdx = process.argv.indexOf('-p');
  if (pIdx !== -1 && process.argv[pIdx + 1]) {
    const prompt = process.argv[pIdx + 1];
    const m = prompt.match(/(\.convert[\\/]tasks[\\/][A-Za-z0-9_-]+\.md)/);
    if (m && fs.existsSync(m[1])) {
      const content = fs.readFileSync(m[1], 'utf8');
      const section = content.match(/## Edit only([\s\S]*?)(?=^## |\Z)/m);
      if (section) {
        const matches = [...section[1].matchAll(/- `([^`]+)`/g)].map((x) => x[1]);
        const filesOnly = matches.filter((f) => !f.endsWith('/'));
        if (filesOnly.length) return filesOnly;
      }
    }
  }
  return [];
}

function appendToTarget() {
  const targets = getTargets();
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, '// edited\n');
  }
}

switch (mode) {
  case 'edit': {
    appendToTarget();
    process.exit(0);
    break;
  }
  case 'outside': {
    appendToTarget();
    fs.mkdirSync('src/app', { recursive: true });
    fs.writeFileSync('src/app/globals.css', '/* outside */\n');
    fs.writeFileSync('scratch.png', 'png');
    process.exit(0);
    break;
  }
  case 'hang': {
    setInterval(() => {}, 60_000);
    break;
  }
  case 'quota': {
    console.error('error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 43h24m17s.');
    process.exit(3);
    break;
  }
  case 'spawn-child': {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
      detached: process.platform === 'win32',
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    process.stdout.write(String(child.pid) + '\n');
    setInterval(() => {}, 60_000);
    break;
  }
  default: {
    console.error(`Unknown FAKE_AGENT_MODE: ${mode}`);
    process.exit(1);
  }
}
