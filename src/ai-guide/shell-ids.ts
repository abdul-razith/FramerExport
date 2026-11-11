/** Where a shell part is built: the first page it appears on, and its position in that page's shell list. */
export interface ShellOwner {
  route: string;
  index: number;
  id: string;
}

/**
 * Gives every shell part a stable id (`S1`, `S2`…) by structure (`hashes`, e.g. looseHash), so the
 * same header has the same id on every page. Pages are taken in the given order (home first); the
 * first page a part appears on owns it. Two parts with the same structure on one page (two
 * identical dots) get the ids of their first, second… occurrence.
 */
export function assignShellIds(pages: { route: string; hashes: string[] }[]): { ids: string[][]; owners: ShellOwner[] } {
  const byHash = new Map<string, string[]>();
  const owners: ShellOwner[] = [];
  const ids = pages.map((page) => {
    const usedHere = new Map<string, number>();
    return page.hashes.map((hash, index) => {
      const n = usedHere.get(hash) ?? 0;
      usedHere.set(hash, n + 1);
      const known = byHash.get(hash) ?? [];
      if (known[n]) return known[n];
      const id = `S${owners.length + 1}`;
      known[n] = id;
      byHash.set(hash, known);
      owners.push({ route: page.route, index, id });
      return id;
    });
  });
  return { ids, owners };
}
