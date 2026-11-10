/** ai-guide/checklist.md: what the user checks after each task. */
export const CHECKLIST_MD = `# Check after each task

Run \`npm run dev\` in \`nextjs-app/\` and open the task's page next to the original site.

## Looks
- [ ] At 1440 wide the page looks like \`ai-guide/pages/<page>/desktop.png\`.
- [ ] At 1024 (tablet) and 390 (mobile) it looks like \`tablet.png\` and \`mobile.png\`.
- [ ] Resize slowly between those widths: nothing overlaps, nothing is cut off, no sideways scroll.
- [ ] The side-by-side images in \`ai-guide/compare/\` show no big differences.

## Works
- [ ] Every link and button goes where the original goes (navigation, footer, call-to-action links).
- [ ] The mobile menu opens and closes.
- [ ] The animation matches the original: loader, elements appearing, scroll effects, hover.
- [ ] With "reduce motion" switched on in your OS, the page is still readable and nothing moves.

## Code
- [ ] Text and images are in \`content/\` or MDX, not typed into components.
- [ ] No raw hex colours (\`#…\`) in components; only token classes.
- [ ] Component names say what they are (\`HomeHeroSection\`, not \`Section2\`).
- [ ] \`npm run build\` and \`npm run lint\` pass.

## Then
- [ ] \`git commit\` the task, and start the next one.
- If something is wrong: tell the agent what to fix, or discard the task with \`git checkout .\`,
  untick its steps in \`ai-guide/plan.md\` and run it again with a note.
`;
