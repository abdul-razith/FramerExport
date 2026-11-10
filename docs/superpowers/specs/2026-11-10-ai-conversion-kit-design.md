# AI guide: Framer export → clean Next.js, built by an AI agent

Date: 2026-11-10
Status: design approved in conversation; awaiting spec review
Branch: `feature/framer-nextjs`
Related: `2026-11-09-framer-to-nextjs-design.md` (the rule-based converter, kept in the repo but not part of this flow)

## 1. Why

The rule-based converter (`to-nextjs`) copies the rendered Framer DOM element by element.
It reaches high visual similarity on simple pages but cannot produce code a person wants to
edit: Framer's wrapper nesting, pixel insets and generic names (`Section2`, `HeroAboutGroup` ×27)
come along, every fix exposes a new layout case, and Framer's JavaScript-driven animations
(loaders, timed entrances, typing text) are invisible to it.

The user's goal is a **clean, editable Next.js project** they will later change (content, colour
theme, design). Clean code matters more than pixel identity.

## 2. The flow

1. The user runs the existing exporter with a new flag: `framer-export <url> --ai-guide`.
2. The exporter produces the HTML export exactly as today (pages, assets, fonts, CMS data),
   **plus** an AI guide: documents that explain the site and a step-by-step task list for turning
   the HTML export into a Next.js project.
3. The user opens the export folder in Claude Code or agy.
4. The AI executes the tasks one by one — task 00 creates the Next.js project, later tasks build
   the shell, each page's sections and the CMS pages. The user checks and commits after each task.

For an export that already exists (e.g. `nudge-folio/`): `framer-export ai-guide <export-dir>`
adds the guide without exporting again.

## 3. Decisions

| Question | Decision |
| --- | --- |
| When the guide is made | Only with `--ai-guide` (or the `ai-guide` command). Exports without the flag are unchanged. |
| How the AI is run | The user runs Claude Code or agy in the export folder and asks it to do the tasks in order; the user checks each task. No automatic orchestration. |
| What the AI starts from | The HTML export plus the guide. The AI creates the Next.js project itself (task 00) and moves content into content files and MDX as part of its tasks. The tool describes the site; it does not convert it. |
| How the AI learns animations | Recorded frames of the live site (load, scroll, hover) plus a measured `motion.md`. |
| How work is split | Project setup, then the shared shell, then one task per page section (small adjacent sections grouped), one task per CMS collection, and a final review task. |
| Scope | Any Framer site; nudge-folio is the first test site. Other platforms later. |
| Rule-based converter | Stays in the repo untouched; not used or referenced by the guide. |

## 4. What the export contains with `--ai-guide`

```
<export-dir>/
  index.html  subpages/  assets/  styles/  scripts/  data/     the HTML export, as today
  AGENTS.md                 AI rules (agy and other agents read this)
  CLAUDE.md                 same rules (Claude Code reads this)
  ai-guide/
    README.md               for the user: how to run the conversion, check, recover
    site.md                 the site at a glance (see 4.1)
    files.md                which export file holds what (see 4.2)
    content.md              CMS collections and their items and fields (see 4.3)
    tokens.md               colours, fonts, font sizes, radii, shadows with proposed token names
    checklist.md            what the user checks after each task
    tasks/NN-<name>.md      this site's tasks, in order (section 7)
    pages/<route-slug>/
      outline.md            the page's sections (see 4.4)
      motion.md             the page's measured animations (section 5)
      desktop.png tablet.png mobile.png              full page at 1440 / 1024 / 390
      sections/NN-<name>-{desktop,tablet,mobile}.png  each section cropped
      frames/load/  frames/scroll/  frames/hover/      recorded frames
    scripts/compare.mjs     reference vs. result, side by side (see 4.5)
  nextjs-app/               created by the AI in task 00 (not by the tool)
```

Everything in `ai-guide/` is generated from the export and the live site; the AI treats it as
read-only reference.

### 4.1 `site.md`

Routes with title and the export file for each; the navigation and footer links; which
sections repeat across pages (shared header, footer, CTA); breakpoints the site uses; the
pages that are CMS list or detail pages; fonts in use; the task list with one line per task.

### 4.2 `files.md`

