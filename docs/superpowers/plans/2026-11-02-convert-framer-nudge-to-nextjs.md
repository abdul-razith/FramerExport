# Convert Framer Nudge to Next.js App Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the exported Framer "Nudge" portfolio template into a clean, maintainable, production-ready Next.js App Router application with TypeScript and Tailwind CSS while faithfully preserving visual design, responsive layouts, assets, and all 19 exported routes.

**Architecture:** A modern Next.js App Router architecture in `out/framer-nudge/converted-nextjs`. Reusable shared layouts (`Navigation`, `Footer`, fonts, and CSS variables), semantic page sections, typed data modules (`data/case-studies.ts`, `data/blog.ts`, `data/services.ts`), and dynamic routes with `generateStaticParams` for pre-rendered performance and exact content fidelity.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS, Vitest / Node test runner.

**Spec:** `D:\ABDUL\SW\NewFolder\ME\New folder\nocodexport\FramerExport\out\framer-nudge\ai\other-ai-nextjs-app-router-clean-rebuild-prompt.md`

## Global Constraints

- Target directory: `D:\ABDUL\SW\NewFolder\ME\New folder\nocodexport\FramerExport\out\framer-nudge\converted-nextjs`.
- Do not delete or mutate any files in the original export folder `out/framer-nudge/`.
- Do not invent brand names, copy, images, links, animations, colors, or sections. Use only real information found in `index.html`, subpages, CSS, and data.
- Copy exported assets from `out/framer-nudge/assets/*` to `converted-nextjs/public/assets/*` without renaming or placeholders.
- Update every image, font, and CSS asset reference to framework-relative paths (`/assets/...`).
- Maintain full responsiveness across desktop (>=1200px), tablet (810px-1199px), and mobile (<810px).
- Provide all 19 routes: Home (`/`), About (`/about`), Services (`/services`), Contact (`/contact`), Playground (`/play-ground`), Case Study Index (`/case-study`), 4 Case Study detail pages (`/case-study/[slug]`), Blog Index (`/blog`), and 8 Blog detail pages (`/blog/[slug]`).
- App must pass linting, typechecking, and production build (`npm run build`).
- Document migration decisions in `converted-nextjs/README.md`.

## Review Focus

- Asset 404s: Images, SVGs, or fonts failing to load due to incorrect `/assets/...` path resolution.
- Dynamic Route Parity: Missing or mismatched slugs in `generateStaticParams` for the 4 case studies or 8 blog posts.
- Viewport Overflow / Mobile Breakpoints: Layout horizontally scrolling or clipping on screens below 810px.
- Contact Form State Transition: Two-step contact form ("Where to find you" -> "What's on your mind") failing to step smoothly or validate input.
- CSS Variables / Font Rendering: Missing `--token-...` variables or broken `@font-face` definitions degrading typography and theme colors.

---

### Task 1: Project Scaffolding & Asset Integration

**Files:**
- Create: `out/framer-nudge/converted-nextjs/package.json`
- Create: `out/framer-nudge/converted-nextjs/tsconfig.json`
- Create: `out/framer-nudge/converted-nextjs/next.config.mjs`
- Create: `out/framer-nudge/converted-nextjs/tailwind.config.ts`
- Create: `out/framer-nudge/converted-nextjs/postcss.config.mjs`
- Create: `out/framer-nudge/converted-nextjs/public/assets/*` (copied)

**Interfaces:**
- Consumes: Static assets from `out/framer-nudge/assets/*`
- Produces: Runnable Next.js App Router base with assets served from `/assets/*`

- [ ] **Step 1: Scaffold Next.js project with App Router, TypeScript, and Tailwind CSS**

Run scaffold command inside `out/framer-nudge`:
```bash
npx create-next-app@latest converted-nextjs --ts --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm --yes
```

- [ ] **Step 2: Copy exported assets into `public/assets`**

