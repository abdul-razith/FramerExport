import fs from 'node:fs/promises';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { extractJson, ProviderAuthError, ProviderRateLimitError, type LlmProvider, type LlmRequest } from './types.js';

type ClientFactory = () => Promise<Anthropic>;

const MEDIA: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const defaultFactory: ClientFactory = async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic();
};

/** Claude via the official SDK (paid API; never auto-selected). */
export function createAnthropic(
  cfg: { model: string },
  clientFactory: ClientFactory = defaultFactory
): LlmProvider {
  let client: Anthropic | undefined;
  return {
    id: 'anthropic',
    model: cfg.model,
    supportsImages: true,
    rpm: 50,
    async complete(req: LlmRequest): Promise<string> {
      client ??= await clientFactory();
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      for (const file of req.images ?? []) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: MEDIA[path.extname(file).toLowerCase()] ?? 'image/png',
            data: (await fs.readFile(file)).toString('base64'),
          },
        });
      }
      content.push({ type: 'text', text: req.user });
      try {
        const response = await client.beta.messages.create({
          model: cfg.model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: req.system,
          output_config: { format: { type: 'json_schema', schema: req.schema as Record<string, unknown> } },
          messages: [{ role: 'user', content }],
        });
        if (response.stop_reason === 'refusal') throw new Error('anthropic: request declined (refusal)');
        const text = response.content
          .map((b) => (b.type === 'text' ? b.text : ''))
          .join('');
        return extractJson(text);
      } catch (e) {
        const { default: SDK } = await import('@anthropic-ai/sdk').catch(() => ({ default: undefined }));
        if (SDK && e instanceof SDK.RateLimitError) throw new ProviderRateLimitError('anthropic: rate limited');
        if (SDK && (e instanceof SDK.AuthenticationError || e instanceof SDK.PermissionDeniedError)) {
          throw new ProviderAuthError('anthropic: authentication failed');
        }
        throw e;
      }
    },
  };
}
