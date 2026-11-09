import { ProviderRateLimitError } from './types.js';

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRIES = 5;

/** Keeps calls at least 60000/rpm ms apart and retries rate-limited calls with backoff. */
export class Throttle {
  private last = -Infinity;
  private readonly interval: number;

  constructor(
    rpm: number,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = defaultSleep
  ) {
    this.interval = 60000 / Math.max(1, rpm);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.interval - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ProviderRateLimitError) || attempt >= MAX_RETRIES) throw e;
        await this.sleep(e.retryAfterMs ?? 2000 * 2 ** attempt);
      }
    }
  }
}
