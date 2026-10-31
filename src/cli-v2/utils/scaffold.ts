import fs from 'node:fs/promises';
import path from 'node:path';
import { FRAMEWORK_CONFIGS, type FrameworkTarget } from './superpowers-template.js';

export interface ScaffoldResult {
  projectDirName: string;
  projectPath: string;
  staticPath: string;
}

export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  try {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  } catch (err) {
    // If source doesn't exist, ignore
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

export async function scaffoldFrameworkStarter(
  outDir: string,
  framework: FrameworkTarget
): Promise<ScaffoldResult> {
  const cfg = FRAMEWORK_CONFIGS[framework];
  const projectDirName = cfg.defaultDir;
  const projectPath = path.join(outDir, projectDirName);
  const staticPath = path.join(projectPath, cfg.staticDir);

  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(staticPath, { recursive: true });

  // 1. Copy exported assets to target static assets directory
  const sourceAssets = path.join(outDir, 'assets');
  const targetAssets = path.join(staticPath, 'assets');
  await copyDirRecursive(sourceAssets, targetAssets);

  // 2. Write minimal framework starter package.json
  const pkgContent = getFrameworkPackageJson(framework, projectDirName);
  await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(pkgContent, null, 2) + '\n');

  // 3. Write minimal tsconfig.json
  await fs.writeFile(
    path.join(projectPath, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: framework.includes('react') || framework === 'nextjs' ? 'react-jsx' : 'preserve',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: ['src/**/*', 'app/**/*'],
      },
      null,
      2
    ) + '\n'
  );

  // 4. Create base directories
  if (framework === 'nextjs') {
    await fs.mkdir(path.join(projectPath, 'app'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'components'), { recursive: true });
  } else {
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true });
    await fs.mkdir(path.join(projectPath, 'src', 'components'), { recursive: true });
  }

  return {
    projectDirName,
    projectPath,
    staticPath,
  };
}

function getFrameworkPackageJson(framework: FrameworkTarget, name: string): Record<string, unknown> {
  switch (framework) {
    case 'react-vite':
      return {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@types/react': '^18.3.1',
          '@types/react-dom': '^18.3.1',
          '@vitejs/plugin-react': '^4.3.1',
          typescript: '^5.5.3',
          vite: '^5.4.1',
        },
      };

    case 'nextjs':
      return {
        name,
        private: true,
        version: '0.0.0',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
        },
        dependencies: {
          next: '^14.2.5',
          react: '^18.3.1',
          'react-dom': '^18.3.1',
        },
        devDependencies: {
          '@types/node': '^20',
          '@types/react': '^18',
          '@types/react-dom': '^18',
          typescript: '^5',
        },
      };

    case 'vue-vite':
      return {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vue-tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          vue: '^3.4.31',
        },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.0.5',
          typescript: '^5.5.3',
          vite: '^5.4.1',
          'vue-tsc': '^2.0.24',
        },
      };

    case 'sveltekit':
      return {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite dev',
          build: 'vite build',
          preview: 'vite preview',
        },
        devDependencies: {
          '@sveltejs/kit': '^2.5.18',
          '@sveltejs/vite-plugin-svelte': '^3.1.1',
          svelte: '^4.2.18',
          vite: '^5.4.1',
        },
      };

    case 'astro':
      return {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'astro dev',
          start: 'astro dev',
          build: 'astro build',
          preview: 'astro preview',
        },
        dependencies: {
          astro: '^4.12.2',
        },
      };
  }
}
