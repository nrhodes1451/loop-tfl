/**
 * Match OCR titles from TfL FOI axonometric scans to network stations.
 * Isolated from routing — do not import plan/status/topology.
 */

export type FoiStation = {
  id: string;
  name: string;
  lineIds: string[];
};

export type FoiMatchKind =
  | "override"
  | "exact"
  | "fuzzy"
  | "ambiguous"
  | "unmatched";

export type FoiCandidate = {
  id: string;
  name: string;
  score: number;
};

export type FoiPageMatch = {
  stationId: string | null;
  stationName: string | null;
  match: FoiMatchKind;
  ocrTitle: string;
  candidates: FoiCandidate[];
};

export type FoiPage = {
  file: string;
  page: number;
  stationId: string | null;
  stationName: string | null;
  match: FoiMatchKind;
  ocrTitle: string;
  candidates: FoiCandidate[];
  note?: string;
};

export type FoiPageOverride = {
  file: string;
  page: number;
  stationId: string | null;
  note?: string;
};

export type FoiPageIndex = {
  generatedAt: string;
  source: "tfl-foi-2015-axonometric";
  pages: FoiPage[];
};

/** Normalised OCR title → station id. */
export const FOI_STATION_ALIASES: Record<string, string> = {
  "kings cross": "HUBKGX",
  "kings cross st pancras": "HUBKGX",
  "kings cross and st pancras": "HUBKGX",
  "st pancras": "HUBKGX",
  "st pancras kings cross": "HUBKGX",
  "elephant castle": "HUBEPH",
  "elephant and castle": "HUBEPH",
  "heathrow terminals 123": "HUBH13",
  "heathrow terminals 2 3": "HUBH13",
  "heathrow terminals 2 and 3": "HUBH13",
  "heathrow 1 2 3": "HUBH13",
  "heathrow terminals 1 2 3": "HUBH13",
  "high st kensington": "940GZZLUHSK",
  "high street kensington": "940GZZLUHSK",
};

const LINE_FROM_FILENAME: [RegExp, string][] = [
  [/hammersmith/, "hammersmith-city"],
  [/waterloo.?city/, "waterloo-city"],
  [/bakerloo/, "bakerloo"],
  [/central/, "central"],
  [/circle/, "circle"],
  [/district/, "district"],
  [/jubilee/, "jubilee"],
  [/metropolitan/, "metropolitan"],
  [/northern/, "northern"],
  [/piccadilly/, "piccadilly"],
  [/victoria/, "victoria"],
  [/elizabeth/, "elizabeth"],
];

const EXACT = 100;
const ALIAS = 98;
const PREFIX = 90;
const CONTAINS = 86;
const FUZZY_MIN = 72;
const LINE_BONUS = 8;
const HUB_BONUS = 3;
const AMBIGUOUS_GAP = 2;
const PREFIX_MIN = 8;

const BOILERPLATE =
  /plotted\s+by|produced\s+by|enquir(?:y|ies)|uncontrolled|uncontrol|london underground limited|tube lines limited|building control|m\s*stn\s*v?\s*8|not for cons|if any alterations|axonometric|location guide|sheets of the plan|station layout/i;

export function normalizeFoiName(raw: string): string {
  let s = raw.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/\bsaint\b/g, "st");
  s = s.replace(/['’`´]/g, "");
  s = s.replace(/\brd\b/g, "road");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\bthe\b/g, " ");
  s = s.replace(/\bstation\b/g, " ");
  return s.trim().replace(/\s+/g, " ");
}

export function lineIdFromFilename(filename: string): string | null {
  const base = filename.toLowerCase();
  for (const [re, id] of LINE_FROM_FILENAME) {
    if (re.test(base)) return id;
  }
  return null;
}

export function extractOcrTitle(ocrText: string): string {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-z]/i.test(l));
  if (lines.length === 0) return "";

  const scored = lines.map((line) => {
    const letters = (line.match(/[a-z]/gi) ?? []).length;
    const upper = (line.match(/[A-Z]/g) ?? []).length;
    const station = /\bstation\b/i.test(line) ? 40 : 0;
    const caps = letters > 0 ? (upper / letters) * 20 : 0;
    const length = Math.min(line.length, 48);
    const boiler =
      BOILERPLATE.test(line) || /^\W*station layout\W*$/i.test(line) ? -80 : 0;
    return { line, score: station + caps + length + boiler };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.line;
}

function ocrSnippets(ocrText: string): string[] {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[a-z]/i.test(l))
    .filter((l) => !BOILERPLATE.test(l) && !/^\W*station layout\W*$/i.test(l));
  const title = extractOcrTitle(ocrText);
  return title ? [title, ...lines] : lines;
}

