# AI conversion kit: Framer export → clean Next.js with an AI agent

Date: 2026-11-10
Status: design approved in conversation; awaiting spec review
Branch: `feature/framer-nextjs`
Related: `2026-11-09-framer-to-nextjs-design.md` (the rule-based converter, kept as-is)

## 1. Why

The rule-based converter (`to-nextjs`) copies the rendered Framer DOM element by element.
It reaches high visual similarity on simple pages but cannot produce code a person wants
to edit: Framer's wrapper nesting, pixel insets and generic names (`Section2`,
`HeroAboutGroup` ×27) come along, every fix exposes a new layout case, and Framer's
JavaScript-driven animations (loaders, timed entrances, typing text) are invisible to it.

The user's goal is a **clean, editable Next.js project** they will later change (content,
colour theme, design). Clean code matters more than pixel identity.

New approach: a **prepare step** turns a Framer export into a **kit** — reference material plus
a clean starter project — and an AI coding agent (Claude Code or agy) writes the React
components, one small task at a time, run and checked by the user.

## 2. Decisions (from the brainstorming)

| Question | Decision |
| --- | --- |
| How the AI is run | Docs + prompts; the user runs each task in Claude Code or agy and checks it. No automatic orchestration in this phase. |
| What the AI starts from | A prepared kit: screenshots, outlines, typed content, MDX, assets, tokens, and a clean starter project. The AI writes only components. |
| How the AI learns animations | Recorded frames of the live site (load, scroll, hover) plus a measured `motion.md`. |
| How work is split | Shared shell first, then one task per page section; CMS list + detail pages as one task per collection; a final review task. |
| Scope | Any Framer site (site-specific parts are generated); nudge-folio is the first test site. |

## 3. Deliverables

### 3.1 Documents (this phase) — `docs/ai-conversion/`

Reusable for every Framer site.

| File | Reader | Content |
| --- | --- | --- |
| `README.md` | user | The workflow on one page: prepare the kit, open it in Claude Code or agy, run tasks in order, check, commit, recover from a bad task. |
| `AGENTS.md` | AI (agy, others) | Permanent rules (section 6). |
| `CLAUDE.md` | AI (Claude Code) | Same content as `AGENTS.md` (Claude Code loads `CLAUDE.md` automatically). |
| `kit-spec.md` | user, `prepare-ai` code | The exact kit layout and how each file is produced from the export (section 4). |
| `tasks/00-shell.md` | AI | Task template: the site shell. |
| `tasks/section.md` | AI | Task template: one page section. |
| `tasks/collection.md` | AI | Task template: a CMS list page and its detail template. |
| `tasks/review.md` | AI | Task template: final cleanup pass. |
| `checklist.md` | user | What to check after each task. |

### 3.2 Tool change (next phase, own implementation plan)

New CLI command `framer-export prepare-ai <export-dir>` that builds the kit (section 4).
The existing `to-nextjs` command is unchanged and stays available.

Out of scope: automatically driving agy/Claude through the tasks; platforms other than Framer.

## 4. The kit

`prepare-ai` writes `<export-dir>/site/`, the folder the user opens in the agent:

```
site/
  AGENTS.md  CLAUDE.md          rules (copied from docs/ai-conversion)
  tasks/NN-<name>.md            this site's tasks, numbered, generated from the templates
  reference/                    read-only material
    site-map.md                 routes, nav + footer links, sections shared between pages
    tokens.md                   colours, fonts, font sizes, radii, shadows — with token names
    pages/<route-slug>/
      desktop.png tablet.png mobile.png        full page at 1440 / 1024 / 390
      sections/NN-<name>-{desktop,tablet,mobile}.png
      outline.md                section list: name, size per width, text, images, links, content key
      motion.md                 measured animations (section 5)
      frames/                   load / scroll / hover frames
  app/ components/ content/ lib/ public/      clean starter project
  scripts/compare.mjs           side-by-side reference vs. result
```

### 4.1 Starter project

Reuses the parts of the current converter that are correct; emits **no** generated page
components, CSS modules or pixel-positioned classes.

- Next.js 16 (App Router), React 19, Tailwind 4, motion, GSAP + ScrollTrigger, Lenis,
  `@next/mdx`, ESLint flat config, Prettier. Builds as delivered.
- `app/globals.css`: `@theme` tokens (colours, fonts, radii, shadows), `tablet`
  (max 1199px) and `mobile` (max 809px) variants, border-box base rule.
- Fonts from the export via `@font-face`; images in `public/images` with readable names;
  favicon and Apple touch icon; per-page metadata.
- `content/<page>.ts`: typed content per page (text, image paths and sizes, links), keyed by section.
- CMS collections as MDX (`content/<collection>/<slug>.mdx`) with typed front matter and
  `lib/<collection>.ts` loaders.
- `app/**/page.tsx` stubs that render "Not built yet: <route>" so every route exists.
- `package.json` scripts: `dev`, `build`, `lint`, `format`, `compare`.

### 4.2 `outline.md` (one per page)

Replaces the 300–700 KB Framer HTML as the AI's structural input. One block per section, in
reading order:

