import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isAllowed,
  isIgnored,
  revertOutOfScope,
  snapshotTree,
  toPosixPath,
} from '../../src/convert/runner/scope.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'convert scope '));
}

test('toPosixPath normalizes separators and strips leading slashes while keeping trailing', () => {
  assert.equal(toPosixPath('src\\sections\\Hero\\'), 'src/sections/Hero/');
  assert.equal(toPosixPath('.\\src\\app\\globals.css'), 'src/app/globals.css');
  assert.equal(toPosixPath('/src/app/page.tsx'), 'src/app/page.tsx');
  assert.equal(toPosixPath('package.json'), 'package.json');
});

test('isAllowed matches exact files and directory subtree prefixes', () => {
  const allowed = [
    'src/sections/home/Hero/Hero.tsx',
    'src/sections/home/Hero/',
    'package.json',
  ];

  assert.equal(isAllowed('src/sections/home/Hero/Hero.tsx', allowed), true);
  assert.equal(isAllowed('src\\sections\\home\\Hero\\Hero.tsx', allowed), true);
  assert.equal(isAllowed('src/sections/home/Hero/sub/Child.tsx', allowed), true);
  assert.equal(isAllowed('package.json', allowed), true);

  // Does not match sibling with similar prefix
  assert.equal(isAllowed('src/sections/home/Heroine/Heroine.tsx', allowed), false);
  // Unlisted file
  assert.equal(isAllowed('src/app/globals.css', allowed), false);
  assert.equal(isAllowed('scratch-export-shot.png', allowed), false);
  // Empty allowed
  assert.equal(isAllowed('src/sections/home/Hero/Hero.tsx', []), false);
});

test('isIgnored recognizes Next, node_modules, next-env, and convert internals but watches tasks', () => {
  assert.equal(isIgnored('next-env.d.ts'), true);
  assert.equal(isIgnored('.next/cache/turbopack.json'), true);
  assert.equal(isIgnored('node_modules/react/package.json'), true);
  assert.equal(isIgnored('.git/config'), true);
  assert.equal(isIgnored('.convert/state.json'), true);
  assert.equal(isIgnored('.convert/checks/sec-hero.json'), true);
  assert.equal(isIgnored('.convert/snapshots/t1/file.tsx'), true);

  // Watched paths
  assert.equal(isIgnored('.convert/tasks/sec-home-hero.md'), false);
  assert.equal(isIgnored('src/app/globals.css'), false);
  assert.equal(isIgnored('public/logo.svg'), false);
  assert.equal(isIgnored('package.json'), false);
  assert.equal(isIgnored('scratch-export-shot.png'), false);
});

