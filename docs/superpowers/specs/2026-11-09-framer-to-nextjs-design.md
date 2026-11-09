# Framer → Clean Next.js Conversion — Design Spec

**Date:** 2026-11-09
**Status:** Draft, awaiting review
**Scope:** Framer sites only (other platforms after this is validated)
**Test site:** https://nudge-folio.framer.website/

---

## 1. Goal

Convert an exported Framer website into a **clean, editable Next.js project** that the owner
will keep developing: changing text, colours, theme and design over time.

"Clean" means:

- Readable, named React components (no `framer-xxxx` classes, no Framer runtime).
- Styling with Tailwind CSS v4. Colours and fonts live in one theme file, never as raw hex in components.
- Page text, links and images live in typed content files, separate from layout code.
- Blog and case-study collections are MDX files, one file per item.
- Animations use `motion` (framer-motion) and GSAP through small reusable components.
- `npm install && npm run build` succeeds, and the result looks like the original site.

## 2. Non-negotiable constraint: existing features unchanged

This is a fork of an open-source tool. The feature is **opt-in** and **isolated**:

- All new code lives in `src/nextjs/`.
- Existing files receive only these additions:
  - `src/cli/index.ts`: parse `--nextjs`, `--ai-refine`, `--ai-provider`, `--ai-model` and the `to-nextjs` subcommand.
  - `src/cli/help.ts`: document them.
  - `src/exporter/index.ts`: one guarded call after a successful export:
    `if (this.nextjs && this.platform.name === 'framer') await runNextConversion(this)`.
  - `package.json`: new dependencies (section 11).
- No platform handler, capture step, rewrite step or output file of the existing export changes.
- The new modules are imported lazily (`await import('../nextjs/index.js')`), so the normal export path never loads them.
- `--nextjs` on a non-Framer site prints a warning and skips conversion. The static export still completes.
- If the conversion fails, the static export is kept, the error is written to `nextjs/CONVERSION-REPORT.md`, and the export command still exits 0. A non-zero exit happens only for `to-nextjs` failures.
- Acceptance: `npm run typecheck`, `npm test` and `npm run test:browser` pass with no changes to existing tests.

## 3. User-facing commands

```
framer-export <url> --subpages --nextjs                     export, then convert
framer-export <url> --subpages --nextjs --ai-refine         + AI cleanup pass
framer-export to-nextjs <export-dir> [--ai-refine]          convert an existing export again
  options: --ai-provider <id>   --ai-model <name>   --no-verify
```

- `to-nextjs` reads `source` from `<export-dir>/export-report.json` and re-runs the live capture (section 5.1).
  This allows iterating on the converter without re-downloading the full export.
- Output: `<export-dir>/nextjs/`. An existing `nextjs/` folder is replaced only after the new one is fully written
  to `nextjs.tmp/` and renamed.
- Version 1 is CLI only. The terminal wizard and web UI are out of scope.

## 4. Observed facts about the input (from exporting the test site)

The existing exporter ran successfully on the test site (`--subpages`): 0 failed assets,
18 subpages, 329 assets, 34 MB. Findings that shape this design:

| Fact | Consequence |
|---|---|
| All CSS is inline: 9 `<style>` blocks per page, `styles/` empty | The CSS source is read from the HTML |
| 419 `data-framer-name` attributes on the index page: some meaningful ("Hero Section", "Logo + Menu", "CTA", "Polaroid"), many generic ("Content", "Frame", "Text") | Meaningful names become component names; generic names need fallbacks or AI naming |
| 3 breakpoints: ≥1200, 810–1199, <810, each rendered as a hidden duplicate copy (50 wrappers using `.hidden-*{display:none!important}`) | Duplicates are merged into one element with responsive classes |
| About 30 colour tokens with ID names (`--token-06d97f76…: #133324`) | Readable token names must be generated |
| 4 font families (Inter Display, DM Mono, Flux Variable, Just Me Again Down Here) split into 90 `woff2` subsets by unicode range | Group them into `@font-face` rules for each family and weight |
| `data/*.framercms` is an undocumented binary format | **Not used.** CMS content is read from the rendered subpage HTML instead |
| Blog subpages contain full article text, headings and images | Converted to MDX |
| About 920 elements start with `opacity:0` and about 1,100 with inline transforms (e.g. per-letter `opacity:0.001; translateX(40px) scale(0.9)`) | Appear-animation start states can be extracted; the end state is the element's natural style |
| "Smooth Scroll", "Loader" and the custom cursor (`data-framer-cursor` ×6) exist only in compiled JS | Replaced with library components (section 7.6), approximated |
| Exported HTML is server-rendered markup, not the settled layout for each breakpoint | An extra capture pass is required (section 5.1) |