```
## 02 Hero — 1440×900 (tablet 1024×780, mobile 390×640)
screenshot: sections/02-hero-{desktop,tablet,mobile}.png
text: "my name is" · "BEJAMAN" · "AVAILABLE FOR THOUGHTFUL PROJECTS" · "I design outstanding digital products."
tags: "Currently at Meridian Health" · "Previously at Searchless AI" · "PRODUCT DESIGNER" · "CHICAGO, IL"
images: /images/avatar.png (×2), /images/icon-target.svg, /images/icon-flower.svg
links: "Contact me" → /contact
content key: home.hero
```

Sections come from the page structure the converter already detects (top-level sections,
Framer layer names). Generic layer names ("Frame 12") are kept with a note so the AI renames
the component.

### 4.3 `scripts/compare.mjs`

`npm run compare <route>`: builds (or uses a running server), screenshots the route at 1440,
1024 and 390, and writes `reference/compare/<route>-<width>.png` with reference and result side
by side, plus a similarity number per width. It is a check for the AI and the user, not a
pass/fail gate.

## 5. Animation recording

`prepare-ai` loads each page of the live site in a headless browser and records:

- **Load:** a frame every 200 ms for the first 6 s (loader and entrance animations).
- **Scroll:** a frame at each half-screen step; a 2 s recording at one mid-page position for loops (marquees, spinners).
- **Hover:** before/after frames for elements with hover rules (buttons, links, cards).

During the load and scroll recordings it also samples the computed `opacity` and `transform`
of every visible element, and writes `motion.md` from the measurements:

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

1. **Stack.** Next.js 16 App Router; server components by default, `'use client'` only where
   there is animation or interaction. Tailwind 4 utilities with the theme tokens. motion for
   load, hover and in-view animation; GSAP ScrollTrigger only for scroll-position-linked
   animation; Lenis for smooth scroll.
2. **Structure.** `components/layout` (Navbar, Footer, Loader); `components/sections/<page>`
   (e.g. `HomeHero`); `components/ui` (Button, Tag, Card…); `components/motion` (FadeIn,
   Reveal, TypingText…).
3. **Clean code.** Layout with flex/grid, the spacing scale and `max-w-*` containers; absolute
   positioning only for genuinely overlapping decoration. Desktop-first with `tablet:` and
   `mobile:` variants, fluid between the reference widths. Colours only from tokens, never raw
   hex. Meaningful names. Anything used twice becomes a `components/ui` component. Files stay
   under about 200 lines.
4. **Content.** All text, images and links come from `content/*.ts` or MDX; components receive
   content through props. No hard-coded copy.
5. **Animation.** Follow `motion.md`; animate only transform and opacity; respect
   `prefers-reduced-motion`.
6. **Done means.** `npm run build` and `npm run lint` pass; `npm run compare <route>` was run
   and the remaining visible differences are listed in the reply; only the files named by the
   task were changed.
7. **Never.** Add a dependency without stating why; edit `reference/`; invent content; leave
   placeholder text or `TODO`s.

## 7. Task flow

Generated per site into `site/tasks/`. For nudge-folio the expected list is:

| # | Task | Template |
| --- | --- | --- |
| 00 | Shell: tokens check, Navbar (desktop + mobile menu), Footer, Loader (with its intro), Cursor, smooth scroll, root layout | `00-shell.md` |
| 01–05 | Home, one task per section | `section.md` |
| 06–08 | About sections | `section.md` |
| 09–10 | Services sections | `section.md` |
| 11 | Contact | `section.md` |
| 12 | Playground | `section.md` |
| 13 | Blog list + post template (8 posts) | `collection.md` |
| 14 | Case-study list + case-study template (4) | `collection.md` |
| 15 | Review and cleanup | `review.md` |

Small adjacent sections of one page may be grouped into one task so that a task covers roughly
one screen of design. Each task prompt states: goal; reference files to read; files to create
or change; shared components to reuse; done checks.

User loop (in `README.md`): run one task (`Do tasks/03-home-featured-works.md`) → `npm run dev`
and look at desktop and mobile → read the compare image → `git commit` → next task. A bad
result is discarded (`git checkout .`) and the task re-run with a note.

## 8. Works for any Framer site — limits

The rules, templates, checklist and compare script are site-independent; the outline,
screenshots, motion notes and task list are generated per site. Known limits:

- **Section names** come from Framer layer names; badly named layers give generic names that the AI renames.
- **CMS collections** are detected automatically (as in the current converter); an unusual layout may need the user to state which pages are list pages and which are detail pages.
- **Custom behaviour** (3D, canvas, complex code components) is recorded and flagged, but rebuilt by eye and may not match exactly.
- **Password-protected pages** cannot be captured.

## 9. Success criteria (nudge-folio, after the review task)

- `npm run build` and `npm run lint` pass.
- Every page looks close to the original at 1440, 1024 and 390, and stays sensible between those widths.
- Navigation works, including the mobile menu.
- The loader, entrances, typing text, clock and scroll effects are rebuilt.
- All content is editable in `content/` and MDX.
- No component file is over about 200 lines; no raw hex colours; no pixel-copied positions.

## 10. Testing the tool change (next phase)

- Unit tests for outline generation, task-list generation and `motion.md` writing from sampled values.
- Integration test: `prepare-ai` on the existing fixture export produces the kit layout of section 4, and the starter project builds.
- Manual acceptance: run tasks 00 and 01 on nudge-folio with Claude Code and with agy.
