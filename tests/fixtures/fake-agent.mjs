#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const mode = process.env.FAKE_AGENT_MODE || 'edit';

function getFirstTarget() {
  const raw = process.env.FAKE_AGENT_TARGET || '';
  const first = raw.split(/[\r\n,]+/)[0]?.trim();
  return first || undefined;
}

function appendToTarget() {
  const target = getFirstTarget();
  if (target) {
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