## 5. Architecture

```
src/nextjs/
  index.ts            runNextConversion(ctx) / runToNextjs(dir): orchestration + report
  capture.ts          live capture pass (Puppeteer)
  model.ts            PageModel / Node types
  framer/
    breakpoints.ts    merge hidden-* duplicates across the 3 captures
    names.ts          data-framer-name → component and prop names
    animations.ts     appear and split-text start states → animation specs
    collections.ts    detect blog / case-study collections and their item fields
  tokens.ts           collect colours, fonts, radii, shadows → theme tokens
  tailwind.ts         computed styles → Tailwind classes + leftover CSS
  components.ts       repeated-subtree detection → components + props
  content.ts          text, links, images → content files; collection items → MDX
  emit/               write project files (one module per file kind)
  refine/             optional LLM pass (section 8)
  verify.ts           install, build, screenshot diff
  versions.ts         pinned dependency versions for the generated project
```

Each stage is a pure function over the page model where possible (`(model, ctx) → model`),
so it can be tested with fixtures without a browser.

### 5.1 Capture

For each exported page (index + subpages), use the live source URL:

1. Open it in Puppeteer at widths **1440, 1024 and 390**.
2. Wait for hydration (reuse the existing Framer hydration selector), scroll to trigger lazy content,
   then wait for animations to finish.
3. Serialise every visible element: tag, attributes, `data-framer-name`, text, bounding box,
   and a fixed list of computed style properties (layout, box model, typography, colour, border,
   radius, shadow, transform, opacity, overflow, position, z-index, object-fit, gradients).
4. Record `:hover` rules from the CSSOM for each element.
5. Read **animation start states** from the exported HTML (inline `opacity` and `transform` before hydration)
   and attach them to matching nodes by DOM path and `data-framer-name`.
6. Save one PNG screenshot per page and width, used as the baseline for verification.

Capture data is saved to `<export-dir>/.nextjs-cache/` so later stages and AI passes can re-run without the browser.

### 5.2 Page model

```ts
interface Node {
  id: string;
  tag: string;
  framerName?: string;
  text?: string;
  attrs: Record<string, string>;
  styles: { base: Style; tablet?: Partial<Style>; mobile?: Partial<Style> };
  hover?: Partial<Style>;
  animation?: AnimationSpec;
  asset?: { kind: 'image' | 'video' | 'svg'; src: string; width: number; height: number };
  children: Node[];
}
interface PageModel { route: string; title: string; meta: Record<string, string>; root: Node }
```

## 6. Conversion rules

### 6.1 Breakpoints
- Desktop (1440 capture) gives the base styles. Tablet and mobile store only the properties that differ.
- Tailwind breakpoints are defined to match Framer, written **desktop-first** as overrides:
  `@custom-variant tablet (@media (max-width: 1199px));`
  `@custom-variant mobile (@media (max-width: 809px));`
  For example: `text-6xl tablet:text-5xl mobile:text-4xl`.
- `hidden-*` duplicates: nodes with the same `framerName` path that are visible at different widths are merged.
  If the structures differ too much to merge, both are kept and given `hidden tablet:block` style visibility classes.
  Each case is listed in the report.

### 6.2 Styles (hybrid Tailwind)
- Converted to Tailwind utilities: display/flex/grid, gap, padding, margin, width/height/min/max, position/inset,
  font size/weight/line-height/letter-spacing/family, colours, background colour, border, radius, shadow,
  opacity, overflow, z-index, object-fit.
- Values on Tailwind's default scale use named classes. Other values use arbitrary classes (`w-[347px]`).
- Not converted, written to `<Component>.module.css` instead: complex gradients, masks, `clip-path`, filters,
  pseudo-elements, keyframes, and any property outside the list above.
- Never emitted: `framer-*` class names, `data-framer-*` attributes, inline `style` attributes
  (except for dynamic values passed as props).

### 6.3 Theme tokens (`app/globals.css`)
- Every colour used goes into `@theme { --color-<name>: … }`. Components use only token classes (`bg-ink`, `text-mint`).
- Naming without AI: hue family plus a lightness step (`green-900`, `coral-400`, `neutral-100`), with deterministic
  de-duplication. With AI: semantic names (`ink`, `surface`, `accent`), the same colour values.
