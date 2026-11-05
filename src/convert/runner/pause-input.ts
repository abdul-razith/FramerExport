import type { PauseController } from './pool.js';

export type PauseChoice = 'after-running' | 'now';

export interface PauseInputOptions {
  /** Asks the user how to pause; resolves null when the prompt was cancelled (treated as "pause now"). */
  ask?: () => Promise<PauseChoice | null>;
  log?: (message: string) => void;
  /** Called after a prompt closed (e.g. to put the terminal back into raw mode). */
  afterAsk?: () => void;
}

export interface PauseInput {
  /** Ctrl+C or SIGINT. */
  interrupt(): void;
  /** The `P` key: same as the first interrupt, never escalates to "pause now". */
  pressP(): void;
}

/**
 * Spec 7a: the first Ctrl+C or `P` offers "Finish running tasks, then pause" / "Pause now"; a second Ctrl+C
 * (or cancelling the prompt) pauses now. Without a prompt (no TTY) the first Ctrl+C finishes running tasks
 * and pauses, the second pauses now.
 */
export function createPauseInput(pause: PauseController, opts: PauseInputOptions = {}): PauseInput {
  let prompting = false;

  const ask = (): void => {
    prompting = true;
    void opts
      .ask!()
      .then((choice) => {
        if (pause.mode !== 'now') pause.request(choice ?? 'now');
      })
      .catch(() => pause.request('now'))
      .finally(() => {
        prompting = false;
        opts.afterAsk?.();
      });
  };

  const first = (): void => {
    if (opts.ask) {
      ask();
    } else {
      opts.log?.('Pausing after running tasks... (press Ctrl+C again to pause now)');
      pause.request('after-running');
    }
  };

  return {
    interrupt() {
      if (pause.mode === 'now') return;
      if (prompting || pause.mode === 'after-running') {
        opts.log?.('Pausing now...');
        pause.request('now');
        return;
      }
      first();
    },
    pressP() {
      if (prompting || pause.mode !== 'none') return;
      first();
    },
  };
}
