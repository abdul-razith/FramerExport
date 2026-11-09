import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRefine } from '../../src/nextjs/refine/index.js';
import { ProviderAuthError, type LlmProvider, type LlmRequest } from '../../src/nextjs/refine/types.js';
import { planComponents } from '../../src/nextjs/components.js';
import { extractContent, ImageNamer } from '../../src/nextjs/content.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { ProjectModel } from '../../src/nextjs/emit/project.js';
import type { ConversionContext, Node, PageModel, Style } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}
const text = (tag: string, name: string, value: string) => n(tag, { framerName: name, text: value, styles: { base: { color: 'rgb(19, 51, 36)' } } });

function model(): ProjectModel {
  const pages: PageModel[] = [
    {
      route: '/',
      sourceUrl: 'https://x.test/',
      title: 'Home',
      meta: {},
      screenshots: { base: '', tablet: '', mobile: '' },
      root: n('body', {}, [
        n('div', {}, [
          n('section', { framerName: 'Hero Section' }, [text('h1', 'Heading', 'Hi')]),
          n('section', { framerName: 'Content' }, [text('p', 'Text', 'Body')]),
        ]),
      ]),
    },
  ];
  const report = emptyReport();
  const images = new ImageNamer();
  const plan = planComponents(pages, report);
  const { files, bindings } = extractContent(plan, report, images);
  return {
    siteName: 'X', siteOrigin: 'https://x.test', exportDir: '', tokens: collectTokens(pages.map((p) => p.root)),
    fonts: [], plan, content: files, bindings, collections: [], pages, motion: new Set(), images,
  };
}

async function ctx(): Promise<ConversionContext> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-refine-'));
  return {
    exportDir: dir, sourceUrl: 'https://x.test/', outDir: dir, cacheDir: path.join(dir, 'cache'),
    options: { aiRefine: true, verify: false, cliSkipPermissions: true }, report: emptyReport(), log: () => {},
  };
}

/** Answers per unit: matches the request text against `rules`, else no edits. */
function fakeProvider(rules: [RegExp, string | Error][]): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    id: 'gemini', model: 'fake', supportsImages: false, rpm: 60000, calls,
    async complete(req) {
      calls.push(req);
      for (const [re, reply] of rules) {
        if (re.test(req.user)) {
          if (reply instanceof Error) throw reply;
          return reply;
        }
      }
      return '{"edits":[]}';
    },
  };
}

const ok = async () => ({ buildOk: true, minSimilarity: 1 });

test('accepted edits rename components and tokens', async () => {
  const provider = fakeProvider([
    [/Colour tokens/, '{"edits":[{"op":"renameToken","from":"green-900","to":"ink"}]}'],
    [/Component: Content\b/, '{"edits":[{"op":"renameComponent","from":"Content","to":"Intro"}]}'],
  ]);
  const c = await ctx();
  const out = await runRefine(model(), c, { provider, verify: ok });
  assert.equal(out.tokens.colors.ink, '#133324');
  assert.deepEqual(out.plan.pages[0].sections.map((s) => s.name), ['Hero', 'Intro']);
  assert.equal(c.report.refine?.accepted, 2);
  assert.equal(c.report.refine?.provider, 'gemini');
});

test('a change that fails the visual check is reverted', async () => {
  const provider = fakeProvider([[/Component: Hero\b/, '{"edits":[{"op":"renameComponent","from":"Hero","to":"Banner"}]}']]);
  const c = await ctx();
  const out = await runRefine(model(), c, { provider, verify: async () => ({ buildOk: true, minSimilarity: 0.9 }) });
  assert.equal(out.plan.pages[0].sections[0].name, 'Hero');
  assert.match(c.report.refine!.rejected[0].reason, /similarity/);
});

test('an auth error stops the loop but keeps earlier accepted edits', async () => {
  const provider = fakeProvider([
    [/Colour tokens/, '{"edits":[{"op":"renameToken","from":"green-900","to":"ink"}]}'],
    [/Component: Hero\b/, new ProviderAuthError('bad key')],
  ]);
  const c = await ctx();
  const out = await runRefine(model(), c, { provider, verify: ok });
  assert.equal(out.tokens.colors.ink, '#133324');
  assert.match(c.report.refine!.stoppedEarly!, /bad key/);
});

test('cached replies are reused without calling the provider again', async () => {
  const c = await ctx();
  const first = fakeProvider([[/Component: Content\b/, '{"edits":[{"op":"renameComponent","from":"Content","to":"Intro"}]}']]);
  await runRefine(model(), c, { provider: first, verify: ok });
  assert.ok(first.calls.length > 0);
  const second = fakeProvider([]);
  c.report = emptyReport();
  const out = await runRefine(model(), c, { provider: second, verify: ok });
  assert.equal(second.calls.length, 0);
  assert.equal(out.plan.pages[0].sections[1].name, 'Intro');
});

test('invalid replies are rejected and the loop continues', async () => {
  const provider = fakeProvider([
    [/Colour tokens/, 'sorry, no'],
    [/Component: Content\b/, '{"edits":[{"op":"renameComponent","from":"Content","to":"Intro"}]}'],
  ]);
  const c = await ctx();
  const out = await runRefine(model(), c, { provider, verify: ok });
  assert.equal(out.plan.pages[0].sections[1].name, 'Intro');
  assert.ok(c.report.refine!.rejected.some((r) => r.section === 'theme' && /invalid edits/.test(r.reason)));
});

test('without an available provider the model is returned unchanged', async () => {
  const c = await ctx();
  const m = model();
  const out = await runRefine(m, c, { provider: null, verify: ok });
  assert.equal(out, m);
});