function tokens(norm: string): string[] {
  return norm.split(" ").filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / new Set([...sa, ...sb]).size;
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function nameScore(titleNorm: string, stationNorm: string): number {
  if (!titleNorm || !stationNorm) return 0;
  if (titleNorm === stationNorm) return EXACT;
  if (containsPhrase(titleNorm, stationNorm) || containsPhrase(stationNorm, titleNorm)) {
    const shorter = Math.min(titleNorm.length, stationNorm.length);
    const longer = Math.max(titleNorm.length, stationNorm.length);
    return CONTAINS + Math.round((shorter / longer) * 10);
  }
  const [shorter, longer] =
    titleNorm.length <= stationNorm.length
      ? [titleNorm, stationNorm]
      : [stationNorm, titleNorm];
  if (shorter.length >= PREFIX_MIN && longer.startsWith(shorter)) {
    return PREFIX + Math.round((shorter.length / longer.length) * 8);
  }
  return Math.round(jaccard(tokens(titleNorm), tokens(stationNorm)) * 80);
}

export function matchFoiPage(
  ocrText: string,
  stations: readonly FoiStation[],
  lineHint: string | null,
): FoiPageMatch {
  const ocrTitle = extractOcrTitle(ocrText);
  const snippets = ocrSnippets(ocrText);

  const scored: FoiCandidate[] = stations.map((s) => {
    const stationNorm = normalizeFoiName(s.name);
    let score = 0;
    for (const snippet of snippets) {
      const norm = normalizeFoiName(snippet);
      score = Math.max(score, nameScore(norm, stationNorm));
      if (FOI_STATION_ALIASES[norm] === s.id) score = Math.max(score, ALIAS);
    }
    if (lineHint && s.lineIds.includes(lineHint)) score += LINE_BONUS;
    if (s.id.startsWith("HUB")) score += HUB_BONUS;
    return { id: s.id, name: s.name, score };
  });

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const best = scored[0];
  if (!best || best.score < FUZZY_MIN) {
    return {
      stationId: null,
      stationName: null,
      match: "unmatched",
      ocrTitle,
      candidates: scored.filter((c) => c.score > 0).slice(0, 5),
    };
  }

  const tied = scored.filter((c) => best.score - c.score <= AMBIGUOUS_GAP);
  if (tied.length > 1) {
    return {
      stationId: null,
      stationName: null,
      match: "ambiguous",
      ocrTitle,
      candidates: tied,
    };
  }

  const nameOnly = Math.max(
    ...snippets.map((snippet) =>
      nameScore(normalizeFoiName(snippet), normalizeFoiName(best.name)),
    ),
    0,
  );
  const exact =
    nameOnly === EXACT ||
    snippets.some(
      (snippet) => FOI_STATION_ALIASES[normalizeFoiName(snippet)] === best.id,
    );
  return {
    stationId: best.id,
    stationName: best.name,
    match: exact ? "exact" : "fuzzy",
    ocrTitle,
    candidates: [],
  };
}

export function applyFoiOverrides(
  pages: FoiPage[],
  overrides: readonly FoiPageOverride[],
  stations: readonly FoiStation[],
): FoiPage[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const key = (file: string, page: number) => `${file}\0${page}`;
  const map = new Map(
    overrides.map((o) => [key(o.file, o.page), o] as const),
  );
  return pages.map((page) => {
    const hit = map.get(key(page.file, page.page));
    if (!hit) return page;
    const station = hit.stationId ? byId.get(hit.stationId) : undefined;
    const next: FoiPage = {
      ...page,
      stationId: hit.stationId,
      stationName: station?.name ?? null,
      match: "override",
      candidates: [],
    };
    if (hit.note) next.note = hit.note;
    else delete next.note;
    return next;
  });
}

export function unresolvedFoiPages(pages: readonly FoiPage[]): FoiPage[] {
  return pages.filter(
    (p) => p.match === "unmatched" || p.match === "ambiguous",
  );
}
