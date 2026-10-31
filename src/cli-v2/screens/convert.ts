import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import {
  detectInstalledAgents,
  type AgentToolId,
  type AgentToolStatus,
} from '../utils/tool-check.js';
import { spawnAgentWindow } from '../utils/terminal-spawn.js';
import { scaffoldFrameworkStarter } from '../utils/scaffold.js';
import {
  buildSuperpowersInstructions,
  buildConversionSpec,
  FRAMEWORK_CONFIGS,
  type FrameworkTarget,
} from '../utils/superpowers-template.js';
import { uiSelect, uiConfirm, uiNote, formatShortcutHint } from '../ui/prompts.js';
import type { ExportSummary } from './export.js';

export interface AgentResolution {
  status: 'available' | 'missing-alternatives-available' | 'none-available';
  selectedAgent?: AgentToolId | string;
  availableAlternatives: string[];
}

export function resolveAgentSelection(
  chosenId: string,
  installed: AgentToolStatus[]
): AgentResolution {
  const target = installed.find((t) => t.id === chosenId);
  if (target && target.available) {
    return {
      status: 'available',
      selectedAgent: chosenId,
      availableAlternatives: installed.filter((t) => t.available).map((t) => t.id as string),
    };
  }

  const availableTools = installed.filter((t) => t.available).map((t) => t.id as string);
  if (availableTools.length > 0) {
    return {
      status: 'missing-alternatives-available',
      availableAlternatives: availableTools,
    };
  }

  return {
    status: 'none-available',
    availableAlternatives: [],
  };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const commands =
    process.platform === 'win32'
      ? [{ command: 'clip', args: [] }]
      : process.platform === 'darwin'
        ? [{ command: 'pbcopy', args: [] }]
        : [
            { command: 'wl-copy', args: [] },
            { command: 'xclip', args: ['-selection', 'clipboard'] },
            { command: 'xsel', args: ['--clipboard', '--input'] },
          ];

  for (const item of commands) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(item.command, item.args, { stdio: ['pipe', 'ignore', 'pipe'] });
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
        child.stdin?.end(text);
      });
      return true;
    } catch {}
  }
  return false;
}

