import fs from 'node:fs';
import path from 'node:path';

export interface FontFace {
  family: string;
  weight: string;
  style: string;
  unicodeRange?: string;
  /** Basename inside the export's assets/fonts/. */
  file: string;
}

const FORMAT: Record<string, string> = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of block.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    out[decl.slice(0, idx).trim().toLowerCase()] = decl.slice(idx + 1).trim();
  }
  return out;
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** All distinct @font-face rules in the export HTML whose font file was exported. */
export function extractFontFaces(exportDir: string, htmls: string[]): FontFace[] {
  const fontsDir = path.join(exportDir, 'assets', 'fonts');
  const faces: FontFace[] = [];
  const seen = new Set<string>();
  for (const html of htmls) {
    for (const [, block] of html.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const d = declarations(block);
      const url = d.src?.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
      if (!d['font-family'] || !url) continue;
      const file = path.posix.basename(url.split(/[?#]/)[0]);
      if (!fs.existsSync(path.join(fontsDir, file))) continue;
      const face: FontFace = {
        family: unquote(d['font-family']),
        weight: d['font-weight'] ?? '400',
        style: d['font-style'] ?? 'normal',
        file,
      };
      if (d['unicode-range']) face.unicodeRange = d['unicode-range'];
      const id = [face.family, face.weight, face.style, face.unicodeRange ?? '', face.file].join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      faces.push(face);
    }
  }
  return faces;
}

/** `app/fonts.css`: one rule per face, grouped by family, pointing at /fonts/. */
export function renderFontsCss(faces: FontFace[]): string {
  const families = [...new Set(faces.map((f) => f.family))];
  const out: string[] = [];
  for (const family of families) {
    out.push(`/* ${family} */`);
    for (const f of faces.filter((x) => x.family === family)) {
      const format = FORMAT[path.extname(f.file).toLowerCase()] ?? 'woff2';
      out.push(
        '@font-face {',
        `  font-family: "${f.family}";`,
        `  src: url('/fonts/${f.file}') format('${format}');`,
        `  font-weight: ${f.weight};`,
        `  font-style: ${f.style};`,
        '  font-display: swap;',
        ...(f.unicodeRange ? [`  unicode-range: ${f.unicodeRange};`] : []),
        '}'
      );
    }
    out.push('');
  }
  return out.join('\n');
}
