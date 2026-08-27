/**
 * Rasterize the TfL FOI axonometric sheets listed in data/foi/pages.json
 * into the reading pose (title left-to-right, rose typically up).
 *
 * Usage: npm run foi:render
 *        npm run foi:render -- --force
 * Requires: pdftoppm (poppler-utils). Offline and deterministic — nothing here
 * interprets a drawing; reading the sheets is the next step in the loop.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
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
/**
 * Extra clockwise rotation after pdftoppm honours PDF /Rotate 270, so the
 * raster matches the landscape reading pose (title along the top/bottom).
 */
export const READING_ROTATION_CW = 270;

export function sheetRasterPaths(
  file: string,
  page: number,
): { png: string; view: string } {
  const stem = foiSheetStem(file, page);
  return {
    png: path.join(CACHE_DIR, `${stem}-read.png`),
    view: path.join(CACHE_DIR, `${stem}-read.jpg`),
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

async function rasterize(
  pdfPath: string,
  page: number,
  tmpPrefix: string,
  kind: "png" | "jpeg",
): Promise<string> {
  const args =
    kind === "png"
      ? ["-png", "-r", String(DPI)]
      : [
          "-jpeg",
          "-jpegopt",
          "quality=80",
          "-scale-to",
          String(VIEW_MAX_EDGE),
        ];
  await execFileAsync("pdftoppm", [
    ...args,
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    pdfPath,
    tmpPrefix,
  ]);
  return kind === "png" ? `${tmpPrefix}.png` : `${tmpPrefix}.jpg`;
}

async function rotateToReadingPose(
  src: string,
  dest: string,
): Promise<void> {
  await sharp(src)
    .rotate(READING_ROTATION_CW)
    .toFile(dest);
  await unlink(src);
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
    const stem = foiSheetStem(entry.file, entry.page);
    if (needPng) {
      const tmp = path.join(CACHE_DIR, `.tmp-${stem}-png`);
      const raw = await rasterize(pdfPath, entry.page, tmp, "png");
      await rotateToReadingPose(raw, png);
    }
    if (needView) {
      const tmp = path.join(CACHE_DIR, `.tmp-${stem}-jpg`);
      const raw = await rasterize(pdfPath, entry.page, tmp, "jpeg");
      await rotateToReadingPose(raw, view);
    }
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
