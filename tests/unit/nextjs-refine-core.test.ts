import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyEdits, ForbiddenEditError, InvalidEditsError, parseEdits } from '../../src/nextjs/refine/edits.js';
import { Throttle } from '../../src/nextjs/refine/throttle.js';
import { RefineCache } from '../../src/nextjs/refine/cache.js';
import { ProviderRateLimitError } from '../../src/nextjs/refine/types.js';
import { planComponents } from '../../src/nextjs/components.js';
import { extractContent, ImageNamer } from '../../src/nextjs/content.js';
import { collectTokens } from '../../src/nextjs/tokens.js';
import { toTailwind } from '../../src/nextjs/tailwind.js';
import { emptyReport } from '../../src/nextjs/report.js';
import type { ProjectModel } from '../../src/nextjs/emit/project.js';
import type { Node, PageModel, Style } from '../../src/nextjs/model.js';

let seq = 0;
function n(tag: string, extra: Partial<Node> = {}, children: Node[] = []): Node {
  const key = `${tag}:${seq++}`;
  return { id: key, key, tag, attrs: {}, styles: { base: {} as Style }, children, ...extra };
}
const text = (tag: string, name: string, value: string, base: Style = {}) => n(tag, { framerName: name, text: value, styles: { base } });
const card = (t: string) => n('div', { framerName: 'Card', styles: { base: { display: 'flex' } } }, [text('h3', 'Title', t), text('p', 'Body', t + ' body')]);

