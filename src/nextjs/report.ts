export interface ConversionReport {
  pages: { route: string; status: 'ok' | 'failed'; error?: string }[];
  fallbackNames: { name: string; route: string }[];
  unconverted: { route: string; what: string; why: string }[];
  keptDuplicates: { route: string; key: string }[];
  textExceptions: { route: string; text: string }[];
  similarity: { route: string; width: number; score: number }[];
  build?: { ok: boolean; output?: string };
  refine?: {
    provider: string;
    accepted: number;
    rejected: { section: string; reason: string }[];
    requests: number;
    stoppedEarly?: string;
  };
  fatal?: string;
}

export function emptyReport(): ConversionReport {
  return {
    pages: [],
    fallbackNames: [],
    unconverted: [],
    keptDuplicates: [],
    textExceptions: [],
    similarity: [],
  };
}

const THRESHOLD = 0.97;

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_None._\n';
  const line = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n') + '\n';
}

export function renderReport(r: ConversionReport): string {
  const out: string[] = ['# Next.js conversion report', ''];
  if (r.fatal) out.push('## Conversion failed', '', '```', r.fatal, '```', '');

  const failed = r.pages.filter((p) => p.status === 'failed');
  out.push(
    '## Pages',
    '',
    `${r.pages.length - failed.length} of ${r.pages.length} converted.`,
    '',
    table(
      ['Route', 'Status', 'Error'],
      r.pages.map((p) => [p.route, p.status, p.error ?? ''])
    )
  );

  out.push('## Build', '');
  if (!r.build) out.push('_Not run._', '');
  else {
    out.push(r.build.ok ? 'Build passed.' : 'Build failed.', '');
    if (!r.build.ok && r.build.output) out.push('```', r.build.output, '```', '');
  }

  out.push(
    '## Visual similarity',
    '',
    `Target: ${THRESHOLD * 100}% or higher for every page and width.`,
    '',
    table(
      ['Route', 'Width', 'Similarity', 'Result'],
      r.similarity.map((s) => [
        s.route,
        String(s.width),
        `${(s.score * 100).toFixed(2)}%`,
        s.score >= THRESHOLD ? 'pass' : 'below target',
      ])
    )
  );

  out.push(
    '## Generated names to review',
    '',
    'These names were generated because the Framer layer name was generic. Rename them freely.',
    '',
    table(['Name', 'Route'], r.fallbackNames.map((f) => [f.name, f.route]))
  );
  out.push(
    '## Not converted',
    '',
    table(['Route', 'What', 'Why'], r.unconverted.map((u) => [u.route, u.what, u.why]))
  );
  out.push(
    '## Breakpoint variants kept separately',
    '',
    table(['Route', 'Element'], r.keptDuplicates.map((d) => [d.route, d.key]))
  );
  out.push(
    '## Text kept in components',
    '',
    table(['Route', 'Text'], r.textExceptions.map((t) => [t.route, t.text]))
  );

  out.push('## AI refine', '');
  if (!r.refine) out.push('_Not run._', '');
  else {
    out.push(
      `Provider: ${r.refine.provider}. Requests: ${r.refine.requests}. Accepted changes: ${r.refine.accepted}.`,
      ''
    );
    if (r.refine.stoppedEarly) out.push(`Stopped early: ${r.refine.stoppedEarly}`, '');
    out.push(
      table(['Section', 'Rejected because'], r.refine.rejected.map((x) => [x.section, x.reason]))
    );
  }
  return out.join('\n');
}
