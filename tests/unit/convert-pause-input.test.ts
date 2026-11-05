import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPauseController } from '../../src/convert/runner/pool.js';
import { createPauseInput } from '../../src/convert/runner/pause-input.js';

test('I1: without a prompt the first interrupt finishes running tasks then pauses, the second pauses now', () => {
  const pause = createPauseController();
  const input = createPauseInput(pause);
  input.interrupt();
  assert.equal(pause.mode, 'after-running');
  input.interrupt();
  assert.equal(pause.mode, 'now');
});

test('I1: with a prompt the first interrupt asks and applies the chosen mode', async () => {
  const pause = createPauseController();
  let asked = 0;
  const input = createPauseInput(pause, {
    ask: async () => {
      asked++;
      return 'after-running';
    },
  });
  input.interrupt();
  assert.equal(pause.mode, 'none', 'nothing is requested before the user answers');
  await new Promise((r) => setImmediate(r));
  assert.equal(asked, 1);
  assert.equal(pause.mode, 'after-running');
});

test('I1: Ctrl+C while the prompt is open, or cancelling it, pauses now; P never escalates', async () => {
  const pause = createPauseController();
  let answer!: (v: 'after-running' | 'now' | null) => void;
  const input = createPauseInput(pause, {
    ask: () => new Promise((resolve) => (answer = resolve)),
  });
  input.pressP();
  input.pressP();
  assert.equal(pause.mode, 'none');
  input.interrupt();
  assert.equal(pause.mode, 'now');
  answer('after-running');
  await new Promise((r) => setImmediate(r));
  assert.equal(pause.mode, 'now', 'a late answer does not downgrade pause-now');

  const pause2 = createPauseController();
  const input2 = createPauseInput(pause2, { ask: async () => null });
  input2.pressP();
  await new Promise((r) => setImmediate(r));
  assert.equal(pause2.mode, 'now', 'cancelling the prompt pauses now');
});