Run PowerShell command:
```powershell
New-Item -ItemType Directory -Force -Path "out/framer-nudge/converted-nextjs/public/assets"
Copy-Item -Path "out/framer-nudge/assets/*" -Destination "out/framer-nudge/converted-nextjs/public/assets" -Recurse -Force
```

- [ ] **Step 3: Configure `next.config.mjs` for static assets and image optimization**

Set `next.config.mjs` to allow unoptimized image loading for local AVIF/SVG/PNG assets and custom headers if needed:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
};
export default nextConfig;
```

- [ ] **Step 4: Verify scaffold builds cleanly**

Run in `out/framer-nudge/converted-nextjs`:
```bash
npm run build
```
Expected: PASS with `.next` generated and no errors.

- [ ] **Step 5: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(scaffold): initialize Next.js App Router project and integrate assets"
```

---

### Task 2: Design Tokens, Typography, and Global Layout (`Navigation` & `Footer`)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/app/globals.css`
- Create: `out/framer-nudge/converted-nextjs/components/layout/Navigation.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/layout/Footer.tsx`
- Modify: `out/framer-nudge/converted-nextjs/app/layout.tsx`
- Create: `out/framer-nudge/converted-nextjs/tests/layout.test.ts`

**Interfaces:**
- Consumes: `@font-face` definitions and `--token-...` CSS variables from exported CSS
- Produces: `<Navigation />` and `<Footer />` components wrapping all routes in `<RootLayout />`

- [ ] **Step 1: Write tests for navigation and layout elements**

Create `tests/layout.test.ts` verifying that Navigation contains the 6 key links (`/`, `/about`, `/case-study`, `/services`, `/blog`, `/play-ground`, `/contact`) and Footer contains social links and CTA.

- [ ] **Step 2: Run layout test to verify it fails**

Run: `npx vitest run tests/layout.test.ts` or `node --test tests/layout.test.js`
Expected: FAIL (modules not yet implemented).

- [ ] **Step 3: Extract and define CSS variables and `@font-face` in `globals.css`**

Add all custom properties found in the export:
- `--token-341b58e0-d728-43ce-a1dc-e77a522cab4f` (primary background `#ffffff`)
- `--token-82f3ef84-5f56-4c40-9b43-41f237efb99e` (text color `#111111`)
- `--token-eee4728f-06ef-4d99-9d02-ac8944e7f6d5` (border/grid lines `#e5e5e5`)
- Local `@font-face` definitions referencing `/assets/fonts/*.woff2`.

- [ ] **Step 4: Implement `Navigation.tsx`**

Build responsive navbar with:
- Brand logo: "Bejaman / Nudge" linking to `/`.
- Desktop navigation links: Home, About, Case study, Services, Journal, Playground, Contact.
- Mobile menu toggle (hamburger) that reveals navigation overlay with smooth transition.

- [ ] **Step 5: Implement `Footer.tsx`**

Build shared footer with:
- CTA header: "Let's Talk", "I'm available for new projects!".
- Social links: Facebook, Instagram, LinkedIn, Contact.
- Clean copyright notice and back-to-top button.

- [ ] **Step 6: Update `app/layout.tsx`**

Wrap children in `<Navigation />` and `<Footer />` with proper `<html lang="en">` and metadata.

- [ ] **Step 7: Run layout test to verify it passes**

Run: `npx vitest run tests/layout.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(layout): implement global tokens, fonts, Navigation, and Footer"
```

---

### Task 3: Content Model & Data Layer (Case Studies, Blog, Services)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/types/index.ts`
- Create: `out/framer-nudge/converted-nextjs/data/case-studies.ts`
- Create: `out/framer-nudge/converted-nextjs/data/blog.ts`
- Create: `out/framer-nudge/converted-nextjs/data/services.ts`
- Create: `out/framer-nudge/converted-nextjs/tests/data.test.ts`

**Interfaces:**
- Consumes: Content extracted from `subpages/case-study_*.html` and `subpages/blog_*.html`
- Produces: Strongly typed data arrays `caseStudies`, `blogPosts`, `servicesList` with query helpers `getCaseStudyBySlug(slug)` and `getBlogPostBySlug(slug)`.

