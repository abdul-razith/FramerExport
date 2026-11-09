import type { ProviderId } from '../options.js';

export type { ProviderId };

export interface LlmRequest {
  system: string;
  user: string;
  /** Screenshot file paths; ignored by providers without image support. */
  images?: string[];
  /** JSON Schema the reply must satisfy. */
  schema: object;
}

export interface LlmProvider {
  id: ProviderId;
  model: string;
  supportsImages: boolean;
  /** Client-side request budget per minute. */
  rpm: number;
  /** Returns the reply's JSON text. */
  complete(req: LlmRequest): Promise<string>;
}

export class ProviderRateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number
  ) {
    super(message);
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

/** First balanced JSON object in a reply, tolerating code fences and surrounding prose. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('Provider reply contained no JSON object');
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('Provider reply contained no JSON object (unbalanced braces)');
}

export const INSTRUCTION_JSON =
  'Answer with a single JSON object that matches this JSON Schema, and nothing else:';