- Fonts: `--font-display`, `--font-mono`, `--font-body`, `--font-script`, mapped from the captured family names
  (the AI pass may rename them).
- Radii and shadows used three or more times also become tokens.

### 6.4 Fonts
- The exported `woff2` files are copied to `public/fonts/`.
- `app/fonts.css` holds one `@font-face` for each (family, weight, style, unicode-range) that was found,
  rebuilt from the captured `@font-face` rules.
- `next/font/local` is not used, because it cannot express unicode-range subsets across many files.

### 6.5 Components
- **Sections:** top-level children of each page, named from `framerName` in PascalCase
  ("Hero Section" → `Hero`, "Logo + Menu" → `Header`).
- **Shared layout:** subtrees that are the same on every page (header, footer) go into `app/layout.tsx`.
- **Repeated structures:** subtrees with the same structural hash (tags, nesting, classes, ignoring text and
  image sources) appearing two or more times become one component under `components/ui/`. The parts that differ
  become props, filled from an array in the content file.
- **Generic names** ("Frame", "Content") fall back to `<Section><Role>`, where the role comes from the content:
  Image, Heading, Text, Button, List, Card.
- Name collisions get numeric suffixes. The report lists every fallback name.

### 6.6 Content
- `content/<page>.ts` exports a typed object for each page: headings, paragraphs, links, button labels,
  image `{src, alt, width, height}`, and arrays for repeated components.
- Components receive content through props. Pages import content and pass it in.
- Text is never written directly in JSX, except text that is part of the design rather than content
  (for example decorative glyphs). These exceptions are listed in the report.

### 6.7 Collections (MDX)
- A collection is a URL prefix with an index page plus two or more item pages sharing the same template.
  On the test site: `/blog/*` (8 items) and `/case-study/*` (4 items).
- Each item page becomes `content/<collection>/<slug>.mdx`:
  - `export const metadata = { title, date, excerpt, cover, tags, … }`, taken from fields in the template
    that change between items.
  - The body is the main rich-text area, converted from HTML to Markdown (headings, paragraphs, lists, links,
    images, emphasis).
- Routes:
  - `app/<collection>/[slug]/page.tsx` renders the shared template plus the MDX body. It uses
    `generateStaticParams` and `generateMetadata`.
  - `app/<collection>/page.tsx` lists the items by reading metadata from every MDX file.
- Non-article collections, if detected, become `content/<name>.json`.

### 6.8 Pages, links, assets, metadata
- Routes follow the source paths (`/about` → `app/about/page.tsx`).
- Internal links use `next/link`. External links stay as `<a>`.
- Images: `next/image` with the captured intrinsic size. Files are copied to `public/images/` with
  readable names (from alt text or layer name), with collisions de-duplicated.
- Each page's `<title>`, description and OG tags go into the `metadata` export. The placeholder SEO text
  added by the existing exporter (`processSEO`) is never copied.

## 7. Animations

| Source | Detection | Output |
|---|---|---|
| Appear / scroll-into-view | inline start state (opacity < 1 or a non-identity transform) before hydration, natural state after | `<Reveal from={{ opacity: 0, x: 40, scale: 0.9 }} delay={…}>` (motion `whileInView`) |
| Per-letter text effects | sibling `display:inline-block` spans, each with a start state | `<SplitText text={…} from={…} stagger={…}>` (motion) |
| Hover / press | `:hover` CSS rules, transform/opacity/colour variants | Tailwind `hover:` classes. Transform springs use `motion` `whileHover` |
| Smooth Scroll layer | `data-framer-name="Smooth Scroll"` | `<SmoothScroll>` provider (Lenis), synced with GSAP ScrollTrigger |
| Scroll-linked effects (parallax, sticky progress) | transform changes recorded by sampling three scroll positions during capture | `useScrollAnimation(ref, {...})` hook (GSAP ScrollTrigger) |
| Custom cursor | `data-framer-cursor` | `<Cursor>` component styled with the captured size and colours |
| Loader | `data-framer-name="Loader"` | `<Loader>` component with a fade-out sequence |

- Timing (duration, delay, easing) is not stored in the HTML. Defaults are used (0.6 s, `easeOut`,
  stagger 0.03 s for letters) and collected in one `components/motion/config.ts` file so they can be tuned.
