/**
 * Merge the FOI sheet observations in data/foi/observations/ into
 * data/foi/extract.json and data/foi/layout.json.
 *
 * Usage: npm run foi:build
 *        npm run foi:build -- --todo   (list sheets still needing a read)
 * Offline and deterministic: every value here comes from a committed
 * observation file or from data/foi/extract.overrides.json.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FOI_EXTRACT_DISCLAIMER,
  applyExtractOverrides,
  foiSheetStem,
  mergeStationLayouts,
  parseObservedLayout,
  parseObservedPlacement,
  reviewExtract,
  type FoiExtractOverride,
  type FoiLayoutFile,
  type FoiPageExtract,
  type FoiPageExtractFile,
  type FoiPlacementIssue,
} from "../src/lib/schematic/foi-extract";
import type { FoiPageIndex } from "../src/lib/schematic/foi-match";

const ROOT = process.cwd();
const FOI_DIR = path.join(ROOT, "data", "foi");
const OBSERVATIONS_DIR = path.join(FOI_DIR, "observations");
const PAGES_PATH = path.join(FOI_DIR, "pages.json");
const EXTRACT_PATH = path.join(FOI_DIR, "extract.json");
const LAYOUT_PATH = path.join(FOI_DIR, "layout.json");
const OVERRIDES_PATH = path.join(FOI_DIR, "extract.overrides.json");

export function observationPath(file: string, page: number): string {
  return path.join(OBSERVATIONS_DIR, `${foiSheetStem(file, page)}.json`);
}

type Observation = {
  body: Record<string, unknown>;
  /** No observation file on disk yet. */
  missing: boolean;
  /** File exists but the platform pass has not been recorded. */
  needsPlacement: boolean;
};

async function loadObservation(
  file: string,
  page: number,
): Promise<Observation> {
  const obsPath = observationPath(file, page);
  let text: string;
  try {
    text = await readFile(obsPath, "utf8");
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return { body: {}, missing: true, needsPlacement: true };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${path.relative(ROOT, obsPath)} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${path.relative(ROOT, obsPath)} must be a JSON object, got ${
        Array.isArray(parsed) ? "an array" : typeof parsed
      }`,
    );
  }
  const body = parsed as Record<string, unknown>;
  return {
    body,
    missing: false,
    needsPlacement: !Array.isArray(body.platforms),
  };
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

export type FoiTodoEntry = {
  file: string;
  page: number;
  stationId: string | null;
  reason: "no-observation" | "no-placement";
};

export async function foiTodo(): Promise<{
  entries: FoiTodoEntry[];
  total: number;
}> {
  const index = JSON.parse(await readFile(PAGES_PATH, "utf8")) as FoiPageIndex;
  const entries: FoiTodoEntry[] = [];
  for (const entry of index.pages) {
    const obs = await loadObservation(entry.file, entry.page);
    if (obs.missing) {
      entries.push({
        file: entry.file,
        page: entry.page,
        stationId: entry.stationId,
        reason: "no-observation",
      });
    } else if (obs.needsPlacement) {
      entries.push({
        file: entry.file,
        page: entry.page,
        stationId: entry.stationId,
        reason: "no-placement",
      });
    }
  }
  return { entries, total: index.pages.length };
}

export async function buildFoiLayout(): Promise<{
  pages: FoiPageExtract[];
  review: ReturnType<typeof reviewExtract>;
  missing: number;
}> {
  const index = JSON.parse(await readFile(PAGES_PATH, "utf8")) as FoiPageIndex;

  const pages: FoiPageExtract[] = [];
  const readIssues: FoiPlacementIssue[] = [];
  for (const entry of index.pages) {
    const obs = await loadObservation(entry.file, entry.page);
    if (obs.missing) {
      readIssues.push({
        file: entry.file,
        page: entry.page,
        stationId: entry.stationId,
        reason: "no-observation",
      });
    }
    const parsed = parseObservedLayout(obs.body);
    const placed = parseObservedPlacement(obs.body);
    const row: FoiPageExtract = {
      file: entry.file,
      page: entry.page,
      stationId: entry.stationId,
      northDeg: parsed.northDeg,
      depths: parsed.depths,
      platforms: placed.platforms,
      confidence: parsed.confidence,
      raw: parsed.raw,
    };
    if (placed.reference) row.reference = placed.reference;
    pages.push(row);
  }

  const overrides = await loadOverrides();
  const merged = applyExtractOverrides(pages, overrides);
  const { stations, northConflicts, placementIssues } =
    mergeStationLayouts(merged);
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
  return {
    pages: merged,
    review: reviewExtract(merged, northConflicts, [
      ...placementIssues,
      ...readIssues,
    ]),
    missing: readIssues.length,
  };
}

export async function main(): Promise<void> {
  if (process.argv.includes("--todo")) {
    const { entries, total } = await foiTodo();
    if (entries.length === 0) {
      console.log(`All ${total} sheet(s) have depths and placement recorded.`);
      return;
    }
    console.log(`${entries.length} of ${total} sheet(s) still need a read:`);
    for (const e of entries) {
      console.log(`  ${e.file} p${e.page} ${e.stationId ?? "?"} [${e.reason}]`);
    }
    console.log(
      `\nRead each sheet from data/pdf/.pages and write ${path.relative(
        ROOT,
        OBSERVATIONS_DIR,
      )}/<sheet>.json`,
    );
    return;
  }

  const { pages, review, missing } = await buildFoiLayout();
  console.log(
    `Wrote ${pages.length} pages to ${path.relative(ROOT, EXTRACT_PATH)}`,
  );
  console.log(`Wrote stations to ${path.relative(ROOT, LAYOUT_PATH)}`);
  if (missing > 0) {
    console.error(
      `\n${missing} sheet(s) have no observation file. Run with --todo for the list.`,
    );
  }
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

const isCli = process.argv[1]?.includes("build-foi-layout");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
