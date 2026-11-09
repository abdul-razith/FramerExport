import { defaultExec } from './agent-cli.js';
import type { NextjsOptions, ProviderId } from '../options.js';
import type { LlmProvider } from './types.js';

export interface ProviderDefault {
  baseUrl?: string;
  envKey?: string;
  /** Undefined → the user must pass --ai-model. */
  model?: string;
  supportsImages: boolean;
  rpm: number;
}

/**
 * Sources (checked 2026-11-09):
 *  - Gemini OpenAI compatibility: https://aistudio.google.com/docs/openai
 *  - Groq vision models / base URL: https://console.groq.com/docs/vision
 *  - OpenRouter free-model limits (20 RPM, 50/day under 10 credits): https://openrouter.ai/docs/api/reference/limits
 * Free-tier limits vary per account; rpm values are conservative client-side budgets.
 */
export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderDefault> = {
  'claude-code': { supportsImages: true, rpm: 10 },
  agy: { supportsImages: true, rpm: 10 },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GEMINI_API_KEY',
    model: 'gemini-3.8-flash',
    supportsImages: true,
    rpm: 10,
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    model: 'qwen/qwen3.8-27b',
    supportsImages: true,
    rpm: 20,
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY', supportsImages: false, rpm: 20 },
  github: { baseUrl: 'https://models.github.ai/inference', envKey: 'GITHUB_TOKEN', supportsImages: false, rpm: 10 },
  ollama: { baseUrl: 'http://localhost:11434/v1', supportsImages: false, rpm: 60 },
  anthropic: { envKey: 'ANTHROPIC_API_KEY', model: 'claude-opus-5-5', supportsImages: true, rpm: 50 },
};

export const AUTO_ORDER: ProviderId[] = ['claude-code', 'agy', 'gemini', 'groq', 'openrouter', 'github', 'ollama'];

export interface Probes {
  cli(cmd: string): Promise<boolean>;
  ollamaModels(): Promise<string[]>;
}

export const defaultProbes: Probes = {
  async cli(cmd) {
    const r = await defaultExec(cmd, ['--version'], { cwd: process.cwd(), timeoutMs: 15000 });
    return r.code === 0;
  },
  async ollamaModels() {
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return [];
      const body = (await res.json()) as { models?: { name: string }[] };
      return (body.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  },
};

/** Providers usable right now, in auto-selection order (anthropic last, only with its key). */
export async function detectAvailable(
  env: NodeJS.ProcessEnv = process.env,
  probes: Probes = defaultProbes,
  aiModel?: string
): Promise<ProviderId[]> {
  const out: ProviderId[] = [];
  if (await probes.cli('claude')) out.push('claude-code');
  if (await probes.cli('agy')) out.push('agy');
  for (const id of ['gemini', 'groq', 'openrouter', 'github'] as const) {
    const d = PROVIDER_DEFAULTS[id];
    if (env[d.envKey!] && (d.model || aiModel)) out.push(id);
  }
  if ((await probes.ollamaModels()).length) out.push('ollama');
  if (env.ANTHROPIC_API_KEY) out.push('anthropic');
  return out;
}

function unavailableReason(id: ProviderId): string {
  if (id === 'claude-code') return 'the `claude` CLI was not found (install Claude Code and log in)';
  if (id === 'agy') return 'the `agy` CLI was not found (install Antigravity CLI and log in)';
  if (id === 'ollama') return 'no Ollama models found at http://localhost:11434 (run `ollama pull <model>`)';
  const d = PROVIDER_DEFAULTS[id];
  return `set ${d.envKey}${d.model ? '' : ' and pass --ai-model <model>'}`;
}

/** Explicit choice must be available; otherwise the first available provider in AUTO_ORDER. */
export function selectProvider(opts: NextjsOptions, available: ProviderId[]): ProviderId | null {
  if (opts.aiProvider) {
    if (!available.includes(opts.aiProvider)) {
      throw new Error(`AI provider "${opts.aiProvider}" is not available: ${unavailableReason(opts.aiProvider)}`);
    }
    return opts.aiProvider;
  }
  return AUTO_ORDER.find((id) => available.includes(id)) ?? null;
}

/** Builds the concrete provider for `id`. */
export async function createProvider(
  id: ProviderId,
  opts: NextjsOptions,
  sandboxRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  probes: Probes = defaultProbes
): Promise<LlmProvider> {
  if (id === 'claude-code' || id === 'agy') {
    const { createAgentCli } = await import('./agent-cli.js');
    return createAgentCli(id, { model: opts.aiModel, skipPermissions: opts.cliSkipPermissions, sandboxRoot });
  }
  if (id === 'anthropic') {
    const { createAnthropic } = await import('./anthropic.js');
    return createAnthropic({ model: opts.aiModel ?? PROVIDER_DEFAULTS.anthropic.model! });
  }
  const d = PROVIDER_DEFAULTS[id];
  const model = opts.aiModel ?? d.model ?? (id === 'ollama' ? (await probes.ollamaModels())[0] : undefined);
  if (!model) throw new Error(`AI provider "${id}" needs --ai-model <model>`);
  const { createOpenAiCompatible } = await import('./openai-compatible.js');
  return createOpenAiCompatible(id, {
    baseUrl: d.baseUrl!,
    apiKey: d.envKey ? env[d.envKey] : undefined,
    model,
    supportsImages: d.supportsImages,
    rpm: d.rpm,
  });
}
