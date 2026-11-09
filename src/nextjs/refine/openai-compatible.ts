import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractJson,
  INSTRUCTION_JSON,
  ProviderAuthError,
  ProviderRateLimitError,
  type LlmProvider,
  type LlmRequest,
  type ProviderId,
} from './types.js';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  supportsImages: boolean;
  rpm: number;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Chat Completions client shared by Gemini, Groq, OpenRouter, GitHub Models and Ollama. */
export function createOpenAiCompatible(
  id: ProviderId,
  cfg: OpenAiCompatibleConfig,
  fetchImpl: typeof fetch = fetch
): LlmProvider {
  return {
    id,
    model: cfg.model,
    supportsImages: cfg.supportsImages,
    rpm: cfg.rpm,
    async complete(req: LlmRequest): Promise<string> {
      const text = `${req.user}\n\n${INSTRUCTION_JSON}\n${JSON.stringify(req.schema)}`;
      let content: unknown = text;
      if (cfg.supportsImages && req.images?.length) {
        const parts: unknown[] = [{ type: 'text', text }];
        for (const file of req.images) {
          const data = (await fs.readFile(file)).toString('base64');
          const mime = MIME[path.extname(file).toLowerCase()] ?? 'image/png';
          parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } });
        }
        content = parts;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
      const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content },
          ],
        }),
      });
      if (res.status === 429) {
        const after = Number(res.headers.get('retry-after'));
        throw new ProviderRateLimitError(`${id}: rate limited`, Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderAuthError(`${id}: authentication failed (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`${id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return extractJson(body.choices?.[0]?.message?.content ?? '');
    },
  };
}
