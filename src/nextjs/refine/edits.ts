import type { ProjectModel } from '../emit/project.js';
import type { Node } from '../model.js';
import { toTailwind } from '../tailwind.js';

export type Edit =
  | { op: 'renameComponent'; from: string; to: string }
  | { op: 'renameProp'; component: string; from: string; to: string }
  | { op: 'renameContentKey'; file: string; from: string; to: string }
  | { op: 'renameToken'; from: string; to: string }
  | { op: 'unwrap'; component: string; nodeId: string }
  | { op: 'extractComponent'; nodeIds: string[]; name: string };

export class InvalidEditsError extends Error {
  name = 'InvalidEditsError';
}
export class ForbiddenEditError extends Error {
  name = 'ForbiddenEditError';
}

const IDENT = '^[A-Za-z][A-Za-z0-9]*$';
const PATH = '^[A-Za-z][A-Za-z0-9]*(\\.[A-Za-z][A-Za-z0-9]*)*$';
const TOKEN = '^[a-z][a-z0-9-]*$';

const str = (pattern?: string) => ({ type: 'string', ...(pattern ? { pattern } : {}) });
const op = (name: string, props: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  required: ['op', ...Object.keys(props)],
  properties: { op: { const: name }, ...props },
});

/** JSON Schema of the reply every provider must return. */
export const EDIT_LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['edits'],
  properties: {
    edits: {
      type: 'array',
      items: {
        anyOf: [
          op('renameComponent', { from: str(IDENT), to: str(IDENT) }),
          op('renameProp', { component: str(IDENT), from: str(IDENT), to: str(IDENT) }),
          op('renameContentKey', { file: str(IDENT), from: str(PATH), to: str(PATH) }),
          op('renameToken', { from: str(TOKEN), to: str(TOKEN) }),
          op('unwrap', { component: str(IDENT), nodeId: str() }),
          op('extractComponent', { nodeIds: { type: 'array', items: str() }, name: str(IDENT) }),
        ],
      },
    },
  },
} as const;

const FIELDS: Record<Edit['op'], Record<string, RegExp | 'string' | 'array'>> = {
  renameComponent: { from: new RegExp(IDENT), to: new RegExp(IDENT) },
  renameProp: { component: new RegExp(IDENT), from: new RegExp(IDENT), to: new RegExp(IDENT) },
  renameContentKey: { file: new RegExp(IDENT), from: new RegExp(PATH), to: new RegExp(PATH) },
  renameToken: { from: new RegExp(TOKEN), to: new RegExp(TOKEN) },
  unwrap: { component: new RegExp(IDENT), nodeId: 'string' },
  extractComponent: { nodeIds: 'array', name: new RegExp(IDENT) },
};

/** Parses and validates a provider reply. Throws InvalidEditsError. */
export function parseEdits(raw: string): Edit[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new InvalidEditsError('Reply is not valid JSON');
  }
  const edits = (data as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) throw new InvalidEditsError('Reply has no "edits" array');
  return edits.map((e, i) => {
    const rec = e as Record<string, unknown>;
    const spec = FIELDS[rec?.op as Edit['op']];
    if (!spec) throw new InvalidEditsError(`Edit ${i}: unknown op "${String(rec?.op)}"`);
    for (const [field, rule] of Object.entries(spec)) {
      const v = rec[field];
      const ok =
        rule === 'array'
          ? Array.isArray(v) && v.every((x) => typeof x === 'string')
          : typeof v === 'string' && (rule === 'string' || rule.test(v));
      if (!ok) throw new InvalidEditsError(`Edit ${i} (${String(rec.op)}): invalid "${field}"`);
    }
    return Object.fromEntries(['op', ...Object.keys(spec)].map((k) => [k, rec[k]])) as Edit;
  });
}

type Data = Pick<ProjectModel, 'plan' | 'content' | 'bindings' | 'tokens' | 'pages' | 'collections'>;

function sectionsOf(d: Data) {
  return [
    ...(d.plan.layout.header ? [d.plan.layout.header] : []),
    ...(d.plan.layout.footer ? [d.plan.layout.footer] : []),
    ...d.plan.pages.flatMap((p) => p.sections),
  ];
}

function subtreeIds(node: Node, out = new Set<string>()): Set<string> {
  out.add(node.id);
  node.children.forEach((c) => subtreeIds(c, out));
  return out;
}