test('snapshotTree records watched files, root files and skips buffer for files > 5 MB', async () => {
  const root = await createTempDir();

  // Root configs
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
  await fs.writeFile(path.join(root, 'tsconfig.json'), '{}');

  // Ignored root file
  await fs.writeFile(path.join(root, 'next-env.d.ts'), '/// <reference types="next" />');

  // Root misc file
  await fs.writeFile(path.join(root, 'README.md'), '# Title');

  // src/**
  await fs.mkdir(path.join(root, 'src', 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app', 'globals.css'), 'body { margin: 0; }');

  // public/** with small file and 5 MB+ file
  await fs.mkdir(path.join(root, 'public', 'images'), { recursive: true });
  await fs.writeFile(path.join(root, 'public', 'small.txt'), 'small content');

  const largeSize = 5 * 1024 * 1024 + 10;
  const largeBuffer = Buffer.alloc(largeSize, 0x61);
  await fs.writeFile(path.join(root, 'public', 'large.bin'), largeBuffer);

  // .convert/tasks/** and ignored .convert/checks/**
  await fs.mkdir(path.join(root, '.convert', 'tasks'), { recursive: true });
  await fs.mkdir(path.join(root, '.convert', 'checks'), { recursive: true });
  await fs.writeFile(path.join(root, '.convert', 'tasks', 'task-1.md'), '# Task 1');
  await fs.writeFile(path.join(root, '.convert', 'checks', 'check-1.json'), '{}');

  const snap = await snapshotTree(root);

  // Watched files
  assert.equal(snap.files.has('package.json'), true);
  assert.equal(snap.files.get('package.json')?.content?.toString('utf8'), JSON.stringify({ name: 'test' }));
  assert.equal(snap.files.has('tsconfig.json'), true);
  assert.equal(snap.files.has('src/app/globals.css'), true);
  assert.equal(snap.files.has('public/small.txt'), true);
  assert.ok(snap.files.get('public/small.txt')?.content);
  assert.equal(snap.files.has('.convert/tasks/task-1.md'), true);

  // Large file > 5 MB in public skips buffer
  assert.equal(snap.files.has('public/large.bin'), true);
  assert.equal(snap.files.get('public/large.bin')?.content, undefined);
  assert.equal(snap.files.get('public/large.bin')?.size, largeSize);

  // Ignored files should not be in snap.files
  assert.equal(snap.files.has('next-env.d.ts'), false);
  assert.equal(snap.files.has('.convert/checks/check-1.json'), false);

  // Root files set records root filenames excluding ignored
  assert.equal(snap.rootFiles.has('package.json'), true);
  assert.equal(snap.rootFiles.has('tsconfig.json'), true);
  assert.equal(snap.rootFiles.has('README.md'), true);
  assert.equal(snap.rootFiles.has('next-env.d.ts'), false);
});

test('revertOutOfScope keeps allowed changes and reverts/deletes unallowed changes', async () => {
  const root = await createTempDir();

  // Initial project setup
  await fs.mkdir(path.join(root, 'src', 'app'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'sections', 'home', 'Hero'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'sections', 'home', 'Header'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'components'), { recursive: true });

  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
  await fs.writeFile(path.join(root, 'next-env.d.ts'), '/// <reference types="next" />');
  await fs.writeFile(path.join(root, 'src', 'app', 'globals.css'), 'body { margin: 0; }');
  await fs.writeFile(path.join(root, 'src', 'sections', 'home', 'Hero', 'Hero.tsx'), 'export function Hero() { return 1; }');
  await fs.writeFile(path.join(root, 'src', 'sections', 'home', 'Header', 'Header.tsx'), 'export function Header() { return "header v1"; }');
  await fs.writeFile(path.join(root, 'src', 'components', 'Footer.tsx'), 'export function Footer() { return "footer"; }');

  // Take initial snapshot
  const before = await snapshotTree(root);

  // Agent makes changes:
  // 1. Change to own target (allowed) -> MUST BE KEPT
  await fs.writeFile(path.join(root, 'src', 'sections', 'home', 'Hero', 'Hero.tsx'), 'export function Hero() { return 2; }');

  // 2. Change to src/app/globals.css (unallowed) -> MUST BE REVERTED
  await fs.writeFile(path.join(root, 'src', 'app', 'globals.css'), 'body { margin: 10px; }');

  // 3. New scratch-export-shot.png in root (unallowed) -> MUST BE DELETED
  await fs.writeFile(path.join(root, 'scratch-export-shot.png'), 'fake-shot');

  // 4. New file under allowed src/sections/home/Hero/ dir -> MUST BE KEPT
  await fs.writeFile(path.join(root, 'src', 'sections', 'home', 'Hero', 'SubHero.tsx'), 'export function SubHero() {}');

  // 5. Change inside another running task's target (passed in allowed) -> MUST BE KEPT
  await fs.writeFile(path.join(root, 'src', 'sections', 'home', 'Header', 'Header.tsx'), 'export function Header() { return "header v2"; }');

  // 6. next-env.d.ts change (ignored) -> MUST BE IGNORED (kept as modified)
  await fs.writeFile(path.join(root, 'next-env.d.ts'), '/// modified');

  // 7. Deletion of unallowed watched file -> MUST BE RESTORED
  await fs.unlink(path.join(root, 'src', 'components', 'Footer.tsx'));

  // Allowed list contains:
  // - own task targets: Hero.tsx and Hero/ subtree
  // - another running task's target: Header.tsx
  const allowed = [
    'src/sections/home/Hero/Hero.tsx',
    'src/sections/home/Hero/',
    'src/sections/home/Header/Header.tsx',
  ];

  const reverted = await revertOutOfScope(root, before, allowed);

  // Return value lists exactly the reverted paths in sorted order
  assert.deepEqual(reverted, [
    'scratch-export-shot.png',
    'src/app/globals.css',
    'src/components/Footer.tsx',
  ]);

  // Verify disk state
  // 1. Own target kept
  assert.equal(
    await fs.readFile(path.join(root, 'src', 'sections', 'home', 'Hero', 'Hero.tsx'), 'utf8'),
    'export function Hero() { return 2; }'
  );

  // 2. globals.css reverted to original
  assert.equal(
    await fs.readFile(path.join(root, 'src', 'app', 'globals.css'), 'utf8'),
    'body { margin: 0; }'
  );

  // 3. scratch-export-shot.png deleted
  await assert.rejects(fs.stat(path.join(root, 'scratch-export-shot.png')), { code: 'ENOENT' });

  // 4. SubHero.tsx under allowed dir kept
  assert.equal(
    await fs.readFile(path.join(root, 'src', 'sections', 'home', 'Hero', 'SubHero.tsx'), 'utf8'),
    'export function SubHero() {}'
  );

  // 5. Running task Header.tsx change kept
  assert.equal(
    await fs.readFile(path.join(root, 'src', 'sections', 'home', 'Header', 'Header.tsx'), 'utf8'),
    'export function Header() { return "header v2"; }'
  );

  // 6. next-env.d.ts modification ignored (not reverted)
  assert.equal(
    await fs.readFile(path.join(root, 'next-env.d.ts'), 'utf8'),
    '/// modified'
  );

  // 7. Footer.tsx restored
  assert.equal(
    await fs.readFile(path.join(root, 'src', 'components', 'Footer.tsx'), 'utf8'),
    'export function Footer() { return "footer"; }'
  );
});

test('revertOutOfScope handles new files in unallowed subtrees and ignores convert internals', async () => {
  const root = await createTempDir();

  await fs.mkdir(path.join(root, 'src', 'utils'), { recursive: true });
  await fs.mkdir(path.join(root, '.convert', 'tasks'), { recursive: true });
  await fs.mkdir(path.join(root, '.convert', 'checks'), { recursive: true });

  await fs.writeFile(path.join(root, 'src', 'utils', 'helper.ts'), 'export const a = 1;');
  await fs.writeFile(path.join(root, '.convert', 'tasks', 'task-1.md'), '# Task 1');

  const before = await snapshotTree(root);

  // Unallowed new file in src
  await fs.mkdir(path.join(root, 'src', 'bad'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'bad', 'rogue.ts'), 'malicious');

  // Unallowed new file in .convert/tasks
  await fs.writeFile(path.join(root, '.convert', 'tasks', 'rogue-task.md'), '# Rogue');

  // Change inside .convert/checks (ignored)
  await fs.writeFile(path.join(root, '.convert', 'checks', 'check-new.json'), '{"ok":true}');

  const reverted = await revertOutOfScope(root, before, []);

  assert.deepEqual(reverted, [
    '.convert/tasks/rogue-task.md',
    'src/bad/rogue.ts',
  ]);

  await assert.rejects(fs.stat(path.join(root, 'src', 'bad', 'rogue.ts')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, '.convert', 'tasks', 'rogue-task.md')), { code: 'ENOENT' });

  // .convert/checks/check-new.json remains intact because .convert/checks is ignored
  assert.equal(
    await fs.readFile(path.join(root, '.convert', 'checks', 'check-new.json'), 'utf8'),
    '{"ok":true}'
  );
});

test('snapshotTree skips buffer for files > 5 MB in src as well', async () => {
  const root = await createTempDir();
  await fs.mkdir(path.join(root, 'src', 'assets'), { recursive: true });
  const largeSize = 5 * 1024 * 1024 + 100;
  const largeBuffer = Buffer.alloc(largeSize, 0x62);
  await fs.writeFile(path.join(root, 'src', 'assets', 'large-asset.bin'), largeBuffer);

  const snap = await snapshotTree(root);
  assert.equal(snap.files.has('src/assets/large-asset.bin'), true);
  assert.equal(snap.files.get('src/assets/large-asset.bin')?.content, undefined);
  assert.equal(snap.files.get('src/assets/large-asset.bin')?.size, largeSize);
});

test('revertOutOfScope keeps allowed files in a new root directory without deleting the directory', async () => {
  const root = await createTempDir();
  const before = await snapshotTree(root);

  // Agent creates a new root directory `custom_dir/`
  const customDir = path.join(root, 'custom_dir');
  await fs.mkdir(customDir, { recursive: true });
  await fs.writeFile(path.join(customDir, 'allowed.txt'), 'keep me');
  await fs.writeFile(path.join(customDir, 'unallowed.txt'), 'delete me');

  const allowed = ['custom_dir/allowed.txt'];

  const reverted = await revertOutOfScope(root, before, allowed);

  assert.deepEqual(reverted, ['custom_dir/unallowed.txt']);
  // Unallowed file removed
  await assert.rejects(fs.stat(path.join(customDir, 'unallowed.txt')), { code: 'ENOENT' });
  // Allowed file kept
  assert.equal(await fs.readFile(path.join(customDir, 'allowed.txt'), 'utf8'), 'keep me');
  // Directory still exists
  const dirStat = await fs.stat(customDir);
  assert.equal(dirStat.isDirectory(), true);
});


test('Fix5 item 4: scope revert keeps the shell task consolidation (views edited, copies deleted, shell files added) and reverts everything else', async () => {
  const { shellTargets } = await import('../../src/convert/stages/tasks.js');
  const root = await createTempDir();
  try {
    const put = async (rel: string, text: string) => {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), text);
    };
    await put('src/components/shell/Nav.tsx', 'shell');
    await put('src/sections/home/Nav.tsx', 'copy-home');
    await put('src/sections/about/Nav.tsx', 'copy-about');
    await put('src/views/home.tsx', 'view-home');
    await put('src/views/about.tsx', 'view-about');
    await put('src/views/contact.tsx', 'view-contact');
    await put('src/sections/home/Hero.tsx', 'hero');
    const targets = shellTargets({
      name: 'Nav',
      component: 'Nav',
      file: 'src/components/shell/Nav.tsx',
      pages: ['/', '/about'],
      differences: [],
      copies: [
        { route: '/', component: 'Nav', file: 'src/sections/home/Nav.tsx', view: 'src/views/home.tsx' },
        { route: '/about', component: 'Nav', file: 'src/sections/about/Nav.tsx', view: 'src/views/about.tsx' },
      ],
    });
    const before = await snapshotTree(root);

    await put('src/components/shell/Nav.tsx', 'shell-refactored');
    await put('src/components/shell/Nav/Item.tsx', 'new shell part');
    await put('src/views/home.tsx', 'view-home-switched');
    await put('src/views/about.tsx', 'view-about-switched');
    await fs.rm(path.join(root, 'src/sections/home/Nav.tsx'));
    await fs.rm(path.join(root, 'src/sections/about/Nav.tsx'));
    await put('src/views/contact.tsx', 'view-contact-EDITED');
    await put('src/sections/home/Hero.tsx', 'hero-EDITED');

    const reverted = await revertOutOfScope(root, before, targets);
    assert.deepEqual(reverted, ['src/sections/home/Hero.tsx', 'src/views/contact.tsx']);
    assert.equal(await fs.readFile(path.join(root, 'src/views/home.tsx'), 'utf8'), 'view-home-switched');
    assert.equal(await fs.readFile(path.join(root, 'src/components/shell/Nav/Item.tsx'), 'utf8'), 'new shell part');
    await assert.rejects(fs.stat(path.join(root, 'src/sections/home/Nav.tsx')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
