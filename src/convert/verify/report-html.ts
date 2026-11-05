export interface ReportData {
  generatedAt: string;
  totalMs: number;
  pages: Array<{
    route: string;
    sections: Array<{
      name: string;
      widths: Array<{
        width: number;
        ratio: number;
        pass: boolean;
        images: {
          original: string;
          next: string;
          diff: string;
        };
      }>;
    }>;
    filmstrip: {
      original: string[];
      next: string[];
    };
  }>;
  needsReview: string[];
  stubs: string[];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a self-contained, responsive HTML report displaying:
 * - Summary statistics header
 * - Prominent alert banners for needsReview tasks and stubs
 * - Side-by-side original/next/diff comparisons per section and width
 * - Filmstrip timelines
 */
export function renderReportHtml(d: ReportData): string {
  const esc = escapeHtml;
  const totalSec = (d.totalMs / 1000).toFixed(1);
  const totalSections = d.pages.reduce((acc, p) => acc + p.sections.length, 0);

  let needsReviewHtml = '';
  if (d.needsReview && d.needsReview.length > 0) {
    needsReviewHtml = `
      <section class="banner banner-review">
        <h2>Tasks Needing Review (${d.needsReview.length})</h2>
        <ul>
          ${d.needsReview.map((id) => `<li><code>${esc(id)}</code></li>`).join('')}
        </ul>
      </section>
    `;
  }

  let stubsHtml = '';
  if (d.stubs && d.stubs.length > 0) {
    stubsHtml = `
      <section class="banner banner-stubs">
        <h2>Placeholder Stubs (${d.stubs.length})</h2>
        <ul>
          ${d.stubs.map((s) => `<li><code>${esc(s)}</code></li>`).join('')}
        </ul>
      </section>
    `;
  }

  let pagesHtml = '';
  for (const page of d.pages) {
    let sectionsHtml = '';
    for (const sec of page.sections) {
      let widthsHtml = '';
      for (const w of sec.widths) {
        const pct = (w.ratio * 100).toFixed(2);
        const badgeClass = w.pass ? 'pass' : 'fail';
        widthsHtml += `
          <div class="width-block">
            <div class="width-header">
              <span class="width-label">${w.width}px</span>
              <span class="badge ${badgeClass}">${w.pass ? 'PASS' : 'FAIL'}</span>
              <span class="ratio-label">${pct}% diff</span>
            </div>
            <div class="comparison-grid">
              <div class="image-col">
                <div class="col-title">Original (Export)</div>
                <img src="${esc(w.images.original)}" alt="Original ${esc(sec.name)} @ ${w.width}px" loading="lazy" />
              </div>
              <div class="image-col">
                <div class="col-title">Next.js</div>
                <img src="${esc(w.images.next)}" alt="Next ${esc(sec.name)} @ ${w.width}px" loading="lazy" />
              </div>
              <div class="image-col">
                <div class="col-title">Diff</div>
                <img src="${esc(w.images.diff)}" alt="Diff ${esc(sec.name)} @ ${w.width}px" loading="lazy" />
              </div>
            </div>
          </div>
        `;
      }

      sectionsHtml += `
        <div class="section-card">
          <h3 class="section-name">${esc(sec.name)}</h3>
          ${widthsHtml}
        </div>
      `;
    }

    let filmstripHtml = '';
    if (page.filmstrip && (page.filmstrip.original.length > 0 || page.filmstrip.next.length > 0)) {
      filmstripHtml = `
        <div class="filmstrip-card">
          <h3>Filmstrip</h3>
          ${
            page.filmstrip.original.length > 0
              ? `
            <div class="filmstrip-row">
              <h4>Original</h4>
              <div class="filmstrip-frames">
                ${page.filmstrip.original
                  .map(
                    (src, i) => `
                    <div class="frame">
                      <span class="frame-num">Frame ${i + 1}</span>
                      <img src="${esc(src)}" alt="Original frame ${i + 1}" loading="lazy" />
                    </div>
                  `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
          ${
            page.filmstrip.next.length > 0
              ? `
            <div class="filmstrip-row">
              <h4>Next.js</h4>
              <div class="filmstrip-frames">
                ${page.filmstrip.next
                  .map(
                    (src, i) => `
                    <div class="frame">
                      <span class="frame-num">Frame ${i + 1}</span>
                      <img src="${esc(src)}" alt="Next frame ${i + 1}" loading="lazy" />
                    </div>
                  `
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>
      `;
    }

    pagesHtml += `
      <section class="page-section">
        <h2 class="route-title">Page: <code>${esc(page.route)}</code></h2>
        ${filmstripHtml}
        ${sectionsHtml}
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Conversion Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --pass: #10b981;
      --pass-bg: rgba(16, 185, 129, 0.15);
      --fail: #ef4444;
      --fail-bg: rgba(239, 68, 68, 0.15);
      --review: #f59e0b;
      --review-bg: rgba(245, 158, 11, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    header {
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 14px;
      color: var(--text-muted);
    }
    .stat-item {
      background: var(--card-bg);
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .stat-value { font-weight: 600; color: var(--text); }
    .banner {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .banner-review { border-left: 4px solid var(--review); background: var(--review-bg); }
    .banner-stubs { border-left: 4px solid #6366f1; background: rgba(99, 102, 241, 0.15); }
    .banner h2 { font-size: 18px; margin-bottom: 12px; }
    .banner ul { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
    .banner li code {
      background: rgba(0, 0, 0, 0.3);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 13px;
    }
    .page-section { margin-bottom: 40px; }
    .route-title { font-size: 22px; margin-bottom: 20px; color: #38bdf8; }
    .route-title code { background: rgba(56, 189, 248, 0.1); padding: 2px 8px; border-radius: 4px; }
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .section-name { font-size: 18px; margin-bottom: 16px; }
    .width-block {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .width-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
      font-size: 14px;
    }
    .width-label { font-weight: 600; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .badge.pass { color: var(--pass); background: var(--pass-bg); border: 1px solid var(--pass); }
    .badge.fail { color: var(--fail); background: var(--fail-bg); border: 1px solid var(--fail); }
    .ratio-label { color: var(--text-muted); font-size: 13px; }
    .comparison-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .image-col {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .col-title { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
    .image-col img {
      width: 100%;
      height: auto;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: #000;
      display: block;
    }
    .filmstrip-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .filmstrip-card h3 { font-size: 18px; margin-bottom: 16px; }
    .filmstrip-row { margin-bottom: 16px; }
    .filmstrip-row h4 { font-size: 14px; color: var(--text-muted); margin-bottom: 8px; }
    .filmstrip-frames {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
    }
    .frame {
      flex: 0 0 160px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .frame-num { font-size: 11px; color: var(--text-muted); }
    .frame img {
      width: 100%;
      height: auto;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <header>
    <h1>Conversion Report</h1>
    <div class="stats">
      <div class="stat-item">Generated: <span class="stat-value">${esc(d.generatedAt)}</span></div>
      <div class="stat-item">Duration: <span class="stat-value">${totalSec}s</span></div>
      <div class="stat-item">Pages: <span class="stat-value">${d.pages.length}</span></div>
      <div class="stat-item">Sections: <span class="stat-value">${totalSections}</span></div>
      <div class="stat-item">Needs Review: <span class="stat-value">${d.needsReview.length}</span></div>
      <div class="stat-item">Stubs: <span class="stat-value">${d.stubs.length}</span></div>
    </div>
  </header>
  <main>
    ${needsReviewHtml}
    ${stubsHtml}
    ${pagesHtml}
  </main>
</body>
</html>
`;
}