export async function runScreenConvert(summary: ExportSummary): Promise<void> {
  // 1. Choose Target Tech Stack
  const frameworkChoices = (Object.keys(FRAMEWORK_CONFIGS) as FrameworkTarget[]).map((key) => ({
    label: FRAMEWORK_CONFIGS[key].name,
    value: key,
    hint: FRAMEWORK_CONFIGS[key].stack,
  }));

  const selectedFramework = await uiSelect<FrameworkTarget>(
    `Step 5/5: Select Target Tech Stack ${formatShortcutHint('Enter', 'select')}`,
    frameworkChoices,
    'nextjs'
  );

  const cfg = FRAMEWORK_CONFIGS[selectedFramework];

  // 2. Choose AI Coding Agent
  const agentChoices = [
    { label: 'Claude Code', value: 'claude', hint: 'Anthropic Claude Code CLI' },
    { label: 'AGY (Antigravity CLI)', value: 'agy', hint: 'Google Antigravity Agent CLI' },
    { label: 'Codex', value: 'codex', hint: 'Codex Coding Agent' },
  ];

  let selectedAgent = await uiSelect<string>(
    `Choose AI Coding Agent for Conversion ${formatShortcutHint('Enter', 'select')}`,
    agentChoices,
    'claude'
  );

  // 3. Tool PATH Validation
  const installedAgents = await detectInstalledAgents(['claude', 'codex', 'agy']);
  let resolution = resolveAgentSelection(selectedAgent, installedAgents);

  if (resolution.status === 'missing-alternatives-available') {
    uiNote(
      `'${selectedAgent}' was not detected on your system PATH.\nInstalled alternative agents: ${resolution.availableAlternatives.join(', ')}`,
      'Agent Tool Detection'
    );

    const switchChoice = await uiSelect<string>(
      'Switch to an installed tool or proceed with manual setup?',
      [
        ...resolution.availableAlternatives.map((alt) => ({
          label: `Use ${alt}`,
          value: alt,
        })),
        { label: 'Manual LLM / IDE Workflow (Cursor, VS Code)', value: 'manual' },
      ],
      resolution.availableAlternatives[0]
    );

    if (switchChoice === 'manual') {
      resolution = { status: 'none-available', availableAlternatives: [] };
    } else {
      selectedAgent = switchChoice;
      resolution = { status: 'available', selectedAgent, availableAlternatives: resolution.availableAlternatives };
    }
  }

  // 4. Pre-scaffold framework workspace & copy assets
  const scaffoldResult = await scaffoldFrameworkStarter(summary.outDir, selectedFramework);

  // 5. Generate Superpowers Directives & Conversion Spec
  const conversionCtx = {
    framework: selectedFramework,
    projectDirName: scaffoldResult.projectDirName,
    sourceUrl: summary.sourceUrl,
    platform: summary.platformName,
    outDir: summary.outDir,
    counts: summary.counts,
  };

  const specContent = buildConversionSpec(conversionCtx);
  const { claudeMd, agentsMd } = buildSuperpowersInstructions(conversionCtx);

  const specPath = path.join(summary.outDir, 'CONVERSION_SPEC.md');
  const claudeMdPath = path.join(summary.outDir, 'CLAUDE.md');
  const agentsMdPath = path.join(summary.outDir, 'AGENTS.md');

  await fs.writeFile(specPath, specContent, 'utf-8');
  await fs.writeFile(claudeMdPath, claudeMd, 'utf-8');
  await fs.writeFile(agentsMdPath, agentsMd, 'utf-8');

  // Copy prompt brief to clipboard
  const copied = await copyToClipboard(specContent);

  // 6. Branch: Manual Mode vs Automated Spawn Mode
  if (resolution.status === 'none-available') {
    uiNote(
      `No supported automated coding agents (claude, codex, agy) were detected on your system PATH.`,
      'Manual Mode'
    );

    const manualCard = [
      chalk.green('✓ Framework starter initialized: ') + scaffoldResult.projectDirName,
      chalk.green('✓ Static assets transferred to: ') + `${scaffoldResult.projectDirName}/${cfg.staticDir}/assets`,
      chalk.green('✓ Superpowers specifications created: ') + 'CONVERSION_SPEC.md, CLAUDE.md, AGENTS.md',
      copied ? chalk.cyan('✓ Conversion brief copied to your clipboard!') : '',
      '',
      chalk.bold('Next Steps for Manual Conversion:'),
      `1. Open your project folder in your IDE: ${chalk.underline(summary.outDir)}`,
      `2. Open your AI Assistant (Cursor, VS Code Copilot, Antigravity, or Web LLM).`,
      copied
        ? `3. Paste the conversion brief from your clipboard to begin the verified rebuild.`
        : `3. Copy the instructions from ${chalk.underline('CONVERSION_SPEC.md')} into your AI assistant.`,
    ]
      .filter(Boolean)
      .join('\n');

    uiNote(manualCard, 'Manual LLM IDE Mode Ready');
    return;
  }

  // Permission Check for Spawning Terminal Window
  const confirmed = await uiConfirm(
    `Launch '${selectedAgent}' in a new separate terminal window to execute the conversion?`
  );

  if (!confirmed) {
    uiNote(
      `Files are ready in ${summary.outDir}.\nConversion brief copied to clipboard. You can launch '${selectedAgent}' manually whenever you are ready.`,
      'Manual Conversion Ready'
    );
    return;
  }

  // 7. Execute spawn in separate window
  const kickoffTask = `Read CONVERSION_SPEC.md and follow ${
    selectedAgent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'
  } using Superpowers to rebuild this site into ${scaffoldResult.projectDirName}`;

  const spawnResult = spawnAgentWindow({
    workingDir: summary.outDir,
    agentId: selectedAgent,
    taskPrompt: kickoffTask,
  });

  if (spawnResult.success) {
    uiNote(
      `Launched ${selectedAgent} in a new window!\nWorking Directory: ${summary.outDir}\nTarget Directory:  ${scaffoldResult.projectDirName}`,
      'Conversion Agent Started'
    );
  } else {
    uiNote(
      `Could not spawn terminal window: ${spawnResult.error || 'Unknown error'}\nRun command manually:\n  cd "${summary.outDir}" && ${selectedAgent} "${kickoffTask}"`,
      'Spawn Notice'
    );
  }
}
