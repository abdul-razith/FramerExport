import fs from 'node:fs/promises';
import path from 'node:path';
import { log, warn, success } from '../logger/index.js';
import type { NextjsOptions } from './options.js';
import { emptyReport, renderReport, type ConversionReport } from './report.js';

export interface ConversionSource {
  outDir: string;
  siteUrl: string;
  platform: { name: string };
  subpages: Map<string, string>;
}

interface ExportReport {
  source?: string;
  platform?: string;
}

async function readExportReport(exportDir: string): Promise<ExportReport | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(exportDir, 'export-report.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function convert(
  exportDir: string,
  sourceUrl: string,
  _options: NextjsOptions
): Promise<ConversionReport> {
  const report = emptyReport();
  report.fatal = `Next.js conversion pipeline not implemented yet (source: ${sourceUrl}).`;
  const outDir = path.join(exportDir, 'nextjs');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'CONVERSION-REPORT.md'), renderReport(report));
  return report;
}

/** Called after a successful export. Never throws: the static export must stay usable. */
export async function runNextConversion(
  exporter: ConversionSource,
  options: NextjsOptions
): Promise<void> {
  if (exporter.platform.name !== 'framer') {
    warn('Next.js conversion supports Framer sites only; skipped');
    return;
  }
  try {
    log('Starting Next.js conversion...');
    const report = await convert(exporter.outDir, exporter.siteUrl, options);
    if (report.fatal) warn('Next.js conversion did not complete. See nextjs/CONVERSION-REPORT.md');
    else success('Next.js project written to nextjs/');
  } catch (e) {
    warn('Next.js conversion failed: ' + (e as Error).message);
  }
}

/** `framer-export to-nextjs <export-dir>`. Returns the process exit code. */
export async function runToNextjs(exportDir: string, options: NextjsOptions): Promise<number> {
  const exportReport = await readExportReport(exportDir);
  if (!exportReport || !exportReport.source) {
    warn(`${exportDir} is not a framer-export output folder (export-report.json missing or invalid)`);
    return 1;
  }
  if (exportReport.platform !== 'framer') {
    warn(
      `Next.js conversion supports Framer exports only; this export is "${exportReport.platform ?? 'unknown'}"`
    );
    return 1;
  }
  try {
    const report = await convert(exportDir, exportReport.source, options);
    return report.fatal ? 1 : 0;
  } catch (e) {
    warn('Next.js conversion failed: ' + (e as Error).message);
    return 1;
  }
}
