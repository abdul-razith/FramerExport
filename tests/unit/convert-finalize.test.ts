import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { StageContext } from '../../src/convert/adapters/types.js';
import { DEFAULT_OPTIONS, initState, loadState } from '../../src/convert/state.js';
import type { CheckResult } from '../../src/convert/verify/check.js';
import {
  dropFramerCss,
  framerClassFiles,
  runFinalize,
} from '../../src/convert/stages/finalize.js';

const tmps: string[] = [];
after(async () => {
  for (const d of tmps) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

async function makeTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'convert-finalize-'));
  tmps.push(dir);
  return dir;
}

function makePassResult(taskId: string): CheckResult {
  return {
    taskId,
    mode: 'full',
    pass: true,
    limitReached: false,
    widths: [],
    dom: [],
    code: [],
    motion: [],
    errors: [],
  };
}

function makeFailResult(taskId: string): CheckResult {
  return {
    taskId,
    mode: 'full',
    pass: false,
    limitReached: false,
    widths: [],
    dom: [],
    code: ['code violation'],
    motion: [],
    errors: ['Check failed'],
  };
}

test('framerClassFiles finds files with framer- classes and ignores src/styles/framer/ and non-class occurrences', async () => {
  const tmp = await makeTmp();
  await fs.mkdir(path.join(tmp, 'src', 'app'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'src', 'components'), { recursive: true });
  await fs.mkdir(path.join(tmp, 'src', 'styles', 'framer'), { recursive: true });

  // File 1: Has framer- in className attribute
  await fs.writeFile(
    path.join(tmp, 'src', 'app', 'page.tsx'),
    'export default function Page() { return <div className="p-4 framer-1234">Hello</div>; }',
    'utf8'
  );

  // File 2: Has framer- in className JSX expression
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'Hero.tsx'),
    "export default function Hero() { return <section className={'framer-xyz bg-black'}>Hero</section>; }",
    'utf8'
  );

  // File 3: Clean file, uses framer-motion import but no framer- className
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'Clean.tsx'),
    "import { motion } from 'framer-motion';\n// note: framer-test in comment\nexport default function Clean() { return <div className=\"flex flex-col\">Clean</div>; }",
    'utf8'
  );

  // File 4: Under src/styles/framer/ - should be ignored even though it contains framer- classes
  await fs.writeFile(
    path.join(tmp, 'src', 'styles', 'framer', 'style.css'),
    '.framer-1234 { display: flex; }',
    'utf8'
  );
  await fs.writeFile(
    path.join(tmp, 'src', 'styles', 'framer', 'tokens.tsx'),
    'export const cls = "framer-abc";',
    'utf8'
  );

  // File 5: Nested clsx object in className expression
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'Nested.tsx'),
    "export default function Nested() { return <div className={clsx({ 'framer-nested': true })}>Nested</div>; }",
    'utf8'
  );

  // File 6: Template literal in className expression
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'Templated.tsx'),
    "export default function Templated() { return <div className={`p-4 framer-${v}`}>Templated</div>; }",
    'utf8'
  );

  // File 7: Multiline className
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'Multiline.tsx'),
    'export default function Multiline() { return <div className="p-4\n  framer-multi\n  bg-white">Multiline</div>; }',
    'utf8'
  );

  // File 8: Clean file with framer- in a variable, but className is clean
  await fs.writeFile(
    path.join(tmp, 'src', 'components', 'SafeVar.tsx'),
    'const x = "framer-data";\nexport default function SafeVar() { return <div className="clean-class">Safe</div>; }',
    'utf8'
  );

  const files = await framerClassFiles(tmp);
  const normalized = files.map((f) => path.relative(tmp, f).replace(/\\/g, '/')).sort();

  assert.deepEqual(normalized, [
    'src/app/page.tsx',
    'src/components/Hero.tsx',
    'src/components/Multiline.tsx',
    'src/components/Nested.tsx',
    'src/components/Templated.tsx',
  ]);
});