- [ ] **Step 1: Write unit tests verifying data integrity**

Create `tests/data.test.ts` checking:
- Exactly 4 case studies: `meridian-health`, `stylebook`, `homestead`, `north-light`.
- Exactly 8 blog posts: `a-greener-workspace`, `beyond-the-screen`, `everyday-beauty`, `geometry-builds-trust`, `ideas-need-silence`, `materials-and-memory`, `the-creative-desk`, `the-power-of-focus`.
- Every item has valid slug, title, summary, date/year, and image assets.

- [ ] **Step 2: Run data test to verify failure**

Run: `npx vitest run tests/data.test.ts`
Expected: FAIL with missing modules.

- [ ] **Step 3: Define TypeScript interfaces in `types/index.ts`**

Define `CaseStudy`, `BlogPost`, `ServiceItem`, `Testimonial`, `Award`.

- [ ] **Step 4: Extract and populate data modules**

- `data/case-studies.ts`: Extract full content, client name, services delivered, year, gallery images, and section texts from the 4 case study subpages.
- `data/blog.ts`: Extract full article paragraphs, headings, publication dates, and tags from the 8 blog subpages.
- `data/services.ts`: Extract services items (Product Design, Web Design, Design Systems, Creative Direction) and process phases (Discover, Define, Design, Deliver).

- [ ] **Step 5: Run data test to verify PASS**

Run: `npx vitest run tests/data.test.ts`
Expected: PASS (all 4 case studies and 8 blog posts present with complete fields).

- [ ] **Step 6: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(data): extract typed CMS content for case studies, blog, and services"
```

---

### Task 4: Reconstruct Home Page (`app/page.tsx`)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/components/home/Hero.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/home/FeaturedWorks.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/home/ServicesTeaser.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/home/AboutPreview.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/home/JournalTeaser.tsx`
- Modify: `out/framer-nudge/converted-nextjs/app/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/tests/home.test.ts`

**Interfaces:**
- Consumes: `caseStudies`, `blogPosts`, `servicesList`
- Produces: Fully assembled, faithful Home Page matching `index.html`.

- [ ] **Step 1: Write test for Home page rendering**

Create `tests/home.test.ts` verifying Hero text ("my name is Bejaman"), Featured Works cards, and teaser sections exist in Home page component.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/home.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `Hero.tsx`**

Faithfully construct the hero section from `index.html`:
- Headline: "my name is Bejaman", "about me! what's up", "2026", "my workspace".
- Avatar / Workspace imagery.
- Skill badges: "Interaction Design", "Prototyping", "User Research", "Motion Design".

- [ ] **Step 4: Implement `FeaturedWorks.tsx`**

Render featured case studies with:
- Section title: "FEATURED WORKS".
- Project cards with high-res thumbnails, tags, and direct links to `/case-study/[slug]`.
- Hover and transition effects matching original design.

- [ ] **Step 5: Implement `ServicesTeaser.tsx`, `AboutPreview.tsx`, and `JournalTeaser.tsx`**

- `ServicesTeaser.tsx`: Core capabilities grid.
- `AboutPreview.tsx`: Bio snippet, experience highlights, and link to `/about`.
- `JournalTeaser.tsx`: Latest 3 blog articles with dates and link to `/blog`.

- [ ] **Step 6: Assemble `app/page.tsx`**

Integrate all components into `app/page.tsx` with proper layout spacing and semantic sections.

- [ ] **Step 7: Run test to verify PASS**

Run: `npx vitest run tests/home.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(home): reconstruct complete Home page with Hero, Featured Works, and teasers"
```

---

### Task 5: Reconstruct Core Static Subpages (About, Services, Contact, Playground)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/app/about/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/app/services/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/app/contact/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/app/play-ground/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/components/contact/ContactForm.tsx`
- Create: `out/framer-nudge/converted-nextjs/tests/subpages.test.ts`

