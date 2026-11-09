import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderAuthError, ProviderRateLimitError, extractJson } from '../../src/nextjs/refine/types.js';
import { createOpenAiCompatible } from '../../src/nextjs/refine/openai-compatible.js';
import { createAgentCli, type ExecFn } from '../../src/nextjs/refine/agent-cli.js';
import { createAnthropic } from '../../src/nextjs/refine/anthropic.js';
import { detectAvailable, selectProvider } from '../../src/nextjs/refine/select.js';

const OPTS = { aiRefine: true, verify: true, cliSkipPermissions: true };
const SCHEMA = { type: 'object', properties: { edits: { type: 'array' } }, required: ['edits'] };

async function tmpImage(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fexport-img-'));
  const file = path.join(dir, 'shot.png');
  await fsp.writeFile(file, Buffer.from([137, 80, 78, 71]));
  return file;
}

test('extractJson accepts fenced or prose-wrapped JSON', () => {
  assert.equal(extractJson('{"edits":[]}'), '{"edits":[]}');
  assert.equal(extractJson('Sure!\n```json\n{"edits":[1]}\n```'), '{"edits":[1]}');
  assert.equal(extractJson('Here: {"edits":[{"a":"}"}]} done'), '{"edits":[{"a":"}"}]}');
  assert.throws(() => extractJson('no json'), /no JSON/);
});

test('selectProvider follows the auto order and never auto-picks anthropic', () => {
  assert.equal(selectProvider(OPTS, ['gemini', 'agy']), 'agy');
  assert.equal(selectProvider(OPTS, ['anthropic']), null);
  assert.equal(selectProvider({ ...OPTS, aiProvider: 'anthropic' }, ['anthropic']), 'anthropic');
  assert.throws(() => selectProvider({ ...OPTS, aiProvider: 'groq' }, []), /GROQ_API_KEY/);
});

test('detectAvailable uses env keys, CLI probes, and skips model-less providers without --ai-model', async () => {
  const probes = {
    cli: async (cmd: string) => cmd === 'agy',
    ollamaModels: async () => ['qwen2.5vl:7b'],
  };
  const env = { GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'o' } as NodeJS.ProcessEnv;
  assert.deepEqual(await detectAvailable(env, probes), ['agy', 'gemini', 'ollama']);
  assert.deepEqual(await detectAvailable(env, probes, 'some/model:free'), ['agy', 'gemini', 'openrouter', 'ollama']);
});

test('OpenAI-compatible provider sends auth and images, maps 429 and 401', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });
  let next = reply(200, { choices: [{ message: { content: '```json\n{"edits":[]}\n```' } }] });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return next;
  }) as unknown as typeof fetch;
  const p = createOpenAiCompatible('groq', { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm', supportsImages: true, rpm: 30 }, fakeFetch);
  const image = await tmpImage();
  assert.equal(await p.complete({ system: 's', user: 'u', images: [image], schema: SCHEMA }), '{"edits":[]}');
  assert.equal(calls[0].url, 'https://api.test/v1/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer k');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'm');
  assert.equal(body.messages[1].content[1].type, 'image_url');
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/);

  const noImages = createOpenAiCompatible('gemini', { baseUrl: 'https://api.test/v1', apiKey: 'k', model: 'm', supportsImages: false, rpm: 30 }, fakeFetch);
  next = reply(200, { choices: [{ message: { content: '{"edits":[]}' } }] });
  await noImages.complete({ system: 's', user: 'u', images: [image], schema: SCHEMA });
  assert.equal(typeof JSON.parse(String(calls[1].init.body)).messages[1].content, 'string');

  next = reply(429, { error: 'slow down' }, { 'retry-after': '3' });
  await assert.rejects(p.complete({ system: 's', user: 'u', schema: SCHEMA }), (e: unknown) => e instanceof ProviderRateLimitError && e.retryAfterMs === 3000);
  next = reply(401, { error: 'bad key' });
  await assert.rejects(p.complete({ system: 's', user: 'u', schema: SCHEMA }), ProviderAuthError);
});

test('agy runs in a throwaway sandbox with the prompt in a file', async () => {
  const sandboxRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fexport-sbx-'));
  const seen: { cmd: string; args: string[]; cwd: string; files: string[] }[] = [];
  const exec: ExecFn = async (cmd, args, { cwd }) => {
    seen.push({ cmd, args, cwd, files: fs.readdirSync(cwd).sort() });
    return { code: 0, stdout: JSON.stringify({ status: 'SUCCESS', response: '{"edits":[]}\n' }), stderr: '' };
  };
  const agy = createAgentCli('agy', { skipPermissions: true, sandboxRoot }, exec);
  const image = await tmpImage();
  assert.equal(await agy.complete({ system: 's', user: 'u', images: [image], schema: SCHEMA }), '{"edits":[]}');
  const call = seen[0];
  assert.equal(call.cmd, 'agy');
  assert.ok(call.cwd.startsWith(sandboxRoot));
  assert.deepEqual(call.files, ['image-1.png', 'prompt.md', 'schema.json']);
  for (const flag of ['--output-format', '--json-schema', '--sandbox', '--dangerously-skip-permissions']) assert.ok(call.args.includes(flag), flag);
  assert.equal(call.args[call.args.length - 2], '-p', 'prompt is the last -p value');
  assert.equal(fs.existsSync(call.cwd), false, 'sandbox removed after success');

  const noSkip = createAgentCli('agy', { skipPermissions: false, sandboxRoot }, exec);
  await noSkip.complete({ system: 's', user: 'u', schema: SCHEMA });
  assert.equal(seen[1].args.includes('--dangerously-skip-permissions'), false);

  const failing = createAgentCli('agy', { skipPermissions: true, sandboxRoot }, async (_c, _a, { cwd }) => {
    seen.push({ cmd: 'x', args: [], cwd, files: [] });
    return { code: 1, stdout: '', stderr: 'boom' };
  });
  await assert.rejects(failing.complete({ system: 's', user: 'u', schema: SCHEMA }), /boom/);
  assert.equal(fs.existsSync(seen[2].cwd), false, 'sandbox removed after failure');
});

test('claude-code reads the prompt on stdin and returns the result field', async () => {
  const sandboxRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fexport-sbx-'));
  let input = '';
  let args: string[] = [];
  const cc = createAgentCli('claude-code', { skipPermissions: true, sandboxRoot }, async (cmd, a, opts) => {
    assert.equal(cmd, 'claude');
    args = a;
    input = opts.input ?? '';
    return { code: 0, stdout: JSON.stringify({ result: '{"edits":[]}' }), stderr: '' };
  });
  assert.equal(await cc.complete({ system: 'SYS', user: 'USER', schema: SCHEMA }), '{"edits":[]}');
  assert.deepEqual(args.slice(0, 3), ['-p', '--output-format', 'json']);
  assert.match(input, /SYS[\s\S]*USER/);
});

test('anthropic provider calls the SDK with fallbacks and a JSON schema', async () => {
  let params: Record<string, unknown> = {};
  const fakeClient = {
    beta: {
      messages: {
        create: async (p: Record<string, unknown>) => {
          params = p;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"edits":[]}' }] };
        },
      },
    },
  };
  const p = createAnthropic({ model: 'claude-opus-5-5' }, async () => fakeClient as never);
  assert.equal(await p.complete({ system: 's', user: 'u', schema: SCHEMA }), '{"edits":[]}');
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual((params.output_config as { format: unknown }).format, { type: 'json_schema', schema: SCHEMA });
});
