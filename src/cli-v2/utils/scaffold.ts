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

  // 4. Pre-extract SVG symbol templates and compiled CSS styles
  await preExtractMarkupAndStyles(outDir, projectPath, framework);

  return {
    projectDirName,
    projectPath,
    staticPath,
    entryFiles: cfg.entryFiles,
  };
}

export async function preExtractMarkupAndStyles(
  outDir: string,
  projectPath: string,
  framework: FrameworkTarget
): Promise<void> {
  const indexHtmlPath = path.join(outDir, 'index.html');
  let html = '';
  try {
    html = await fs.readFile(indexHtmlPath, 'utf-8');
  } catch {
    return;
  }

  // 1. Extract <div id="svg-templates"> if present
  const svgMatch = html.match(/<div id=["']svg-templates["'][^>]*>([\s\S]*?)<\/div>/i);
  if (svgMatch) {
    const rawSvgInner = svgMatch[1].trim();
    if (rawSvgInner) {
      if (framework === 'nextjs' || framework === 'react-vite') {
        const compDir = path.join(projectPath, 'components');
        await fs.mkdir(compDir, { recursive: true });
        const svgCompPath = path.join(compDir, 'SvgTemplates.tsx');
        try {
          await fs.access(svgCompPath);
        } catch {
          const svgCode = `import React from 'react';

export default function SvgTemplates() {
  return (
    <div
      id="svg-templates"
      style={{
        position: 'absolute',
        overflow: 'hidden',
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        zIndex: 0,
        contain: 'strict',
      }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: String.raw\`${rawSvgInner}\`,
      }}
    />
  );
}
`;
          await fs.writeFile(svgCompPath, svgCode, 'utf-8');
        }
      }
    }
  }

  // 2. Extract <style> rules and copy styles/*.css to global stylesheet
  let combinedCss = '';
  const stylesDir = path.join(outDir, 'styles');
  try {
    const files = await fs.readdir(stylesDir);
    for (const file of files) {
      if (file.endsWith('.css')) {
        const cssContent = await fs.readFile(path.join(stylesDir, file), 'utf-8');
        combinedCss += `/* === ${file} === */\n` + cssContent + '\n\n';
      }
    }
  } catch {}

  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    combinedCss += match[1] + '\n\n';
  }

  if (combinedCss.trim()) {
    // Rewrite relative fonts/images url("assets/...") -> url("/assets/...")
    const normalizedCss = combinedCss.replace(/url\(\s*["']?(?:\.\/)?assets\//g, 'url("/assets/');

    let targetCssPath = '';
    if (framework === 'nextjs') {
      const appDir = path.join(projectPath, 'app');
      await fs.mkdir(appDir, { recursive: true });
      targetCssPath = path.join(appDir, 'globals.css');
    } else if (framework === 'react-vite') {
      const srcDir = path.join(projectPath, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      targetCssPath = path.join(srcDir, 'index.css');
    } else if (framework === 'vue-vite') {
      const srcDir = path.join(projectPath, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      targetCssPath = path.join(srcDir, 'style.css');
    } else if (framework === 'sveltekit') {
      const srcDir = path.join(projectPath, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      targetCssPath = path.join(srcDir, 'app.css');
    } else if (framework === 'astro') {
      const styleDir = path.join(projectPath, 'src', 'styles');
      await fs.mkdir(styleDir, { recursive: true });
      targetCssPath = path.join(styleDir, 'global.css');
    }

    if (targetCssPath) {
      try {
        await fs.access(targetCssPath);
      } catch {
        await fs.writeFile(targetCssPath, normalizedCss, 'utf-8');
      }
    }
  }
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
          react: '^19.3.1',
          'react-dom': '^19.3.1',
          'framer-motion': '^14.9.0',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@types/react': '^19.3.0',
          '@types/react-dom': '^19.3.0',
          '@vitejs/plugin-react': '^6.1.2',
          typescript: '^5.7.0',
          vite: '^8.3.5',
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
          next: '^16.4.3',
          react: '^19.3.1',
          'react-dom': '^19.3.1',
          'framer-motion': '^14.9.0',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@types/node': '^22',
          '@types/react': '^19.3.0',
          '@types/react-dom': '^19.3.0',
          typescript: '^5.7.0',
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
          vue: '^3.5.44',
        },
        devDependencies: {
          '@vitejs/plugin-vue': '^6.0.10',
          typescript: '^5.7.0',
          vite: '^8.3.5',
          'vue-tsc': '^2.2.0',
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
          '@sveltejs/kit': '^3.1.1',
          '@sveltejs/vite-plugin-svelte': '^5.0.0',
          svelte: '^5.57.3',
          typescript: '^5.7.0',
          vite: '^8.3.5',
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
          astro: '^7.4.4',
        },
        devDependencies: {
          typescript: '^5.7.0',
        },
      };
  }
}