test('dropFramerCss removes import lines and deletes src/styles/framer/ folder', async () => {
  const tmp = await makeTmp();
  const viewsDir = path.join(tmp, 'src', 'views');
  const cssDir = path.join(tmp, 'src', 'styles', 'framer');
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.mkdir(cssDir, { recursive: true });

  await fs.writeFile(path.join(cssDir, 'sheet.css'), '.framer-1 { color: red; }', 'utf8');

  const viewFile = path.join(viewsDir, 'home.tsx');
  await fs.writeFile(
    viewFile,
    [
      "import React from 'react';",
      "import '@/styles/framer/sheet.css';",
      "import Header from '@/components/Header';",
      '',
      'export default function Home() {',
      '  return <main>Home</main>;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

  const changed = await dropFramerCss(tmp);
  assert.equal(changed, 1);

  // Folder should be deleted
  const cssDirExists = await fs
    .access(cssDir)
    .then(() => true)
    .catch(() => false);
  assert.equal(cssDirExists, false);

  // Import line should be removed
  const updatedView = await fs.readFile(viewFile, 'utf8');
  assert.ok(!updatedView.includes('@/styles/framer/sheet.css'));
  assert.ok(updatedView.includes("import React from 'react';"));
  assert.ok(updatedView.includes("import Header from '@/components/Header';"));
});

test('runFinalize with no framer classes: imports removed and folder gone', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: true };

  const viewsDir = path.join(tmp, 'src', 'views');
  const cssDir = path.join(tmp, 'src', 'styles', 'framer');
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.mkdir(cssDir, { recursive: true });

  await fs.writeFile(path.join(cssDir, 'sheet.css'), '.css { color: red; }', 'utf8');
  await fs.writeFile(
    path.join(viewsDir, 'home.tsx'),
    "import '@/styles/framer/sheet.css';\nexport default function Home() { return <div className=\"p-4\">Home</div>; }\n",
    'utf8'
  );

  const logs: string[] = [];
  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: (m) => logs.push(m),
  };

  let reportCalled = false;
  const res = await runFinalize(ctx, {
    check: async () => makePassResult('task'),
    build: async () => ({ ok: true, log: 'build ok' }),
    report: async () => {
      reportCalled = true;
      return { file: '.convert/report/index.html' };
    },
  });

  assert.equal(res.buildOk, true);
  assert.equal(res.report, '.convert/report/index.html');
  assert.equal(reportCalled, true);
  assert.equal(ctx.state.stages.finalize, 'done');

  // Verify CSS folder is deleted
  const folderExists = await fs
    .access(cssDir)
    .then(() => true)
    .catch(() => false);
  assert.equal(folderExists, false);

  // Verify import is removed
  const content = await fs.readFile(path.join(viewsDir, 'home.tsx'), 'utf8');
  assert.ok(!content.includes('@/styles/framer/sheet.css'));

  const loaded = await loadState(tmp);
  assert.equal(loaded?.stages.finalize, 'done');
});