A map of the export so the AI never has to guess: `index.html` and `subpages/*.html` (route of
each), `assets/images` (with which page/section uses each image, its size and a suggested
readable name), `assets/fonts` (family, weight, style for each file), `assets/videos`,
`data/*.framercms` (which collection), `styles/` and `scripts/` (Framer runtime — **not** to be
copied into the Next.js project).

### 4.3 `content.md`

Each CMS collection: name, list page route, detail route pattern, the items (slug, title, date,
cover image, the export file of each detail page) and the fields seen on the detail page, with a
suggested MDX front matter shape.

### 4.4 `outline.md` (one per page)

The structural input for the AI instead of the 300–700 KB Framer HTML. One block per section,
in reading order:

```
## 02 Hero — 1440×900 (tablet 1024×780, mobile 390×640)
screenshot: sections/02-hero-{desktop,tablet,mobile}.png
text: "my name is" · "BEJAMAN" · "AVAILABLE FOR THOUGHTFUL PROJECTS" · "I design outstanding digital products."
tags: "Currently at Meridian Health" · "Previously at Searchless AI" · "PRODUCT DESIGNER" · "CHICAGO, IL"
images: assets/images/<file> → suggested /images/avatar.png (×2), …
links: "Contact me" → /contact
animations: see motion.md #hero
export markup: subpages/<page>.html, element data-framer-name="Hero Section"
```

Sections come from the page structure the existing capture code detects (top-level sections,
Framer layer names). Generic layer names ("Frame 12") are kept with a note so the AI names the
component properly.

### 4.5 `scripts/compare.mjs`

`node ai-guide/scripts/compare.mjs <route>` (wired as `npm run compare` in task 00): screenshots
the route of the running Next.js app at 1440, 1024 and 390 and writes side-by-side images with
the reference plus a similarity number per width. A check for the AI and the user, not a pass/fail gate.

## 5. Animation recording

The guide step loads each page of the live site in a headless browser and records:

- **Load:** a frame every 200 ms for the first 6 s (loader and entrance animations).
- **Scroll:** a frame at each half-screen step; a 2 s recording at one mid-page position for loops.
- **Hover:** before/after frames for elements with hover rules.

It also samples computed `opacity` and `transform` of visible elements during load and scroll
and writes `motion.md` from the measurements:

```
## Hero tags — section 02, trigger: load
"PRODUCT DESIGNER" tag: opacity 0 → 1, translateY -120px → 0, rotate -14° → -8°
  starts 3.4 s after load, lasts ~0.6 s, spring-like overshoot. Frames: load/017–020.
```

Each entry states element, section, trigger (load / in-view / scroll-linked / hover / loop),
start → end values, start time, duration and an easing guess. Behaviour that cannot be measured
as style changes (typed text, live clock, canvas, video) is listed as **custom behaviour** with
frame references; the AI writes a small component for it (e.g. `TypingText`, `LiveClock`).

## 6. AI rules (`AGENTS.md` / `CLAUDE.md`)

1. **Work order.** Do one task file at a time, in number order; read the files the task lists
   before writing code; stop after the task and report.
2. **Stack.** The Next.js project lives in `nextjs-app/`. Next.js 16 App Router, React 19,
   TypeScript; server components by default, `'use client'` only where there is animation or
   interaction. Tailwind 4 with the tokens from `tokens.md`. motion for load, hover and in-view
   animation; GSAP ScrollTrigger only for scroll-position-linked animation; Lenis for smooth
   scroll; `@next/mdx` for CMS content. Exact versions are pinned in task 00.
3. **Structure.** `components/layout` (Navbar, Footer, Loader); `components/sections/<page>`
   (e.g. `HomeHero`); `components/ui` (Button, Tag, Card…); `components/motion` (FadeIn, Reveal,
   TypingText…); `content/<page>.ts`; `content/<collection>/<slug>.mdx`; `lib/`.
4. **Clean code.** Layout with flex/grid, the spacing scale and `max-w-*` containers; absolute
   positioning only for genuinely overlapping decoration. Desktop-first with `tablet:` and
   `mobile:` variants, fluid between the reference widths. Colours only from tokens, never raw
   hex. Meaningful names. Anything used twice becomes a `components/ui` component. Files stay
   under about 200 lines.
