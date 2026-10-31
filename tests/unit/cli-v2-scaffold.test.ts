import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scaffoldFrameworkStarter } from '../../src/cli-v2/utils/scaffold.js';

test('scaffoldFrameworkStarter creates package.json with modern React 19, Vite 6 and framer-motion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-scaffold-test-'));
  try {
    const assetsDir = path.join(tmpDir, 'assets', 'images');
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, 'logo.png'), 'fake-image-bytes');

    const result = await scaffoldFrameworkStarter(tmpDir, 'react-vite');

    assert.equal(result.projectDirName, 'converted-react-vite');
    assert.ok(result.projectPath.includes('converted-react-vite'));

    // Check package.json exists and includes React 19, Vite 6, and framer-motion
    const pkgPath = path.join(result.projectPath, 'package.json');
    const pkgContent = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    assert.ok(pkgContent.dependencies?.react?.startsWith('^19'), 'React should be version 19');
    assert.ok(pkgContent.dependencies?.['framer-motion']);
    assert.ok(pkgContent.devDependencies?.vite?.startsWith('^6'), 'Vite should be version 6');

    // Check assets were copied into public/assets
    const copiedAsset = path.join(result.projectPath, 'public', 'assets', 'images', 'logo.png');
    const stat = await fs.stat(copiedAsset);
    assert.ok(stat.isFile());
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('scaffoldFrameworkStarter creates Next.js 15 starter with React 19 and framer-motion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-scaffold-next-'));
  try {
    const result = await scaffoldFrameworkStarter(tmpDir, 'nextjs');
    const pkgPath = path.join(result.projectPath, 'package.json');
    const pkgContent = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    assert.ok(pkgContent.dependencies?.next?.startsWith('^15'), 'Next.js should be version 15');
    assert.ok(pkgContent.dependencies?.react?.startsWith('^19'), 'React should be version 19');
    assert.ok(pkgContent.dependencies?.['framer-motion']);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('scaffoldFrameworkStarter does not overwrite existing package.json on re-run', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-scaffold-rerun-'));
  try {
    const projectPath = path.join(tmpDir, 'converted-nextjs');
    await fs.mkdir(projectPath, { recursive: true });
    const customPkg = { name: 'my-custom-modified-project', version: '1.2.3' };
    await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(customPkg));

    await scaffoldFrameworkStarter(tmpDir, 'nextjs');

    const readBack = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
    assert.equal(readBack.name, 'my-custom-modified-project');
    assert.equal(readBack.version, '1.2.3');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
