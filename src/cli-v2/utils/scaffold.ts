import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FRAMEWORK_CONFIGS,
  type FrameworkTarget,
} from './superpowers-template.js';

export interface ScaffoldResult {
  projectDirName: string;
  projectPath: string;
  staticPath: string;
  entryFiles: string;
}

export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  try {
    await fs.access(src);
  } catch {
    return;
  }

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

  // 2. Write modern framework starter package.json if it doesn't already exist
  const pkgPath = path.join(projectPath, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    const pkgContent = getFrameworkPackageJson(framework, projectDirName);
    await fs.writeFile(pkgPath, JSON.stringify(pkgContent, null, 2) + '\n');
  }

  // 3. Write minimal tsconfig.json if it doesn't already exist
  const tsconfigPath = path.join(projectPath, 'tsconfig.json');
  try {
    await fs.access(tsconfigPath);
  } catch {
    await fs.writeFile(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            jsx: framework.includes('react') || framework === 'nextjs' ? 'react-jsx' : 'preserve',
            strict: true,
            skipLibCheck: true,
            paths: {
              '@/*': ['./*'],
            },
          },
          include: ['**/*.ts', '**/*.tsx', '**/*.vue', '**/*.svelte', '**/*.astro'],
        },
        null,
        2
      ) + '\n'
    );
  }

  return {
    projectDirName,
    projectPath,
    staticPath,
    entryFiles: cfg.entryFiles,
  };
}

function getFrameworkPackageJson(framework: FrameworkTarget, name: string): Record<string, any> {
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
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'framer-motion': '^11.11.17',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.4',
          typescript: '^5.7.2',
          vite: '^6.0.1',
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
          next: '^15.0.3',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'framer-motion': '^11.11.17',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@types/node': '^20',
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
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
          vue: '^3.5.13',
        },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.2.1',
          typescript: '^5.7.2',
          vite: '^6.0.1',
          'vue-tsc': '^2.1.10',
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
          '@sveltejs/adapter-auto': '^3.3.1',
          '@sveltejs/kit': '^2.9.0',
          '@sveltejs/vite-plugin-svelte': '^4.0.1',
          svelte: '^5.2.7',
          typescript: '^5.7.2',
          vite: '^6.0.1',
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
          astro: '^5.0.0',
        },
        devDependencies: {
          typescript: '^5.7.2',
        },
      };
  }
}
