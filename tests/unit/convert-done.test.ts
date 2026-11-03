import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { framerAdapter } from '../../src/convert/adapters/framer/index.js';
import { runConvertCommand } from '../../src/convert/index.js';
import { pickNextTask } from '../../src/convert/pipeline.js';
import { initState, loadState, saveState } from '../../src/convert/state.js';
import { runVerify } from '../../src/convert/stages/verify.js';
import type { TaskRecord } from '../../src/convert/types.js';
import { stopAllManaged } from '../../src/convert/verify/proc.js';

const tmps: string[] = [];
after(async () => {
  await stopAllManaged();
  for (const d of tmps) await rm(d, { recursive: true, force: true });
});

const task = (id: string, kind: TaskRecord['kind'], extra: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  kind,
  file: `.convert/tasks/${id}.md`,
  status: 'pending',
  attempts: 0,
  targets: [],
  ...extra,
});

// Stand-in Next app: the build succeeds and `start -p <port>` answers every request.
const START = `import http from 'node:http';
const port = process.argv[process.argv.indexOf('-p') + 1];
http.createServer((req, res) => res.end('ok')).listen(port, '127.0.0.1');
`;

async function project() {
  const nextDir = await mkdtemp(path.join(os.tmpdir(), 'fexport done '));
  tmps.push(nextDir);
  const state = initState(path.join(nextDir, 'export'), nextDir);
  Object.assign(state.stages, { analyze: 'done', 'extract-cms': 'done', scaffold: 'done', tasks: 'needs-ai' });
  state.tasks = {
    '001-component-Button': task('001-component-Button', 'component', { targets: ['src/components/Button.tsx'] }),
    '101-page-home': task('101-page-home', 'page', { route: '/', targets: ['src/app/page.tsx'] }),
    '201-motion-home': task('201-motion-home', 'motion', { route: '/', targets: ['src/app/page.tsx'] }),
  };
  await saveState(state);
  await mkdir(path.join(nextDir, 'node_modules'));
  await writeFile(path.join(nextDir, 'start.mjs'), START);
  await writeFile(
    path.join(nextDir, 'package.json'),
    JSON.stringify({ name: 'stand-in', private: true, type: 'module', scripts: { build: 'node -e "0"', start: 'node start.mjs' } }),
  );
  return { state, nextDir, ctx: { state, exportDir: state.exportDir, nextDir, log: () => {} } };
}

async function cli(cwd: string, argv: string[]) {
  const lines: string[] = [];
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const code = await runConvertCommand(argv, { log: (m) => lines.push(m), error: (m) => lines.push(m) });
    return { code, text: lines.join('\n') };
  } finally {
    process.chdir(prev);
  }
}

test('component task: done once its file exists and the build succeeds', { timeout: 120_000 }, async () => {
  const { state, nextDir, ctx } = await project();
  const missing = await runVerify(ctx, framerAdapter, '001-component-Button');
  assert.deepEqual(missing, { passed: [], failed: ['001-component-Button'] });
  assert.equal(state.tasks['001-component-Button']!.status, 'pending');
  assert.equal(state.tasks['001-component-Button']!.attempts, 0);
  assert.ok(state.warnings.some((w) => w.includes('001-component-Button') && w.includes('src/components/Button.tsx')));

  await mkdir(path.join(nextDir, 'src', 'components'), { recursive: true });
  await writeFile(path.join(nextDir, 'src', 'components', 'Button.tsx'), 'export function Button() { return null; }\n');
  const present = await runVerify(ctx, framerAdapter, '001-component-Button');
  assert.deepEqual(present, { passed: ['001-component-Button'], failed: [] });
  assert.equal(state.tasks['001-component-Button']!.status, 'done');
});

test('convert done: marks a motion task done, refuses other kinds', async () => {
  const { nextDir } = await project();
  const page = await cli(nextDir, ['convert', 'done', '101-page-home']);
  assert.equal(page.code, 1);
  assert.match(page.text, /verify 101-page-home/);
  assert.equal((await loadState(nextDir))!.tasks['101-page-home']!.status, 'pending');

  const motion = await cli(nextDir, ['convert', 'done', '201-motion-home']);
  assert.equal(motion.code, 0, motion.text);
  assert.equal((await loadState(nextDir))!.tasks['201-motion-home']!.status, 'done');

  const unknown = await cli(nextDir, ['convert', 'done', 'nope']);
  assert.equal(unknown.code, 1);
});

test('next: fix tasks, then components, pages, motion; none left -> No pending tasks', async () => {
  const state = initState('/e', '/n');
  const add = (t: TaskRecord) => (state.tasks[t.id] = t);
  add(task('201-motion-home', 'motion'));
  add(task('101-page-home', 'page'));
  add(task('002-component-B', 'component'));
  add(task('001-component-A', 'component', { status: 'done' }));
  add(task('build', 'fix', { status: 'in-progress', attempts: 1 }));
  add(task('fix-101-page-home-1', 'fix'));
  const order: string[] = [];
  for (let t = pickNextTask(state); t; t = pickNextTask(state)) {
    order.push(t.id);
    t.status = 'done';
  }
  assert.deepEqual(order, ['fix-101-page-home-1', '002-component-B', '101-page-home', '201-motion-home']);
});
