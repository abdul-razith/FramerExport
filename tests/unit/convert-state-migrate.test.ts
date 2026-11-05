import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fromPersisted, resolveExportDir, toPersisted } from '../../src/convert/state-migrate.js';
import { initState } from '../../src/convert/state.js';
import type { ConvertState } from '../../src/convert/types.js';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'convert migrate '));
}

test('resolveExportDir resolves relative export directory', async () => {
  const root = await tmp();
  const next = path.join(root, 'site-next');
  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });

  const found = resolveExportDir('../site', next);
  assert.deepEqual(found, { dir: exp, missing: false });

  const missing = resolveExportDir('../missing-site', next);
  assert.deepEqual(missing, { dir: path.join(root, 'missing-site'), missing: true });
});

test('resolveExportDir resolves existing absolute directory', async () => {
  const root = await tmp();
  const next = path.join(root, 'site-next');
  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });

  const found = resolveExportDir(exp, next);
  assert.deepEqual(found, { dir: exp, missing: false });
});

test('v1 state with a moved export folder resolves the sibling by basename', async () => {
  const root = await tmp();
  const exportDir = path.join(root, 'out', 'portfolio');
  const nextDir = path.join(root, 'out', 'portfolio-next');
  await fs.mkdir(exportDir, { recursive: true });

  // Windows-style stored path
  const rWin = resolveExportDir('D:\\ABDUL\\x\\out\\portfolio', nextDir);
  assert.deepEqual(rWin, { dir: exportDir, missing: false });

  // POSIX-style stored path
  const rPosix = resolveExportDir('/Users/abdul/x/out/portfolio', nextDir);
  assert.deepEqual(rPosix, { dir: exportDir, missing: false });
});

test('resolveExportDir returns missing when neither absolute nor sibling exists', async () => {
  const root = await tmp();
  const nextDir = path.join(root, 'out', 'portfolio-next');
  const stored = 'D:\\ABDUL\\x\\out\\missing-export';
  const r = resolveExportDir(stored, nextDir);
  assert.deepEqual(r, { dir: stored, missing: true });
});

test('v1 state with tasks is flagged legacy; with none it is not', async () => {
  const root = await tmp();
  const nextDir = path.join(root, 'site-next');
  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });

  const withTasks = fromPersisted(
    {
      version: 1,
      exportDir: exp,
      tasks: {
        '001-shell': {
          id: '001-shell',
          kind: 'shell',
          file: 'task.md',
          status: 'pending',
          attempts: 0,
          targets: [],
        },
      },
    },
    nextDir
  );
  assert.equal(withTasks.legacyTasks, true);

  const emptyTasks = fromPersisted({ version: 1, exportDir: exp, tasks: {} }, nextDir);
  assert.equal(emptyTasks.legacyTasks, undefined);

  const noTasks = fromPersisted({ version: 1, exportDir: exp }, nextDir);
  assert.equal(noTasks.legacyTasks, undefined);

  const v2WithTasks = fromPersisted(
    {
      version: 2,
      exportDir: exp,
      tasks: {
        '001-shell': {
          id: '001-shell',
          kind: 'shell',
          file: 'task.md',
          status: 'pending',
          attempts: 0,
          targets: [],
        },
      },
    },
    nextDir
  );
  assert.equal(v2WithTasks.legacyTasks, undefined);
});

test('v1 stage mapping: keep analyze, extract-cms, scaffold statuses; every other v2 stage pending', async () => {
  const root = await tmp();
  const nextDir = path.join(root, 'site-next');
  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });

  const state = fromPersisted(
    {
      version: 1,
      exportDir: exp,
      stages: {
        analyze: 'done',
        'extract-cms': 'done',
        scaffold: 'done',
        tasks: 'needs-ai',
        verify: 'done',
      },
    },
    nextDir
  );

  assert.equal(state.stages.analyze, 'done');
  assert.equal(state.stages['extract-cms'], 'done');
  assert.equal(state.stages.scaffold, 'done');
  assert.equal(state.stages.install, 'pending');
  assert.equal(state.stages.generate, 'pending');
  assert.equal(state.stages.tasks, 'pending');
  assert.equal(state.stages.baseline, 'pending');
  assert.equal(state.stages.finalize, 'pending');
  assert.equal(state.stages.verify, 'pending');
});

test('missing export folder sets exportMissing', async () => {
  const root = await tmp();
  const nextDir = path.join(root, 'site-next');

  const missingState = fromPersisted({ version: 2, exportDir: '../missing-site' }, nextDir);
  assert.equal(missingState.exportMissing, true);

  const exp = path.join(root, 'site');
  await fs.mkdir(exp, { recursive: true });
  const presentState = fromPersisted({ version: 2, exportDir: '../site' }, nextDir);
  assert.equal(presentState.exportMissing, undefined);
});

test('toPersisted stores relative exportDir and strips nextDir, legacyTasks, and exportMissing', async () => {
  const root = await tmp();
  const exp = path.join(root, 'site');
  const next = path.join(root, 'site next');
  await fs.mkdir(exp, { recursive: true });

  const state: ConvertState = {
    ...initState(exp, next),
    legacyTasks: true,
    exportMissing: true,
  };

  const persisted = toPersisted(state) as Record<string, unknown>;
  assert.equal(persisted.version, 2);
  assert.equal(persisted.exportDir, '../site');
  assert.equal('nextDir' in persisted, false);
  assert.equal('legacyTasks' in persisted, false);
  assert.equal('exportMissing' in persisted, false);
});