function model(): ProjectModel {
  const wrapper = n('div', { framerName: 'Wrapper' }, [text('h1', 'Heading', 'Hi', { color: 'rgb(19, 51, 36)' })]);
  const styled = n('div', { framerName: 'Styled', styles: { base: { display: 'flex' } } }, [text('p', 'Note', 'x')]);
  const pages: PageModel[] = [
    {
      route: '/',
      sourceUrl: 'https://x.test/',
      title: 'Home',
      meta: {},
      screenshots: { base: '', tablet: '', mobile: '' },
      root: n('body', {}, [
        n('div', {}, [
          n('section', { framerName: 'Hero Section' }, [wrapper, styled]),
          n('section', { framerName: 'Projects' }, [card('A'), card('B')]),
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

const findNode = (m: ProjectModel, name: string) => {
  let hit: Node | undefined;
  const walk = (x: Node) => {
    if (x.framerName === name) hit = x;
    x.children.forEach(walk);
  };
  m.plan.pages.forEach((p) => p.sections.forEach((s) => walk(s.node)));
  return hit!;
};

test('parseEdits accepts valid edits and rejects unknown ops, bad identifiers and non-JSON', () => {
  assert.deepEqual(parseEdits('{"edits":[{"op":"renameComponent","from":"Hero","to":"IntroHero"}]}'), [
    { op: 'renameComponent', from: 'Hero', to: 'IntroHero' },
  ]);
  assert.throws(() => parseEdits('{"edits":[{"op":"setClass"}]}'), InvalidEditsError);
  assert.throws(() => parseEdits('{"edits":[{"op":"renameComponent","from":"Hero","to":"9bad"}]}'), InvalidEditsError);
  assert.throws(() => parseEdits('{"edits":[{"op":"renameToken","from":"green-900","to":"Ink!"}]}'), InvalidEditsError);
  assert.throws(() => parseEdits('not json'), InvalidEditsError);
});

test('renameComponent renames the section without mutating the input', () => {
  const m = model();
  const before = JSON.stringify(m.plan.pages.map((p) => p.sections.map((s) => s.name)));
  const out = applyEdits(m, [{ op: 'renameComponent', from: 'Hero', to: 'IntroHero' }]);
  assert.deepEqual(out.plan.pages[0].sections.map((s) => s.name), ['IntroHero', 'Projects']);
  assert.equal(JSON.stringify(m.plan.pages.map((p) => p.sections.map((s) => s.name))), before);
});

test('renameProp renames the prop and the content array keys', () => {
  const out = applyEdits(model(), [{ op: 'renameProp', component: 'Card', from: 'title', to: 'name' }]);
  const comp = out.plan.ui.find((u) => u.name === 'Card')!;
  assert.deepEqual(comp.props.map((p) => p.name), ['name', 'body']);
  const home = out.content.find((f) => f.module === 'home')!.data as { projects: { cards: Record<string, string>[] } };
  assert.deepEqual(home.projects.cards[0], { name: 'A', body: 'A body' });
});

test('renameContentKey renames a leaf and its binding', () => {
  const m = model();
  const out = applyEdits(m, [{ op: 'renameContentKey', file: 'home', from: 'hero.heading', to: 'hero.title' }]);
  const home = out.content.find((f) => f.module === 'home')!.data as { hero: Record<string, string> };
  assert.equal(home.hero.title, 'Hi');
  assert.equal(home.hero.heading, undefined);
  const h1 = findNode(out, 'Heading');
  assert.equal(out.bindings.text.get(h1.id), 'title');
});

test('renameToken changes theme names and therefore generated classes', () => {
  const out = applyEdits(model(), [{ op: 'renameToken', from: 'green-900', to: 'ink' }]);
  assert.equal(out.tokens.colors.ink, '#133324');
  assert.equal(out.tokens.colors['green-900'], undefined);
  const h1 = findNode(out, 'Heading');
  assert.deepEqual(toTailwind(h1.styles, undefined, out.tokens).classes, ['text-ink']);
});

test('unwrap removes a class-less single-child wrapper but refuses styled nodes', () => {
  const m = model();
  const wrapper = findNode(m, 'Wrapper');
  const out = applyEdits(m, [{ op: 'unwrap', component: 'Hero', nodeId: wrapper.id }]);
  assert.equal(out.plan.pages[0].sections[0].node.children[0].tag, 'h1');
  const styled = findNode(m, 'Styled');
  assert.throws(() => applyEdits(m, [{ op: 'unwrap', component: 'Hero', nodeId: styled.id }]), ForbiddenEditError);
});

test('unknown names and unsupported ops are forbidden', () => {
  assert.throws(() => applyEdits(model(), [{ op: 'renameComponent', from: 'Nope', to: 'X' }]), ForbiddenEditError);
  assert.throws(() => applyEdits(model(), [{ op: 'renameComponent', from: 'Hero', to: 'Projects' }]), ForbiddenEditError);
  assert.throws(() => applyEdits(model(), [{ op: 'extractComponent', nodeIds: ['a', 'b'], name: 'Thing' }]), ForbiddenEditError);
});

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, sleeps };
}

test('Throttle spaces calls by 60000/rpm ms', async () => {
  const c = fakeClock();
  const th = new Throttle(60, c.now, c.sleep);
  await th.run(async () => 1);
  await th.run(async () => 2);
  assert.ok(c.sleeps.some((ms) => ms >= 1000), JSON.stringify(c.sleeps));
});

test('Throttle retries 429s with backoff and gives up after 5 retries', async () => {
  const c = fakeClock();
  const th = new Throttle(6000, c.now, c.sleep);
  let calls = 0;
  const flaky = (failures: number) => async () => {
    if (calls++ < failures) throw new ProviderRateLimitError('429');
    return 'ok';
  };
  assert.equal(await th.run(flaky(3)), 'ok');
  calls = 0;
  await assert.rejects(th.run(flaky(6)), ProviderRateLimitError);
});

test('RefineCache round-trips edits with stable keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fexport-cache-'));
  const cache = new RefineCache(dir);
  const key = cache.key('<Hero />', 'agy', 'default');
  assert.equal(key, cache.key('<Hero />', 'agy', 'default'));
  assert.notEqual(key, cache.key('<Hero />', 'gemini', 'default'));
  assert.equal(cache.get(key), undefined);
  cache.set(key, [{ op: 'renameComponent', from: 'Hero', to: 'Intro' }]);
  assert.deepEqual(new RefineCache(dir).get(key), [{ op: 'renameComponent', from: 'Hero', to: 'Intro' }]);
});