- All motion components respect `prefers-reduced-motion`.
- The cursor and loader are approximations. The report says so.

## 8. AI refine pass (opt-in, multi-provider)

### 8.1 Purpose and limits
The rule-based output is complete on its own. The AI pass only improves **names and structure**:

- Allowed: renaming components, props, content keys, files and colour tokens; simplifying wrapper divs that have
  no visual effect; extracting a shared component the rules missed.
- Not allowed: changing any style value, class that affects layout, text content, asset or route.

Each proposed change is a structured JSON edit list, applied by the tool and **accepted only if**:
- the TypeScript build passes, and
- the screenshot diff for that section stays within tolerance (section 9).

Otherwise the change is reverted and recorded in the report.

### 8.2 Providers
Free tiers matter: the user has a Claude Pro subscription, which **does not include API access**. One common
interface:

```ts
interface LlmProvider {
  id: string;
  supportsImages: boolean;
  complete(req: { system: string; user: string; images?: Buffer[]; json: true }): Promise<string>;
}
```

| `--ai-provider` | Auth | Notes |
|---|---|---|
| `claude-code` | the user's existing Claude Code login (Pro plan) | Runs `claude -p --output-format json` headless; counts against Pro usage limits; no API key |
| `agy` | the user's existing Antigravity CLI login | Runs `agy -p --output-format json --json-schema <edit-list schema> --dangerously-skip-permissions --sandbox --print-timeout <n>` headless; counts against that account's limits; no API key |
| `gemini` | `GEMINI_API_KEY` (Google AI Studio, free tier) | Supports images; free-tier rate limits apply |
| `groq` | `GROQ_API_KEY` (free tier) | OpenAI-compatible endpoint; fast; vision depends on model |
| `openrouter` | `OPENROUTER_API_KEY` | Free `:free` models with daily request caps |
| `github` | `GITHUB_TOKEN` (GitHub Models, free with rate limits) | OpenAI-compatible |
| `ollama` | none (local) | Completely free; quality and speed depend on local hardware and model |
| `anthropic` | `ANTHROPIC_API_KEY` | Paid API, for later |

- Implementation: one OpenAI-compatible client (`fetch`, no SDK) covers gemini (its OpenAI-compatible endpoint),
  groq, openrouter, github and ollama. Separate adapters handle `anthropic` (Messages API), and one shared
  "agent CLI" adapter spawns `claude-code` and `agy`.
- **Agent CLI isolation:** the refine pass only needs a text/JSON answer, never file access. Each CLI call:
  - runs with its working directory set to a fresh empty temp folder (`.nextjs-cache/refine/sandbox-<n>/`),
    never the user's project or export
  - receives the entire prompt (JSX, content, style summary, and screenshots as file paths in that temp folder)
    through stdin or files in that folder
  - has its temp folder deleted afterwards

  `--dangerously-skip-permissions` (agy) stops the CLI from blocking on the folder-trust or tool prompt. Combined
  with `--sandbox` and the empty working folder, the agent has nothing of the user's to modify. Claude Code in
  `-p` mode does not prompt; it denies tools it isn't allowed to use. The skip flag is configurable
  (`--ai-cli-skip-permissions false`).
- **Default provider when `--ai-refine` is given without `--ai-provider`:** the first one available, in this order:
  `claude-code` if the `claude` CLI is logged in, then `agy` if the `agy` CLI is logged in, then `gemini`, `groq`,
  `openrouter`, `github` (if their key is set), then `ollama` (if it responds on localhost:11434). If none is
  available, skip with a clear message.
- Default models for each provider live in `refine/providers.ts` and can be overridden with `--ai-model`.
  Current free-tier limits and model names **must be checked during implementation**; they change often and are
  not hard-coded into any documentation claim.
- When a provider has no image support, the pass uses text only (JSX + content + computed-style summary).

### 8.3 Staying within free-tier limits
- One request per section, not per element. Estimate for the test site: about 19 pages × about 6 sections, roughly
  110–130 requests, plus one request for token naming.
- A client-side throttle for each provider (requests per minute) and retries with backoff on HTTP 429.
- **Resumable:** each accepted result is cached in `.nextjs-cache/refine/<section-hash>.json`. If a daily cap is hit,
  the run stops cleanly, writes the report, and `to-nextjs --ai-refine` continues from the cache later.
- Shared components and tokens are refined once and reused across pages, which reduces requests.

