/**
 * Rasterize TfL FOI axonometric PDFs, OCR titles, and match pages to
 * data/network.json stations.
 *
 * Usage: npm run index-foi-pages
 * Requires: pdftoppm (poppler-utils). Uses `tesseract` if on PATH,
 * otherwise tesseract.js.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { createWorker, type Worker } from "tesseract.js";
import {
  applyFoiOverrides,
  lineIdFromFilename,
  matchFoiPage,
  unresolvedFoiPages,
  type FoiPage,
  type FoiPageIndex,
  type FoiPageOverride,
  type FoiStation,
} from "../src/lib/schematic/foi-match";
import type { NetworkData } from "../src/lib/types";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const PDF_DIR = path.join(ROOT, "data", "pdf");
const CACHE_DIR = path.join(PDF_DIR, ".pages");
const FOI_DIR = path.join(ROOT, "data", "foi");
const PAGES_PATH = path.join(FOI_DIR, "pages.json");
const OVERRIDES_PATH = path.join(FOI_DIR, "pages.overrides.json");
const NETWORK_PATH = path.join(ROOT, "data", "network.json");
const DPI = 200;
const TITLE_BAND = 0.32;

function cropTop(src: PNG, fraction: number): PNG {
  const height = Math.max(1, Math.round(src.height * fraction));
  const dst = new PNG({ width: src.width, height });
  const bytes = src.width * height * 4;
  dst.data.set(src.data.subarray(0, bytes));
  return dst;
}

function rotate90CCW(src: PNG): PNG {
  const dst = new PNG({ width: src.height, height: src.width });
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const si = (src.width * y + x) << 2;
      const dx = y;
      const dy = src.width - 1 - x;
      const di = (dst.width * dy + dx) << 2;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = src.data[si + 3]!;
    }
  }
  return dst;
}

async function writeTitleStrip(pagePng: string, titlePng: string): Promise<void> {
  const src = PNG.sync.read(await readFile(pagePng));
  const strip = rotate90CCW(cropTop(src, TITLE_BAND));
  await writeFile(titlePng, PNG.sync.write(strip));
}

async function commandExists(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

async function pageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], {
    encoding: "utf8",
  });
  const m = stdout.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error(`pdfinfo: no page count for ${pdfPath}`);
  return Number(m[1]);
}

async function rasterizePage(
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

type OcrEngine = {
  recognize: (pngPath: string) => Promise<string>;
  close: () => Promise<void>;
};

async function openOcr(): Promise<OcrEngine> {
  if (await commandExists("tesseract")) {
    return {
      async recognize(pngPath) {
        const { stdout } = await execFileAsync(
          "tesseract",
          [pngPath, "stdout", "--psm", "6"],
          { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
        );
        return stdout;
      },
      async close() {},
    };
  }
  const worker: Worker = await createWorker("eng");
  return {
    async recognize(pngPath) {
      const { data } = await worker.recognize(pngPath);
      return data.text ?? "";
    },
    async close() {
      await worker.terminate();
    },
  };
}

async function loadOverrides(): Promise<FoiPageOverride[]> {
  try {
    const raw = await readFile(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as FoiPageOverride[];
    if (!Array.isArray(parsed)) {
      throw new Error(`${OVERRIDES_PATH} must be a JSON array`);
    }
    return parsed;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function indexFoiPages(): Promise<{
  pages: FoiPage[];
  unresolved: FoiPage[];
}> {
  const missing: string[] = [];
  for (const bin of ["pdfinfo", "pdftoppm"]) {
    if (!(await commandExists(bin))) missing.push(bin);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Install with: sudo apt install poppler-utils`,
    );
  }

  const network = JSON.parse(await readFile(NETWORK_PATH, "utf8")) as NetworkData;
  const stations: FoiStation[] = network.stations.map((s) => ({
    id: s.id,
    name: s.name,
    lineIds: s.lineIds,
  }));

  const pdfNames = (await readdir(PDF_DIR))
    .filter((n) => n.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (pdfNames.length === 0) {
    throw new Error(`No PDFs in ${PDF_DIR}`);
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(FOI_DIR, { recursive: true });

  const ocr = await openOcr();
  const pages: FoiPage[] = [];
  try {
    for (const file of pdfNames) {
      const pdfPath = path.join(PDF_DIR, file);
      const lineHint = lineIdFromFilename(file);
      const n = await pageCount(pdfPath);
      const stem = path.basename(file, ".pdf").replace(/\s+/g, "_");
      for (let page = 1; page <= n; page += 1) {
        const pngPath = path.join(CACHE_DIR, `${stem}-${page}.png`);
        try {
          await readFile(pngPath);
        } catch {
          process.stderr.write(`raster ${file} p${page}/${n}\n`);
          await rasterizePage(pdfPath, page, pngPath);
        }
        const titlePng = pngPath.replace(/\.png$/i, "-title.png");
        const titleTxt = pngPath.replace(/\.png$/i, "-title.txt");
        let titleText: string;
        try {
          titleText = await readFile(titleTxt, "utf8");
        } catch {
          process.stderr.write(`ocr-title ${file} p${page}/${n}\n`);
          await writeTitleStrip(pngPath, titlePng);
          titleText = await ocr.recognize(titlePng);
          await writeFile(titleTxt, titleText);
        }
        const ocrText = titleText;
        const hit = matchFoiPage(ocrText, stations, lineHint);
        pages.push({
          file,
          page,
          stationId: hit.stationId,
          stationName: hit.stationName,
          match: hit.match,
          ocrTitle: hit.ocrTitle,
          candidates: hit.candidates,
        });
      }
    }
  } finally {
    await ocr.close();
  }

  const overrides = await loadOverrides();
  const merged = applyFoiOverrides(pages, overrides, stations);
  return { pages: merged, unresolved: unresolvedFoiPages(merged) };
}

export async function main(): Promise<void> {
  const { pages, unresolved } = await indexFoiPages();
  const index: FoiPageIndex = {
    generatedAt: new Date().toISOString(),
    source: "tfl-foi-2015-axonometric",
    pages,
  };
  await mkdir(FOI_DIR, { recursive: true });
  await writeFile(PAGES_PATH, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${pages.length} pages to ${path.relative(ROOT, PAGES_PATH)}`);
  const byMatch = new Map<string, number>();
  for (const p of pages) {
    byMatch.set(p.match, (byMatch.get(p.match) ?? 0) + 1);
  }
  console.log(
    [...byMatch.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, n]) => `${k}: ${n}`)
      .join(", "),
  );
  if (unresolved.length === 0) return;
  console.error(`\n${unresolved.length} unresolved page(s):`);
  for (const p of unresolved) {
    const hint = p.candidates
      .slice(0, 3)
      .map((c) => `${c.id} (${c.score})`)
      .join(", ");
    console.error(
      `  ${p.file} p${p.page} [${p.match}] ${JSON.stringify(p.ocrTitle)}${hint ? ` → ${hint}` : ""}`,
    );
  }
  console.error(
    `\nAdd rows to ${path.relative(ROOT, OVERRIDES_PATH)} and re-run.`,
  );
  process.exitCode = 1;
}

const isCli = process.argv[1]?.includes("index-foi-pages");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