**Interfaces:**
- Consumes: Data and assets corresponding to `about.html`, `services.html`, `contact.html`, and `play-ground.html`
- Produces: `/about`, `/services`, `/contact`, `/play-ground` routes.

- [ ] **Step 1: Write tests for static subpages**

Create `tests/subpages.test.ts` verifying all 4 subpage components export default and render required headings and controls.

- [ ] **Step 2: Run subpages test to verify failure**

Run: `npx vitest run tests/subpages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `app/about/page.tsx`**

Recreate About page from `subpages/about.html`:
- Headline: "About", "Main bio".
- Core philosophies: "Starting with why, not what", "Designing for real constraints", "Collaboration over hero design", "Making the invisible visible".
- Experience list, awards, and visual portraits.

- [ ] **Step 4: Implement `app/services/page.tsx`**

Recreate Services page from `subpages/services.html`:
- Services breakdown: Product Design, Web Design, Design Systems, Creative Direction.
- Process timeline: Discover, Define, Design, Deliver.
- Deliverables checklist and pricing/engagement callout.

- [ ] **Step 5: Implement `app/contact/page.tsx` and `ContactForm.tsx`**

Recreate Contact page from `subpages/contact.html`:
- Interactive 2-step form:
  - Step 1: "Where to find you?" (Email input) -> Next button
  - Step 2: "What's on your mind?" (Message textarea) -> Submit button
- Availability status indicator ("I'm available for new projects!").
- Social profiles and email copy.

- [ ] **Step 6: Implement `app/play-ground/page.tsx`**

Recreate Playground page from `subpages/play-ground.html`:
- Dynamic masonry/grid showcase of 14+ design assets, 3D renders, and UI experiments.
- Responsive column layout with lightbox/zoom preview if applicable.

- [ ] **Step 7: Run subpages test to verify PASS**

Run: `npx vitest run tests/subpages.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(pages): implement About, Services, Contact with 2-step form, and Playground"
```

---

### Task 6: Reconstruct Case Studies System (`/case-study` and `/case-study/[slug]`)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/app/case-study/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/app/case-study/[slug]/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/tests/case-studies.test.ts`

**Interfaces:**
- Consumes: `caseStudies` from `data/case-studies.ts`
- Produces: `/case-study` listing and 4 static routes via `generateStaticParams`:
  - `/case-study/meridian-health`
  - `/case-study/stylebook`
  - `/case-study/homestead`
  - `/case-study/north-light`

- [ ] **Step 1: Write tests for Case Study routes and static params**

Create `tests/case-studies.test.ts` testing:
- `generateStaticParams()` returns all 4 slugs.
- Listing page renders all 4 case study cards.
- Detail page renders project overview, client, deliverables, year, and image showcase.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/case-studies.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `app/case-study/page.tsx`**

Build Case Study archive page from `subpages/case-study.html`:
- Page header: "Case studies".
- Grid of case studies with project tags, year, hero thumbnail, and link to slug route.

- [ ] **Step 4: Implement `app/case-study/[slug]/page.tsx`**

Build dynamic case study reader:
- Implement `generateStaticParams()` returning `[{ slug: 'meridian-health' }, { slug: 'stylebook' }, { slug: 'homestead' }, { slug: 'north-light' }]`.
- Implement `generateMetadata()` setting page title and description.
- Render hero image, project brief, challenges, solution, multi-image gallery showcase, and next project navigator.

- [ ] **Step 5: Run test to verify PASS**

Run: `npx vitest run tests/case-studies.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(case-studies): implement archive and static dynamic case study detail routes"
```

---

### Task 7: Reconstruct Journal / Blog System (`/blog` and `/blog/[slug]`)

**Files:**
- Create: `out/framer-nudge/converted-nextjs/app/blog/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/app/blog/[slug]/page.tsx`
- Create: `out/framer-nudge/converted-nextjs/tests/blog.test.ts`