## 9. Verification (`verify.ts`, skipped with `--no-verify`)

1. `npm install` and `npm run build` in `nextjs/`.
2. Run `next start` on a free port, and serve the original export with its own `serve.js`.
3. Screenshot every route at 1440, 1024 and 390, with animations finished and the same scroll procedure as capture.
4. Compute a pixel diff (`pixelmatch`) for each page and width.
5. Write `CONVERSION-REPORT.md`:
   - build result
   - similarity table
   - fallback names
   - unconverted CSS / animations / collections
   - AI changes accepted and rejected
   - provider usage

**Acceptance for the test site:**
- the build passes
- visual similarity ≥ 97% on every page at every width (tunable after the first real results)
- no hex colours in `components/`
- no `framer-` strings in `app/`, `components/` or `content/`
- all pages and all 12 collection items present

## 10. Generated project

```
nextjs/
  package.json  next.config.ts  tsconfig.json  postcss.config.mjs
  eslint.config.mjs  .prettierrc  .gitignore  README.md  CONVERSION-REPORT.md
  app/layout.tsx  app/globals.css  app/fonts.css  app/page.tsx
  app/<route>/page.tsx
  app/blog/page.tsx  app/blog/[slug]/page.tsx
  app/case-study/page.tsx  app/case-study/[slug]/page.tsx
  components/sections/*.tsx   components/ui/*.tsx
  components/motion/{Reveal,SplitText,SmoothScroll,Cursor,Loader}.tsx
  components/motion/useScrollAnimation.ts  components/motion/config.ts
  content/*.ts  content/blog/*.mdx  content/case-studies/*.mdx
  mdx-components.tsx
  public/images/*  public/fonts/*
```

- The generated `README.md` explains where to change content, colours, fonts and animation timing.
- Stack, current major versions: Next.js 16 (App Router, TypeScript, Turbopack), React 19, Tailwind CSS 4
  (`@tailwindcss/postcss`), `motion` 12, `gsap` 3 (ScrollTrigger), `lenis` 1, `@next/mdx` with `@mdx-js/loader`
  and `@mdx-js/react`, ESLint (`eslint-config-next`) and Prettier with `prettier-plugin-tailwindcss`.
- Exact versions are pinned in `src/nextjs/versions.ts`, confirmed with `npm view <pkg> version` during
  implementation. `scripts/update-nextjs-versions.ts` refreshes them later.

## 11. New dependencies for the tool

`parse5` (HTML parsing), `turndown` (HTML → Markdown for MDX), `pixelmatch` + `pngjs` (screenshot diff).
They are loaded only inside `src/nextjs/`. Provider clients use built-in `fetch`, so no SDKs are added.

## 12. Error handling

- Each page converts independently. If one page fails, it gets a placeholder page plus a report entry.
  The other pages still produce output.
- Capture timeouts retry once, then mark the page as failed.
- Provider errors: 429 → backoff; auth or other errors → disable the provider for the run, keep the
  rule-based output, and record it in the report.
- Install or build failure during verification: keep the generated project, record the error output in the report,
  and return non-zero only for `to-nextjs`.

## 13. Testing

- **Unit tests** (`tests/unit/nextjs-*.test.ts`), using small HTML/JSON fixtures saved from the test site:
  breakpoint merge, style → Tailwind mapping, token naming, structural hashing and component extraction,
  content extraction, HTML → MDX, animation start-state parsing, provider selection and the throttle/cache
  (with fake providers).
- **Integration test** (`tests/integration/nextjs-convert.test.ts`): convert a saved two-page fixture
  (one normal page, one blog item), run `next build`, and assert the file layout and the "no framer / no hex" rules.
- **Manual acceptance:** a full run on https://nudge-folio.framer.website/ against the criteria in section 9.
- Existing suites run unchanged (section 2).

## 14. Out of scope (version 1)

Other platforms; the wizard and web UI; forms, search and other backend behaviour; exact copies of the cursor,
loader and animation timing; decoding `.framercms` files; Framer component variants that are not visible in
any captured state (for example open menus that are never triggered during capture).

## 15. Delivery order

1. Capture, page model, breakpoint merge, Tailwind mapping, tokens, fonts and the emitter
   → the home page builds and renders.
2. Every route, shared layout, content files, components, links and images.
3. Collections → MDX.
4. Animation components.
5. Verification and report.
6. AI refine: provider layer first (`claude-code`, `agy`, `gemini`, `ollama`), then the rest.