5. **Content.** All text, images and links come from `content/*.ts` or MDX, copied exactly from
   the outline/export; components receive content through props. Images are copied from
   `assets/` to `public/images/` with the readable names from `files.md`.
6. **Framer leftovers.** Never copy Framer runtime scripts, `framer-*` class names, generated CSS
   or inline style blobs from the export. The export HTML is a reference for structure and text only.
7. **Animation.** Follow `motion.md`; animate only transform and opacity; respect
   `prefers-reduced-motion`.
8. **Done means.** `npm run build` and `npm run lint` pass in `nextjs-app/`; `npm run compare
   <route>` was run and the remaining visible differences are listed in the report; only the
   files the task names were changed.
9. **Never.** Add a dependency the task does not name without saying why; edit the export or
   `ai-guide/`; invent content; leave placeholder text or `TODO`s.

## 7. Tasks

Generated per site into `ai-guide/tasks/` from templates kept in the repo
(`src/ai-guide/templates/`). Each task file states: goal; files to read; files to create or
change; shared components to reuse; done checks.

| # | Task | Template |
| --- | --- | --- |
| 00 | Create `nextjs-app/`: Next.js 16 + Tailwind 4 + motion + GSAP + Lenis + MDX, ESLint, Prettier; tokens into `globals.css`; fonts; copy images; `compare` script; route stubs for every page | `setup.md` |
| 01 | Shell: Navbar (desktop + mobile menu), Footer, Loader (with its intro), Cursor, smooth scroll, root layout | `shell.md` |
| 02… | One task per page section (adjacent small sections grouped to about one screen), page by page | `section.md` |
| … | One task per CMS collection: list page + detail template + all items as MDX | `collection.md` |
| last | Review and cleanup | `review.md` |

Expected for nudge-folio: about 17 tasks (setup, shell, ~5 home, ~3 about, ~2 services, contact,
playground, blog, case studies, review).

User loop (in `ai-guide/README.md`): ask the agent "Do the next task" (or name one) → `npm run
dev` in `nextjs-app/` and look at desktop and mobile → read the compare image → `git commit` →
next task. A bad result is discarded (`git checkout .`) and the task re-run with a note.

## 8. Tool changes

- New flag `--ai-guide` on the Framer export: after a successful export, run the guide step.
  Without the flag nothing changes.
- New command `framer-export ai-guide <export-dir>`: the guide step on an existing export.
- New module `src/ai-guide/` (capture of screenshots, section crops and animation recording;
  writers for `site.md`, `files.md`, `content.md`, `tokens.md`, outlines, `motion.md`, tasks;
  templates). It reuses the existing capture, page-structure, collection-detection and token code
  from `src/nextjs/` but none of its JSX/Tailwind emitters.
- A failure in the guide step never breaks the export: it writes `ai-guide/ERROR.md` and the
  export stays usable.

Out of scope: automatically driving agy/Claude through the tasks; platforms other than Framer.

## 9. Works for any Framer site — limits

The rules, templates, checklist and compare script are site-independent; the outline,
screenshots, motion notes, file map and task list are generated per site. Known limits:

- **Section names** come from Framer layer names; badly named layers give generic names the AI renames.
- **CMS collections** are detected from repeated page layouts; an unusual layout may need the user to say which pages are list pages and which are detail pages.
- **Custom behaviour** (3D, canvas, complex code components) is recorded and flagged but rebuilt by eye and may not match exactly.
- **Password-protected pages** cannot be captured.

## 10. Success criteria (nudge-folio, after the review task)

- `npm run build` and `npm run lint` pass.
- Every page looks close to the original at 1440, 1024 and 390, and stays sensible between those widths.
- Navigation works, including the mobile menu.
- The loader, entrances, typing text, clock and scroll effects are rebuilt.
- All content is editable in `content/` and MDX.
- No component file is over about 200 lines; no raw hex colours; no pixel-copied positions; no Framer runtime or class names.

## 11. Testing the tool change

- Unit tests: outline, `site.md`, `files.md`, `content.md` and task-list generation from fixture
  pages; `motion.md` from sampled values.
- Integration test: `framer-export ai-guide` on the existing fixture export writes the layout of
  section 4; an export without `--ai-guide` is byte-for-byte as before.
- Manual acceptance: on nudge-folio, run tasks 00–02 with Claude Code and with agy.