test('runFinalize with one file using framer-x: nothing removed and warning set', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: true };

  const sectionsDir = path.join(tmp, 'src', 'sections');
  const viewsDir = path.join(tmp, 'src', 'views');
  const cssDir = path.join(tmp, 'src', 'styles', 'framer');
  await fs.mkdir(sectionsDir, { recursive: true });
  await fs.mkdir(viewsDir, { recursive: true });
  await fs.mkdir(cssDir, { recursive: true });

  await fs.writeFile(path.join(cssDir, 'sheet.css'), '.framer-x { color: blue; }', 'utf8');
  await fs.writeFile(
    path.join(viewsDir, 'home.tsx'),
    "import '@/styles/framer/sheet.css';\nexport default function Home() { return <div>Home</div>; }\n",
    'utf8'
  );
  await fs.writeFile(
    path.join(sectionsDir, 'hero.tsx'),
    'export default function Hero() { return <section className="framer-x">Hero</section>; }\n',
    'utf8'
  );

  const logs: string[] = [];
  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: (m) => logs.push(m),
  };

  const res = await runFinalize(ctx, {
    check: async () => makePassResult('task'),
    build: async () => ({ ok: true, log: 'build ok' }),
    report: async () => ({ file: '.convert/report/index.html' }),
  });

  assert.equal(res.buildOk, true);
  // Folder NOT deleted
  const folderExists = await fs
    .access(cssDir)
    .then(() => true)
    .catch(() => false);
  assert.equal(folderExists, true);

  // Import line NOT removed
  const viewContent = await fs.readFile(path.join(viewsDir, 'home.tsx'), 'utf8');
  assert.ok(viewContent.includes('@/styles/framer/sheet.css'));

  // Warning logged and stored
  const expectedWarning = 'finalize: Framer CSS kept; framer- classes remain in 1 files';
  assert.ok(logs.some((l) => l.includes(expectedWarning)));
  assert.ok(ctx.state.warnings.includes(expectedWarning));
});

test('runFinalize failing build creates fix-build once, second failure sets failed', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: true };

  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: () => {},
  };

  // Attempt 1: Failing build creates fix-build task with attempts: 1
  const res1 = await runFinalize(ctx, {
    check: async () => makePassResult('task'),
    build: async () => ({ ok: false, log: 'Error: Module not found' }),
    report: async () => ({ file: '.convert/report/index.html' }),
  });

  assert.equal(res1.buildOk, false);
  assert.equal(res1.fixTask, 'fix-build');
  assert.notEqual(ctx.state.stages.finalize, 'failed');

  const fixTask = ctx.state.tasks['fix-build'];
  assert.ok(fixTask);
  assert.equal(fixTask.id, 'fix-build');
  assert.equal(fixTask.kind, 'fix');
  assert.deepEqual(fixTask.targets, ['src/']);
  assert.equal(fixTask.attempts, 1);
  assert.equal(fixTask.status, 'pending');

  const taskFilePath = path.join(tmp, fixTask.file);
  const taskFileExists = await fs
    .access(taskFilePath)
    .then(() => true)
    .catch(() => false);
  assert.equal(taskFileExists, true);
  const taskFileContent = await fs.readFile(taskFilePath, 'utf8');
  assert.ok(taskFileContent.includes('Error: Module not found'));

  const loadedState1 = await loadState(tmp);
  assert.equal(loadedState1?.tasks['fix-build']?.attempts, 1);
  assert.equal(loadedState1?.tasks['fix-build']?.status, 'pending');

  // Attempt 2: Second failure sets status to needs-review and stages.finalize = 'failed'
  const res2 = await runFinalize(ctx, {
    check: async () => makePassResult('task'),
    build: async () => ({ ok: false, log: 'Error: Module still not found' }),
    report: async () => ({ file: '.convert/report/index.html' }),
  });

  assert.equal(res2.buildOk, false);
  assert.equal(res2.fixTask, 'fix-build');
  assert.equal(ctx.state.tasks['fix-build']?.attempts, 2);
  assert.equal(ctx.state.tasks['fix-build']?.status, 'needs-review');
  assert.equal(ctx.state.stages.finalize, 'failed');

  const loadedState2 = await loadState(tmp);
  assert.equal(loadedState2?.tasks['fix-build']?.attempts, 2);
  assert.equal(loadedState2?.tasks['fix-build']?.status, 'needs-review');
  assert.equal(loadedState2?.stages.finalize, 'failed');
});

