/**
 * Removes `--ai-guide` from the CLI args. Must run before the Next.js flag parsing, which treats
 * every other `--ai-*` flag as its own. Kept apart from index.ts so the CLI loads no browser code.
 */
export function takeAiGuideFlag(args: string[]): boolean {
  const idx = args.indexOf('--ai-guide');
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}
