import type { StageContext } from '../adapters/types.js';
import { saveState } from '../state.js';
import { npmCommand, spawnManaged } from '../verify/proc.js';

export interface InstallDeps {
  npm?: (cwd: string) => Promise<{ code: number; tail: string }>;
}

export function defaultNpm(cwd: string): Promise<{ code: number; tail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const proc = spawnManaged(npmCommand, ['install'], { cwd });
    proc.child.stdout?.resume();
    let err = '';
    proc.child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    proc.child.on('error', (e) => {
      if (settled) return;
      settled = true;
      resolve({ code: 1, tail: e.message });
    });
    proc.child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({
        code: code ?? 1,
        tail: err.split(/\r?\n/).filter(Boolean).slice(-20).join('\n'),
      });
    });
  });
}

export async function runInstall(ctx: StageContext, deps?: InstallDeps): Promise<void> {
  const npm = deps?.npm ?? defaultNpm;
  const { code, tail } = await npm(ctx.nextDir);
  if (code === 0) {
    ctx.state.stages.install = 'done';
    ctx.log?.('install: dependencies installed');
  } else {
    ctx.state.stages.install = 'failed';
    const prefix = `install: npm install failed (exit ${code})`;
    const warning = tail ? `${prefix}\n${tail}` : prefix;
    ctx.state.warnings.push(warning);
    ctx.log?.(prefix);
  }
  await saveState(ctx.state);
}