test('runFinalize testing off never calls check or report', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: false };

  // Add done shell and section tasks
  state.tasks['shell-nav'] = {
    id: 'shell-nav',
    kind: 'shell',
    file: '.convert/tasks/shell-nav.md',
    status: 'done',
    attempts: 1,
    targets: ['src/components/shell/Nav.tsx'],
  };
  state.tasks['sec-hero'] = {
    id: 'sec-hero',
    kind: 'section',
    file: '.convert/tasks/sec-hero.md',
    status: 'done',
    attempts: 1,
    targets: ['src/sections/home/Hero.tsx'],
  };

  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: () => {},
  };

  let checkCalls = 0;
  let reportCalls = 0;

  const res = await runFinalize(ctx, {
    check: async () => {
      checkCalls++;
      return makePassResult('task');
    },
    build: async () => ({ ok: true, log: 'build ok' }),
    report: async () => {
      reportCalls++;
      return { file: '.convert/report/index.html' };
    },
  });

  assert.equal(checkCalls, 0, 'check should not be called when testing is off');
  assert.equal(reportCalls, 0, 'report should not be called when testing is off');
  assert.equal(res.buildOk, true);
  assert.equal(res.report, undefined);
  assert.equal(ctx.state.stages.finalize, 'done');
});

test('runFinalize testing on re-checks done shell/section tasks and marks failures as needs-review', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: true };

  state.tasks['shell-nav'] = {
    id: 'shell-nav',
    kind: 'shell',
    file: '.convert/tasks/shell-nav.md',
    status: 'done',
    attempts: 1,
    targets: ['src/components/shell/Nav.tsx'],
  };
  state.tasks['sec-hero'] = {
    id: 'sec-hero',
    kind: 'section',
    file: '.convert/tasks/sec-hero.md',
    status: 'done',
    attempts: 1,
    targets: ['src/sections/home/Hero.tsx'],
  };
  state.tasks['page-home'] = {
    id: 'page-home',
    kind: 'page',
    file: '.convert/tasks/page-home.md',
    status: 'done',
    attempts: 1,
    targets: ['src/views/home.tsx'],
  };
  state.tasks['sec-footer'] = {
    id: 'sec-footer',
    kind: 'section',
    file: '.convert/tasks/sec-footer.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/sections/home/Footer.tsx'],
  };

  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: () => {},
  };

  const checkedIds: string[] = [];
  const res = await runFinalize(ctx, {
    check: async (id) => {
      checkedIds.push(id);
      if (id === 'sec-hero') return makeFailResult(id);
      return makePassResult(id);
    },
    build: async () => ({ ok: true, log: 'build ok' }),
    report: async () => ({ file: '.convert/report/index.html' }),
  });

  // Only done shell and section tasks should be checked
  assert.deepEqual(checkedIds.sort(), ['sec-hero', 'shell-nav']);
  assert.equal(ctx.state.tasks['shell-nav']?.status, 'done');
  assert.equal(ctx.state.tasks['sec-hero']?.status, 'needs-review');
  assert.equal(ctx.state.tasks['page-home']?.status, 'done');
  assert.equal(ctx.state.tasks['sec-footer']?.status, 'pending');

  assert.equal(res.buildOk, true);
  assert.equal(res.report, '.convert/report/index.html');
  assert.equal(ctx.state.stages.finalize, 'done');
});

test('runFinalize marks fix-build task as done when build succeeds', async () => {
  const tmp = await makeTmp();
  const state = initState('/fake/export', tmp);
  state.options = { ...DEFAULT_OPTIONS, testing: true };

  state.tasks['fix-build'] = {
    id: 'fix-build',
    kind: 'fix',
    file: '.convert/tasks/fix-build.md',
    status: 'pending',
    attempts: 1,
    targets: ['src/'],
  };

  const ctx: StageContext = {
    state,
    exportDir: '/fake/export',
    nextDir: tmp,
    log: () => {},
  };

  const res = await runFinalize(ctx, {
    check: async () => makePassResult('task'),
    build: async () => ({ ok: true, log: 'build ok' }),
    report: async () => ({ file: '.convert/report/index.html' }),
  });

  assert.equal(res.buildOk, true);
  assert.equal(ctx.state.tasks['fix-build']?.status, 'done');
  assert.equal(ctx.state.stages.finalize, 'done');
});
