import path from 'node:path';
import type { ProjectModel } from '../emit/project.js';
import { renderNode } from '../emit/jsx.js';
import type { ConversionContext, Node } from '../model.js';
import { toTailwind } from '../tailwind.js';
import { RefineCache } from './cache.js';
import { applyEdits, EDIT_LIST_SCHEMA, ForbiddenEditError, InvalidEditsError, parseEdits, type Edit } from './edits.js';
import { createProvider, detectAvailable, selectProvider } from './select.js';
import { Throttle } from './throttle.js';
import { ProviderAuthError, ProviderRateLimitError, type LlmProvider } from './types.js';

const SYSTEM = `You improve the names in a Next.js project that was generated automatically from a Framer website.
The code is correct and renders exactly like the original. Your only job is to make it easier for a person to edit.

You may only:
- rename components (PascalCase) so they describe what the section or element is (e.g. "Hero", "PricingCard", "Testimonials")
- rename props and content keys (camelCase) so they describe their content
- rename colour tokens (kebab-case) to semantic names such as "ink", "surface", "accent", "muted", and font tokens to roles such as "display", "body", "mono"
- unwrap one of the listed wrapper elements that have no styles

Never change styles, classes, text, images, links or structure in any other way.
Prefer no edit over a doubtful one. If nothing should change, reply {"edits": []}.`;

export interface RefineDeps {
  /** undefined → detect and select from the environment; null → no provider. */
  provider?: LlmProvider | null;
  /** Optional per-unit gate; the conversion runs a full build/screenshot gate afterwards. */
  verify?: (candidate: ProjectModel) => Promise<{ buildOk: boolean; minSimilarity: number }>;
}

interface Unit {
  label: string;
  describe(m: ProjectModel): { user: string; images: string[] } | null;
}

