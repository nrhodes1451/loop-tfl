/**
 * Rasterize the TfL FOI axonometric sheets listed in data/foi/pages.json.
 *
 * Usage: npm run foi:render
 *        npm run foi:render -- --force
 * Requires: pdftoppm (poppler-utils). Offline and deterministic — nothing here
 * interprets a drawing; reading the sheets is the next step in the loop.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { foiSheetStem } from "../src/lib/schematic/foi-extract";
import type { FoiPageIndex } from "../src/lib/schematic/foi-match";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const PDF_DIR = path.join(ROOT, "data", "pdf");
const CACHE_DIR = path.join(PDF_DIR, ".pages");
const PAGES_PATH = path.join(ROOT, "data", "foi", "pages.json");
const DPI = 200;
/** Long edge of the downscaled sheet that gets read. */
const VIEW_MAX_EDGE = 1536;

export function sheetRasterPaths(
  file: string,
  page: number,
): { png: string; view: string } {
  const stem = foiSheetStem(file, page);
  return {
    png: path.join(CACHE_DIR, `${stem}.png`),
    view: path.join(CACHE_DIR, `${stem}-view.jpg`),
  };
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function rasterizePng(
  pdfPath: string,
  page: number,
  pngPath: string,
): Promise<void> {
  const prefix = pngPath.replace(/\.png$/i, "");
  await execFileAsync("pdftoppm", [
    "-png",
    "-r",
    String(DPI),
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    pdfPath,
    prefix,
  ]);
}

async function rasterizeView(
  pdfPath: string,
  page: number,
  viewPath: string,
): Promise<void> {
  const prefix = viewPath.replace(/\.jpe?g$/i, "");
  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-jpegopt",
    "quality=80",
    "-scale-to",
    String(VIEW_MAX_EDGE),
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    pdfPath,
    prefix,
  ]);
}

export async function renderFoiPages(opts: { force?: boolean }): Promise<{
  rendered: number;
  skipped: number;
  total: number;
}> {
  if (!(await commandExists("pdftoppm"))) {
    throw new Error("Missing pdftoppm. Install with: sudo apt install poppler-utils");
  }
  const index = JSON.parse(await readFile(PAGES_PATH, "utf8")) as FoiPageIndex;
  await mkdir(CACHE_DIR, { recursive: true });

  const force = opts.force === true;
  let rendered = 0;
  let skipped = 0;
  for (const [i, entry] of index.pages.entries()) {
    const pdfPath = path.join(PDF_DIR, entry.file);
    const { png, view } = sheetRasterPaths(entry.file, entry.page);
    const needPng = force || !(await fileExists(png));
    const needView = force || !(await fileExists(view));
    if (!needPng && !needView) {
      skipped += 1;
      continue;
    }
    process.stderr.write(
      `render ${entry.file} p${entry.page} (${i + 1}/${index.pages.length})\n`,
    );
    if (needPng) await rasterizePng(pdfPath, entry.page, png);
    if (needView) await rasterizeView(pdfPath, entry.page, view);
    rendered += 1;
  }
  return { rendered, skipped, total: index.pages.length };
}

export async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const { rendered, skipped, total } = await renderFoiPages({ force });
  console.log(
    `Rendered ${rendered} of ${total} sheet(s) to ${path.relative(ROOT, CACHE_DIR)}` +
      (skipped > 0 ? ` (${skipped} already present)` : ""),
  );
}

const isCli = process.argv[1]?.includes("render-foi-pages");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
