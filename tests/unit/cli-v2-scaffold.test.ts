import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scaffoldFrameworkStarter } from '../../src/cli-v2/utils/scaffold.js';

test('scaffoldFrameworkStarter creates package.json, public directory and copies assets', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-scaffold-test-'));
  try {
    const assetsDir = path.join(tmpDir, 'assets', 'images');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'logo.png'), 'fake-image-bytes');

    const result = await scaffoldFrameworkStarter(tmpDir, 'react-vite');

    assert.equal(result.projectDirName, 'converted-react-vite');
    assert.ok(result.projectPath.includes('converted-react-vite'));

    // Check package.json exists
    const pkgPath = path.join(result.projectPath, 'package.json');
    const pkgContent = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    assert.ok(pkgContent.dependencies?.react || pkgContent.devDependencies?.vite);

    // Check assets were copied into public/assets
    const copiedAsset = path.join(result.projectPath, 'public', 'assets', 'images', 'logo.png');
    const stat = await fs.stat(copiedAsset);
    assert.ok(stat.isFile());
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
