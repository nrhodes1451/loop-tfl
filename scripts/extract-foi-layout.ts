/**
 * Extract platform depths (metres) and compass north from TfL FOI
 * axonometric rasters via the Anthropic Messages API.
 *
 * Usage: npm run extract-foi-layout
 * Requires: pdftoppm (poppler-utils), ANTHROPIC_API_KEY (unless every
 * page already has a cached *.layout.json). Re-runs after override
 * edits are free when the vision cache is warm.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import {
  FOI_EXTRACT_DISCLAIMER,
  applyExtractOverrides,
  mergeStationLayouts,
  parseVlmLayout,
  reviewExtract,
  type FoiExtractOverride,
  type FoiLayoutFile,
  type FoiPageExtract,
  type FoiPageExtractFile,
} from "../src/lib/schematic/foi-extract";
import type { FoiPageIndex } from "../src/lib/schematic/foi-match";

const execFileAsync = promisify(execFile);

const ROOT = process.cwd();
const PDF_DIR = path.join(ROOT, "data", "pdf");
const CACHE_DIR = path.join(PDF_DIR, ".pages");
const FOI_DIR = path.join(ROOT, "data", "foi");
const PAGES_PATH = path.join(FOI_DIR, "pages.json");
const EXTRACT_PATH = path.join(FOI_DIR, "extract.json");
const LAYOUT_PATH = path.join(FOI_DIR, "layout.json");
const OVERRIDES_PATH = path.join(FOI_DIR, "extract.overrides.json");
const DPI = 200;
const VLM_MAX_EDGE = 1536;
const MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CONCURRENCY = 3;

function loadDotEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    try {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    } catch {
      /* missing is fine */
    }
  }
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

async function rasterizeJpeg(
  pdfPath: string,
  page: number,
  jpegPath: string,
): Promise<void> {
  const prefix = jpegPath.replace(/\.jpe?g$/i, "");
  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-jpegopt",
    "quality=80",
    "-scale-to",
    String(VLM_MAX_EDGE),
    "-f",
    String(page),
    "-l",
    String(page),
    "-singlefile",
    pdfPath,
    prefix,
  ]);
}

function downscaleMaxEdge(src: PNG, maxEdge: number): PNG {
  const edge = Math.max(src.width, src.height);
  if (edge <= maxEdge) return src;
  const scale = maxEdge / edge;
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (src.width * sy + sx) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si]!;
      dst.data[di + 1] = src.data[si + 1]!;
      dst.data[di + 2] = src.data[si + 2]!;
      dst.data[di + 3] = src.data[si + 3]!;
    }
  }
  return dst;
}

type VlmImage = { data: string; mediaType: "image/jpeg" | "image/png" };

async function vlmImage(
  pdfPath: string,
  page: number,
  pngPath: string,
  jpegPath: string,
): Promise<VlmImage> {
  if (!(await fileExists(pngPath))) {
    process.stderr.write(`raster ${path.basename(pdfPath)} p${page}\n`);
    await rasterizePng(pdfPath, page, pngPath);
  }
  if (!(await fileExists(jpegPath))) {
    try {
      await rasterizeJpeg(pdfPath, page, jpegPath);
    } catch {
      const src = PNG.sync.read(await readFile(pngPath));
      const scaled = downscaleMaxEdge(src, VLM_MAX_EDGE);
      const fallback = jpegPath.replace(/\.jpe?g$/i, ".png");
      await writeFile(fallback, PNG.sync.write(scaled));
      return {
        data: (await readFile(fallback)).toString("base64"),
        mediaType: "image/png",
      };
    }
  }
  return {
    data: (await readFile(jpegPath)).toString("base64"),
    mediaType: "image/jpeg",
  };
}

function extractPrompt(stationName: string | null, stationId: string | null): string {
  const who = stationName
    ? `${stationName}${stationId ? ` (${stationId})` : ""}`
    : stationId ?? "unknown";
  return `You are reading a TfL FOI ~2015 axonometric station drawing (a scan).
Indexed station name (may be wrong): ${who}.

Find:
1. The small table labelled something like "approximate depth below street level" listing platform depths in metres.
2. The drawn compass rose (letter N / north arrow).

Return ONLY JSON matching this schema, no markdown:
{
  "northDeg": number | null,
  "depths": [{"label": string, "metres": number}],
  "confidence": "high" | "low",
  "raw": string
}

Rules:
- northDeg is clockwise degrees from UP on this image. 0 = north points to the top of the image, 90 = north points to the right, 180 = down, 270 = left. Page rotation is already applied. null if there is no readable compass.
- depths: one object per printed table row. label is the caption as printed (e.g. "Northern Line Platforms"). metres is the number only. Do not invent metres. If the table is absent, depths is [].
- Do not estimate depth from the drawing geometry.
- confidence is "low" if the table or rose is unreadable, cropped, or you are guessing.
- raw: one short sentence (missing table, rose unclear, etc.).`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function callAnthropic(
  image: VlmImage,
  prompt: string,
): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is unset. Copy .env.example to .env and add your key.",
    );
  }
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: image.data,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
    if (res.status === 429 || res.status === 529) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : delay);
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    const body = (await res.json()) as {
      error?: { message?: string };
      content?: { type: string; text?: string }[];
    };
    if (!res.ok) {
      throw new Error(
        `Anthropic ${res.status}: ${body.error?.message ?? res.statusText}`,
      );
    }
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic response had no text");
    return parseVlmLayout(text);
  }
  throw new Error("Anthropic rate-limited after retries");
}