**Interfaces:**
- Consumes: `blogPosts` from `data/blog.ts`
- Produces: `/blog` listing and 8 static routes via `generateStaticParams`:
  - `/blog/a-greener-workspace`
  - `/blog/beyond-the-screen`
  - `/blog/everyday-beauty`
  - `/blog/geometry-builds-trust`
  - `/blog/ideas-need-silence`
  - `/blog/materials-and-memory`
  - `/blog/the-creative-desk`
  - `/blog/the-power-of-focus`

- [ ] **Step 1: Write tests for Blog routes and static params**

Create `tests/blog.test.ts` testing:
- `generateStaticParams()` returns all 8 slugs.
- Blog index renders all 8 article cards with date and reading time.
- Blog detail page renders article title, meta header, full paragraphs, and related articles.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/blog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `app/blog/page.tsx`**

Build Blog archive page from `subpages/blog.html`:
- Page title: "Journal".
- Article list with publication date, title, excerpt, category/tag, and reading time.

- [ ] **Step 4: Implement `app/blog/[slug]/page.tsx`**

Build dynamic blog post reader:
- Implement `generateStaticParams()` returning all 8 post slugs.
- Implement `generateMetadata()` with article title and description.
- Render typography layout: title, author, date, featured image, article body with blockquotes and formatted paragraphs, and "Next Article" link.

- [ ] **Step 5: Run test to verify PASS**

Run: `npx vitest run tests/blog.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "feat(blog): implement Journal index and 8 dynamic article pages with static params"
```

---

### Task 8: Interactivity, SEO Metadata, Verification & Documentation

**Files:**
- Create: `out/framer-nudge/converted-nextjs/components/ui/SmoothScroll.tsx`
- Modify: `out/framer-nudge/converted-nextjs/app/layout.tsx` (add metadata & smooth scroll)
- Create: `out/framer-nudge/converted-nextjs/README.md`
- Create: `out/framer-nudge/converted-nextjs/tests/e2e-routes.test.ts`

**Interfaces:**
- Consumes: All 19 converted routes and assets
- Produces: Complete production build, verified route graph, and comprehensive README.

- [ ] **Step 1: Write E2E routes test verifying all 19 routes resolve**

Create `tests/e2e-routes.test.ts` listing all 19 URLs (`/`, `/about`, `/services`, `/contact`, `/play-ground`, `/case-study`, 4 case study slugs, `/blog`, 8 blog slugs) and asserting valid component trees.

- [ ] **Step 2: Add smooth scroll and page interaction polish**

Implement clean client scroll behavior and transition enhancements.

- [ ] **Step 3: Verify all 19 routes compile in production build**

Run in `out/framer-nudge/converted-nextjs`:
```bash
npm run build
```
Verify stdout shows 19 pre-rendered static routes (○ or ●) without errors:
- `/`
- `/about`
- `/services`
- `/contact`
- `/play-ground`
- `/case-study`
- `/case-study/meridian-health`
- `/case-study/stylebook`
- `/case-study/homestead`
- `/case-study/north-light`
- `/blog`
- `/blog/a-greener-workspace`
- `/blog/beyond-the-screen`
- `/blog/everyday-beauty`
- `/blog/geometry-builds-trust`
- `/blog/ideas-need-silence`
- `/blog/materials-and-memory`
- `/blog/the-creative-desk`
- `/blog/the-power-of-focus`

- [ ] **Step 4: Create `converted-nextjs/README.md`**

Document:
- Source export location: `out/framer-nudge`.
- Target stack: Next.js App Router, TypeScript, Tailwind CSS.
- Project structure: `app/`, `components/`, `data/`, `public/assets/`, `types/`.
- Setup instructions (`npm install`, `npm run dev`, `npm run build`).
- Route manifest (all 19 routes).
- Verified behaviors (responsive nav, 2-step contact form, case studies, journal reader, masonry playground).

- [ ] **Step 5: Run all test suites and linting**

Run in `out/framer-nudge/converted-nextjs`:
```bash
npm test
npm run lint
```
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add out/framer-nudge/converted-nextjs
git commit -m "chore: complete Next.js conversion verification and add project documentation"
```
