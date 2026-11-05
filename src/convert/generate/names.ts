/**
 * Converts arbitrary section names into valid, unique PascalCase React component names.
 *
 * Disambiguates collisions via `taken` (e.g. `HeroAbout` -> `HeroAbout2`).
 * Prepends "Section" when the name starts with a digit or contains no letters/digits.
 */
export function componentName(section: string, taken: Set<string>): string {
  const parts = section
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base = parts
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  if (!base) {
    base = 'Section';
  } else if (!/^[A-Za-z_$]/.test(base)) {
    base = `Section${base}`;
  }

  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${counter++}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Converts arbitrary section names into valid, lowercase kebab-case slugs
 * for filenames and task ids. Falls back to "section" when empty or non-alphanumeric.
 */
export function kebabName(section: string): string {
  const cleaned = section
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return cleaned || 'section';
}