function unwrapCandidates(root: Node, m: ProjectModel): string[] {
  const out: string[] = [];
  const walk = (n: Node, depth: number) => {
    const { classes, leftover } = toTailwind(n.styles, n.hover, m.tokens, n.visibility);
    if (depth > 0 && !classes.length && !Object.keys(leftover).length && n.children.length === 1 && !n.text && !n.motion) {
      out.push(`- nodeId "${n.id}": <${n.tag}> wrapping <${n.children[0].tag}>`);
    }
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return out;
}

function jsxOf(node: Node, m: ProjectModel, props?: Map<string, { kind: 'text' | 'image' | 'href'; name: string }>): string {
  const components = new Map<string, string>();
  for (const u of m.plan.ui) for (const i of u.instances) if (i.node !== node) components.set(i.node.id, u.name);
  return renderNode(node, {
    tokens: m.tokens,
    contentVar: 'content',
    bindings: props ? undefined : m.bindings,
    props,
    components,
    imports: new Set(),
    siteOrigin: m.siteOrigin,
  });
}

function allSections(m: ProjectModel) {
  return [
    ...(m.plan.layout.header ? [m.plan.layout.header] : []),
    ...(m.plan.layout.footer ? [m.plan.layout.footer] : []),
    ...(m.plan.layout.overlays ?? []),
    ...m.plan.pages.flatMap((p) => p.sections),
  ];
}

function buildUnits(m: ProjectModel): Unit[] {
  const units: Unit[] = [
    {
      label: 'theme',
      describe: (cur) => ({
        user: [
          'Colour tokens (name: value):',
          ...Object.entries(cur.tokens.colors).map(([k, v]) => `- ${k}: ${v}`),
          '',
          'Font tokens (name: family):',
          ...Object.entries(cur.tokens.fonts).map(([k, v]) => `- ${k}: ${v}`),
          '',
          'Suggest renameToken edits that give these tokens semantic names.',
        ].join('\n'),
        images: [],
      }),
    },
  ];
  for (const comp of m.plan.ui) {
    const templateId = comp.template.id;
    units.push({
      label: comp.name,
      describe: (cur) => {
        const c = cur.plan.ui.find((u) => u.template.id === templateId);
        if (!c) return null;
        const at = (root: Node, p: number[]) => p.reduce((x, i) => x.children[i], root);
        const props = new Map(c.props.map((p) => [at(c.template, p.path).id, { kind: p.kind, name: p.name }]));
        return {
          user: [
            `Component: ${c.name} (reusable UI component, used ${c.instances.length} times)`,
            `Props: ${c.props.map((p) => `${p.name} (${p.kind})`).join(', ') || 'none'}`,
            `Example values: ${JSON.stringify(c.instances[0]?.values ?? {})}`,
            '',
            'JSX:',
            jsxOf(c.template, cur, props),
            '',
            'Wrapper elements you may unwrap (component "' + c.name + '"):',
            ...(unwrapCandidates(c.template, cur).length ? unwrapCandidates(c.template, cur) : ['- none']),
          ].join('\n'),
          images: [],
        };
      },
    });
  }
  const seen = new Set<string>();
  for (const section of allSections(m)) {
    if (seen.has(section.name)) continue;
    seen.add(section.name);
    const nodeId = section.node.id;
    units.push({
      label: section.name,
      describe: (cur) => {
        const s = allSections(cur).find((x) => x.node.id === nodeId);
        if (!s) return null;
        const binding = cur.bindings.section.get(nodeId);
        const data = binding ? cur.content.find((f) => f.module === binding.module)?.data[binding.key] : undefined;
        const page = cur.plan.pages.find((p) => p.sections.some((x) => x.node.id === nodeId));
        const shot = cur.pages.find((p) => p.route === page?.route)?.screenshots.base;
        const candidates = unwrapCandidates(s.node, cur);
        return {
          user: [
            `Component: ${s.name} (page section${page ? ` on ${page.route}` : ', shared layout'})`,
            binding ? `Content file: content/${binding.module}.ts, key "${binding.key}"` : 'No content file.',
            `Content: ${JSON.stringify(data ?? {})}`,
            '',
            'JSX:',
            jsxOf(s.node, cur),
            '',
            `Wrapper elements you may unwrap (component "${s.name}"):`,
            ...(candidates.length ? candidates : ['- none']),
          ].join('\n'),
          images: shot ? [shot] : [],
        };
      },
    });
  }
  return units;
}

/** Optional AI naming pass. Every change is validated; anything that fails is reverted and reported. */
export async function runRefine(project: ProjectModel, ctx: ConversionContext, deps: RefineDeps = {}): Promise<ProjectModel> {
  let provider = deps.provider;
  if (provider === undefined) {
    try {
      const id = selectProvider(ctx.options, await detectAvailable(process.env, undefined, ctx.options.aiModel));
      provider = id ? await createProvider(id, ctx.options, path.join(ctx.cacheDir, 'refine')) : null;
    } catch (e) {
      ctx.log('AI refine skipped: ' + (e as Error).message);
      ctx.report.refine = { provider: ctx.options.aiProvider ?? 'none', accepted: 0, rejected: [], requests: 0, stoppedEarly: (e as Error).message };
      return project;
    }
  }
  if (!provider) {
    ctx.log('AI refine skipped: no provider available (log in to claude or agy, or set GEMINI_API_KEY / GROQ_API_KEY)');
    return project;
  }

  const report = { provider: provider.id, accepted: 0, rejected: [] as { section: string; reason: string }[], requests: 0 } as NonNullable<ConversionContext['report']['refine']>;
  ctx.report.refine = report;
  const throttle = new Throttle(provider.rpm);
  const cache = new RefineCache(path.join(ctx.cacheDir, 'refine'));
  let current = project;

  for (const unit of buildUnits(project)) {
    const desc = unit.describe(current);
    if (!desc) continue;
    const key = cache.key(desc.user, provider.id, provider.model);
    let edits: Edit[] | undefined = cache.get(key);
    if (!edits) {
      try {
        report.requests++;
        ctx.log(`AI refine: ${unit.label}`);
        const raw = await throttle.run(() =>
          provider!.complete({
            system: SYSTEM,
            user: desc.user,
            images: provider!.supportsImages ? desc.images : undefined,
            schema: EDIT_LIST_SCHEMA,
          })
        );
        edits = parseEdits(raw);
        cache.set(key, edits);
      } catch (e) {
        if (e instanceof ProviderAuthError || e instanceof ProviderRateLimitError) {
          report.stoppedEarly = `${e.message}. Run to-nextjs --ai-refine again later to continue from the cache.`;
          break;
        }
        report.rejected.push({ section: unit.label, reason: e instanceof InvalidEditsError ? `invalid edits: ${e.message}` : (e as Error).message });
        continue;
      }
    }
    if (!edits.length) continue;
    let candidate: ProjectModel;
    try {
      candidate = applyEdits(current, edits);
    } catch (e) {
      if (!(e instanceof ForbiddenEditError)) throw e;
      report.rejected.push({ section: unit.label, reason: `not allowed: ${e.message}` });
      continue;
    }
    if (deps.verify) {
      const check = await deps.verify(candidate);
      if (!check.buildOk) {
        report.rejected.push({ section: unit.label, reason: 'build failed' });
        continue;
      }
      if (check.minSimilarity < 0.97) {
        report.rejected.push({ section: unit.label, reason: `similarity ${(check.minSimilarity * 100).toFixed(1)}% is below 97%` });
        continue;
      }
    }
    current = candidate;
    report.accepted += edits.length;
  }
  return current;
}