async function loadOverrides(): Promise<FoiExtractOverride[]> {
  try {
    const raw = await readFile(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as FoiExtractOverride[];
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

async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, () => worker()),
  );
  return out;
}

export async function extractFoiLayout(opts: {
  force?: boolean;
}): Promise<{
  pages: FoiPageExtract[];
  review: ReturnType<typeof reviewExtract>;
}> {
  loadDotEnv();
  if (!(await commandExists("pdftoppm"))) {
    throw new Error("Missing pdftoppm. Install with: sudo apt install poppler-utils");
  }
  const index = JSON.parse(await readFile(PAGES_PATH, "utf8")) as FoiPageIndex;
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(FOI_DIR, { recursive: true });

  const force = opts.force === true;
  const pages = await mapPool(index.pages, CONCURRENCY, async (entry, i) => {
    const stem = path.basename(entry.file, ".pdf").replace(/\s+/g, "_");
    const pngPath = path.join(CACHE_DIR, `${stem}-${entry.page}.png`);
    const jpegPath = path.join(CACHE_DIR, `${stem}-${entry.page}-vlm.jpg`);
    const cachePath = path.join(CACHE_DIR, `${stem}-${entry.page}.layout.json`);
    const pdfPath = path.join(PDF_DIR, entry.file);

    let cached: unknown | undefined;
    if (!force && (await fileExists(cachePath))) {
      cached = JSON.parse(await readFile(cachePath, "utf8"));
    } else {
      process.stderr.write(
        `vlm ${entry.file} p${entry.page} (${i + 1}/${index.pages.length})\n`,
      );
      const image = await vlmImage(pdfPath, entry.page, pngPath, jpegPath);
      cached = await callAnthropic(
        image,
        extractPrompt(entry.stationName, entry.stationId),
      );
      await writeFile(cachePath, `${JSON.stringify(cached, null, 2)}\n`);
    }

    const parsed = parseVlmLayout(cached);
    const row: FoiPageExtract = {
      file: entry.file,
      page: entry.page,
      stationId: entry.stationId,
      northDeg: parsed.northDeg,
      depths: parsed.depths,
      confidence: parsed.confidence,
      raw: parsed.raw,
    };
    return row;
  });

  const overrides = await loadOverrides();
  const merged = applyExtractOverrides(pages, overrides);
  const { stations, northConflicts } = mergeStationLayouts(merged);
  const generatedAt = new Date().toISOString();
  const extractFile: FoiPageExtractFile = {
    generatedAt,
    source: "tfl-foi-2015-axonometric",
    disclaimer: FOI_EXTRACT_DISCLAIMER,
    pages: merged,
  };
  const layoutFile: FoiLayoutFile = {
    generatedAt,
    source: "tfl-foi-2015-axonometric",
    disclaimer: FOI_EXTRACT_DISCLAIMER,
    stations,
  };
  await writeFile(EXTRACT_PATH, `${JSON.stringify(extractFile, null, 2)}\n`);
  await writeFile(LAYOUT_PATH, `${JSON.stringify(layoutFile, null, 2)}\n`);
  return { pages: merged, review: reviewExtract(merged, northConflicts) };
}

export async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const { pages, review } = await extractFoiLayout({ force });
  console.log(
    `Wrote ${pages.length} pages to ${path.relative(ROOT, EXTRACT_PATH)}`,
  );
  console.log(`Wrote stations to ${path.relative(ROOT, LAYOUT_PATH)}`);
  if (review.length === 0) return;
  console.error(`\n${review.length} page(s) need review:`);
  for (const r of review) {
    console.error(
      `  ${r.file} p${r.page} ${r.stationId ?? "?"} [${r.reasons.join(", ")}]`,
    );
  }
  console.error(
    `\nAdd rows to ${path.relative(ROOT, OVERRIDES_PATH)} and re-run.`,
  );
  process.exitCode = 1;
}

const isCli = process.argv[1]?.includes("extract-foi-layout");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
