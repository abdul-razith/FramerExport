import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentPrompt } from '../../src/convert/runner/prompt.js';
import type { TaskRecord } from '../../src/convert/types.js';

test('buildAgentPrompt returns fixed prompt with task file', () => {
  const task: TaskRecord = {
    id: 'sec-home-hero',
    kind: 'section',
    file: '.convert/tasks/sec-home-hero.md',
    status: 'pending',
    attempts: 0,
    targets: ['src/sections/home/Hero.tsx', 'src/sections/home/Hero/'],
  };

  const prompt = buildAgentPrompt(task);
  assert.equal(
    prompt,
    "Read AGENTS.md and .convert/tasks/sec-home-hero.md, then complete that task. Edit only the files listed under Edit only. Do not run the check, the dev server or the build: the runner verifies your work as soon as you stop. Stop when your edits are finished."
  );
});

test('buildAgentPrompt accepts string path', () => {
  const prompt = buildAgentPrompt('.convert/tasks/shell-navigation.md');
  assert.equal(
    prompt,
    "Read AGENTS.md and .convert/tasks/shell-navigation.md, then complete that task. Edit only the files listed under Edit only. Do not run the check, the dev server or the build: the runner verifies your work as soon as you stop. Stop when your edits are finished."
  );
});

test('buildAgentPrompt rejects unsafe characters', () => {
  assert.throws(
    () => buildAgentPrompt({ file: 'tasks/foo"bar.md' } as TaskRecord),
    /Unsafe task file path/
  );
  assert.throws(
    () => buildAgentPrompt({ file: 'tasks/foo;rm -rf.md' } as TaskRecord),
    /Unsafe task file path/
  );
  assert.throws(
    () => buildAgentPrompt({ file: 'tasks/foo&bar.md' } as TaskRecord),
    /Unsafe task file path/
  );
  assert.throws(
    () => buildAgentPrompt({ file: 'tasks/foo`bar.md' } as TaskRecord),
    /Unsafe task file path/
  );
  assert.throws(
    () => buildAgentPrompt({ file: 'tasks/foo\nbar.md' } as TaskRecord),
    /Unsafe task file path/
  );
});

test('buildAgentPrompt contains no double quotes (they break .cmd argument quoting)', () => {
  assert.ok(!buildAgentPrompt('.convert/tasks/a b.md').includes('"'));
});