function renameKey(obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
  if (!(from in obj)) throw new ForbiddenEditError(`No content key "${from}"`);
  if (to in obj) throw new ForbiddenEditError(`Content key "${to}" already exists`);
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

function contentData(d: Data, module: string): Record<string, unknown> {
  const f = d.content.find((x) => x.module === module);
  if (!f) throw new ForbiddenEditError(`No content file "${module}"`);
  return f.data;
}

function setContentData(d: Data, module: string, data: Record<string, unknown>): void {
  d.content.find((x) => x.module === module)!.data = data;
}

function apply(d: Data, e: Edit): void {
  switch (e.op) {
    case 'renameComponent': {
      const names = new Set([...sectionsOf(d).map((s) => s.name), ...d.plan.ui.map((u) => u.name)]);
      if (!names.has(e.from)) throw new ForbiddenEditError(`No component "${e.from}"`);
      if (names.has(e.to)) throw new ForbiddenEditError(`Component "${e.to}" already exists`);
      for (const s of sectionsOf(d)) if (s.name === e.from) s.name = e.to;
      for (const u of d.plan.ui) if (u.name === e.from) u.name = e.to;
      return;
    }
    case 'renameProp': {
      const comp = d.plan.ui.find((u) => u.name === e.component);
      if (!comp) throw new ForbiddenEditError(`No UI component "${e.component}"`);
      const prop = comp.props.find((p) => p.name === e.from);
      if (!prop) throw new ForbiddenEditError(`${e.component} has no prop "${e.from}"`);
      if (comp.props.some((p) => p.name === e.to)) throw new ForbiddenEditError(`${e.component} already has "${e.to}"`);
      prop.name = e.to;
      for (const inst of comp.instances) {
        inst.values = renameKey(inst.values, e.from, e.to);
        const where = d.bindings.instance.get(inst.node.id);
        const section = sectionsOf(d).find((s) => subtreeIds(s.node).has(inst.node.id));
        const binding = section && d.bindings.section.get(section.node.id);
        if (!where || !binding) continue;
        const sectionData = contentData(d, binding.module)[binding.key] as Record<string, unknown[]>;
        const list = sectionData[where.array] as Record<string, unknown>[];
        if (list?.[where.index] && e.from in list[where.index]) list[where.index] = renameKey(list[where.index], e.from, e.to);
      }
      return;
    }
    case 'renameContentKey': {
      const from = e.from.split('.');
      const to = e.to.split('.');
      if (from.length !== to.length || from.length > 2 || (from.length === 2 && from[0] !== to[0])) {
        throw new ForbiddenEditError('Only a section key or one key inside a section can be renamed');
      }
      const data = contentData(d, e.file);
      if (from.length === 1) {
        setContentData(d, e.file, renameKey(data, from[0], to[0]));
        for (const v of d.bindings.section.values()) if (v.module === e.file && v.key === from[0]) v.key = to[0];
        return;
      }
      const [sectionKey, leaf] = from;
      const newLeaf = to[1];
      data[sectionKey] = renameKey(data[sectionKey] as Record<string, unknown>, leaf, newLeaf);
      const sectionEntry = [...d.bindings.section].find(([, v]) => v.module === e.file && v.key === sectionKey);
      const section = sectionEntry && sectionsOf(d).find((s) => s.node.id === sectionEntry[0]);
      if (!section) return;
      const ids = subtreeIds(section.node);
      const rewrite = (p: string) => (p === leaf ? newLeaf : p.startsWith(leaf + '.') ? newLeaf + p.slice(leaf.length) : p);
      for (const map of [d.bindings.text, d.bindings.image, d.bindings.href]) {
        for (const [id, p] of map) if (ids.has(id)) map.set(id, rewrite(p));
      }
      for (const [id, v] of d.bindings.instance) if (ids.has(id) && v.array === leaf) v.array = newLeaf;
      return;
    }
    case 'renameToken': {
      const t = d.tokens;
      if (t.colors[e.from] !== undefined) {
        if (t.colors[e.to] !== undefined) throw new ForbiddenEditError(`Token "${e.to}" already exists`);
        t.colors = renameKey(t.colors, e.from, e.to) as Record<string, string>;
        for (const [value, name] of t.colorByValue) if (name === e.from) t.colorByValue.set(value, e.to);
        return;
      }
      if (t.fonts[e.from] !== undefined) {
        if (t.fonts[e.to] !== undefined) throw new ForbiddenEditError(`Token "${e.to}" already exists`);
        t.fonts = renameKey(t.fonts, e.from, e.to) as Record<string, string>;
        for (const [family, name] of t.fontByFamily) if (name === e.from) t.fontByFamily.set(family, e.to);
        return;
      }
      throw new ForbiddenEditError(`No colour or font token "${e.from}"`);
    }
    case 'unwrap': {
      for (const s of sectionsOf(d)) {
        const visit = (parent: Node): boolean => {
          const i = parent.children.findIndex((c) => c.id === e.nodeId);
          if (i !== -1) {
            const node = parent.children[i];
            const { classes, leftover } = toTailwind(node.styles, node.hover, d.tokens, node.visibility);
            if (classes.length || Object.keys(leftover).length || node.children.length !== 1 || node.text || node.motion) {
              throw new ForbiddenEditError(`Node ${e.nodeId} has styles or content; unwrapping would change the page`);
            }
            parent.children[i] = node.children[0];
            return true;
          }
          return parent.children.some(visit);
        };
        if (visit(s.node)) return;
      }
      throw new ForbiddenEditError(`No node ${e.nodeId}`);
    }
    case 'extractComponent':
      throw new ForbiddenEditError('extractComponent is not supported yet');
  }
}

/** Applies edits to a copy of the project; the input is never mutated. Throws ForbiddenEditError. */
export function applyEdits(project: ProjectModel, edits: Edit[]): ProjectModel {
  const data: Data = structuredClone({
    plan: project.plan,
    content: project.content,
    bindings: project.bindings,
    tokens: project.tokens,
    pages: project.pages,
    collections: project.collections,
  });
  for (const e of edits) apply(data, e);
  return { ...project, ...data };
}
