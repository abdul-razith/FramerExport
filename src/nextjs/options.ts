export const PROVIDER_IDS = [
  'claude-code',
  'agy',
  'gemini',
  'groq',
  'openrouter',
  'github',
  'ollama',
  'anthropic',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface NextjsOptions {
  aiRefine: boolean;
  aiProvider?: ProviderId;
  aiModel?: string;
  verify: boolean;
  cliSkipPermissions: boolean;
}

function takeFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

function takeValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(idx, 2);
  return value;
}

/** Parses and removes the Next.js conversion flags from `args`. */
export function parseNextjsFlags(args: string[]): { enabled: boolean; options: NextjsOptions } {
  const enabled = takeFlag(args, '--nextjs');
  const aiRefine = takeFlag(args, '--ai-refine');
  const provider = takeValue(args, '--ai-provider');
  const aiModel = takeValue(args, '--ai-model');
  const noVerify = takeFlag(args, '--no-verify');
  const skip = takeValue(args, '--ai-cli-skip-permissions');

  if (provider !== undefined && !(PROVIDER_IDS as readonly string[]).includes(provider)) {
    throw new Error(
      `Unknown --ai-provider "${provider}". Valid providers: ${PROVIDER_IDS.join(', ')}`
    );
  }
  if (skip !== undefined && skip !== 'true' && skip !== 'false') {
    throw new Error('--ai-cli-skip-permissions must be "true" or "false"');
  }

  const options: NextjsOptions = {
    aiRefine,
    ...(provider !== undefined ? { aiProvider: provider as ProviderId } : {}),
    ...(aiModel !== undefined ? { aiModel } : {}),
    verify: !noVerify,
    cliSkipPermissions: skip !== 'false',
  };
  return { enabled, options };
}
