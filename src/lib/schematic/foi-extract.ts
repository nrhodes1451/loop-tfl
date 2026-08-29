/**
 * FOI axonometric layout extract: platform depths (metres), compass,
 * and plan placement. Isolated from routing — do not import plan/status/topology.
 * Metres and offsets are approximate (~2015 FOI), never used for access decisions.
 */

import {
  PLACEMENT_DISAGREE_M,
  PLACEMENT_RESIDUAL_LIMIT,
  fitSheetBasis,
  imageToPlan,
  markCentre,
  undirectedBearingDeg,
} from "./foi-project";
import { normalizeSchematicLineId } from "./levels";

export type FoiConfidence = "high" | "low";

export type FoiDepth = {
  label: string;
  metres: number;
  lineId: string | null;
};

export type FoiPlatformEnd = "north" | "south" | "east" | "west";

export type FoiPlatformMark = {
  caption: string;
  lineId: string | null;
  platformNumbers: number[];
  end: FoiPlatformEnd | null;
  bearingDeg: number | null;
  /** Normalised page coords, origin top-left. */
  a: [number, number];
  b: [number, number];
  grid: string | null;
  confidence: FoiConfidence;
};

export type FoiPageReference = {
  label: string;
  at: [number, number];
};

export type FoiPageExtract = {
  file: string;
  page: number;
  stationId: string | null;
  northDeg: number | null;
  depths: FoiDepth[];
  platforms: FoiPlatformMark[];
  reference?: FoiPageReference;
  confidence: FoiConfidence;
  raw: string;
  note?: string;
  reviewed?: boolean;
};

export type FoiExtractOverride = {
  file: string;
  page: number;
  northDeg?: number | null;
  depths?: FoiDepth[];
  platforms?: FoiPlatformMark[];
  reference?: FoiPageReference | null;
  confidence?: FoiConfidence;
  raw?: string;
  note?: string;
  reviewed?: boolean;
};

export type FoiPageExtractFile = {
  generatedAt: string;
  source: "tfl-foi-2015-axonometric";
  disclaimer: string;
  pages: FoiPageExtract[];
};

export type FoiStationPlatform = {
  lineId: string;
  platformNumbers: number[];
  eastM: number;
  northM: number;
  bearingDeg: number;
  confidence: FoiConfidence;
  caption: string;
  end: FoiPlatformEnd | null;
  a: [number, number];
  b: [number, number];
  grid: string | null;
  residual: number;
  /** Metres below street when a depth-table row uniquely matches this mark. */
  depthM?: number;
  flags?: string[];
  sources: { file: string; page: number }[];
};

/** Every observation mark for a station, including those not used for x/y. */
export type FoiStationMark = {
  file: string;
  page: number;
  caption: string;
  lineId: string | null;
  platformNumbers: number[];
  end: FoiPlatformEnd | null;
  bearingDeg: number | null;
  a: [number, number];
  b: [number, number];
  grid: string | null;
  confidence: FoiConfidence;
  eastM: number | null;
  northM: number | null;
  residual: number | null;
  /** True when this mark is the one baked into `platforms` / node x/y. */
  placed: boolean;
};

export type FoiStationLayout = {
  stationId: string;
  northDeg: number | null;
  depths: FoiDepth[];
  platforms: FoiStationPlatform[];
  marks: FoiStationMark[];
  sources: { file: string; page: number }[];
};

export type FoiLayoutFile = {
  generatedAt: string;
  source: "tfl-foi-2015-axonometric";
  disclaimer: string;
  stations: FoiStationLayout[];
};

export type FoiExtractReview = {
  file: string;
  page: number;
  stationId: string | null;
  reasons: string[];
};

export const FOI_EXTRACT_DISCLAIMER =
  "Approximate platform depths, drawing north, and plan offsets reconstructed from TfL FOI ~2015 axonometrics. Not survey, not for routing or access decisions.";

export const NORTH_AGREE_DEG = 20;
export const SLOPE_MATCH_DEG = 2;
export const PARALLEL_DIR_DEG = 10;
export const BEARING_CONFLICT_DEG = 10;
export const GEOGRAPHY_GAP_LIMIT = 40;

/** 0 = include `low`; 1 = `high` only. Debug default is 0 so every mark reaches the app. */
export const PLACEMENT_MIN_CONFIDENCE = 0;

export function foiConfidenceRank(c: FoiConfidence): number {
  return c === "high" ? 1 : 0;
}

/**
 * Stem shared by one sheet's raster and its observation file, e.g.
 * "3d bakerloo stations Redacted.pdf" p10 → "3d_bakerloo_stations_Redacted-10".
 */
export function foiSheetStem(file: string, page: number): string {
  const base = file.replace(/\.pdf$/i, "").replace(/\s+/g, "_");
  return `${base}-${page}`;
}

const LINE_CAPTIONS: [RegExp, string][] = [
  [/hammersmith(?:\s*(?:and|&|\/)\s*city)?|\bh\s*&\s*c\b/i, "hammersmith-city"],
  [/waterloo(?:\s*(?:and|&|\/)\s*city)?/i, "waterloo-city"],
  [/elizabeth/i, "elizabeth-line"],
  [/overground/i, "london-overground"],
  [/bakerloo/i, "bakerloo"],
  [/central/i, "central"],
  [/circle/i, "circle"],
  [/district/i, "district"],
  [/metropolitan|\bmet\b/i, "metropolitan"],
  [/jubilee/i, "jubilee"],
  [/northern/i, "northern"],
  [/piccadilly/i, "piccadilly"],
  [/victoria/i, "victoria"],
  [/\bdlr\b|docklands/i, "dlr"],
  [/\btram/i, "tram"],
  [/\bell\b|east london/i, "london-overground"],
];

/** Printed depth-table caption → schematic line id, or null if unknown. */
export function lineIdFromCaption(label: string): string | null {
  const ids = lineIdsFromCaption(label);
  return ids.length === 1 ? ids[0]! : null;
}

export function lineIdsFromCaption(label: string): string[] {
  const found: string[] = [];
  for (const [re, id] of LINE_CAPTIONS) {
    if (re.test(label) && !found.includes(id)) found.push(normalizeSchematicLineId(id));
  }
  return found;
}

export function depthsFromCaption(label: string, metres: number): FoiDepth[] {
  const ids = lineIdsFromCaption(label);
  if (ids.length === 0) return [{ label, metres, lineId: null }];
  return ids.map((lineId) => ({ label, metres, lineId }));
}

export function attachLineIds(depths: readonly FoiDepth[]): FoiDepth[] {
  return depths.flatMap((d) => {
    if (d.lineId) {
      return [{ ...d, lineId: normalizeSchematicLineId(d.lineId) }];
    }
    return depthsFromCaption(d.label, d.metres);
  });
}

export function attachPlatformLineIds(
  marks: readonly FoiPlatformMark[],
): FoiPlatformMark[] {
  return marks.map((m) => {
    if (m.lineId) {
      return { ...m, lineId: normalizeSchematicLineId(m.lineId) };
    }
    const ids = lineIdsFromCaption(m.caption);
    return { ...m, lineId: ids.length === 1 ? ids[0]! : null };
  });
}

const PAGE_KEY = (file: string, page: number) => `${file}\0${page}`;

export function applyExtractOverrides(
  pages: FoiPageExtract[],
  overrides: readonly FoiExtractOverride[],
): FoiPageExtract[] {
  const map = new Map(overrides.map((o) => [PAGE_KEY(o.file, o.page), o] as const));
  return pages.map((page) => {
    const hit = map.get(PAGE_KEY(page.file, page.page));
    if (!hit) return page;
    const next: FoiPageExtract = {
      ...page,
      northDeg: hit.northDeg !== undefined ? hit.northDeg : page.northDeg,
      depths: hit.depths !== undefined ? attachLineIds(hit.depths) : page.depths,
      platforms:
        hit.platforms !== undefined
          ? attachPlatformLineIds(hit.platforms)
          : page.platforms,
      confidence: hit.confidence ?? page.confidence,
      raw: hit.raw ?? page.raw,
    };
    if (hit.reference !== undefined) {
      if (hit.reference) next.reference = hit.reference;
      else delete next.reference;
    } else if (page.reference) {
      next.reference = page.reference;
    }
    if (hit.note) next.note = hit.note;
    else if (page.note) next.note = page.note;
    if (hit.reviewed) next.reviewed = true;
    return next;
  });
}

function unwrapDeg(deg: number, ref: number): number {
  let d = deg;
  while (d - ref > 180) d -= 360;
  while (d - ref < -180) d += 360;
  return d;
}

function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Mean north if all high-confidence values agree within NORTH_AGREE_DEG; else null. */
export function mergeNorthDeg(pages: readonly FoiPageExtract[]): number | null {
  const vals = pages
    .filter((p) => p.confidence === "high" && p.northDeg != null)
    .map((p) => wrapDeg(p.northDeg!));
  if (vals.length === 0) {
    const any = pages.map((p) => p.northDeg).filter((n): n is number => n != null);
    if (any.length === 1) return wrapDeg(any[0]!);
    return null;
  }
  const ref = vals[0]!;
  const unwrapped = vals.map((v) => unwrapDeg(v, ref));
  const min = Math.min(...unwrapped);
  const max = Math.max(...unwrapped);
  if (max - min > NORTH_AGREE_DEG) return null;
  const mean = unwrapped.reduce((a, b) => a + b, 0) / unwrapped.length;
  return wrapDeg(mean);
}

function depthKey(d: FoiDepth): string {
  const label = d.label.trim().toLowerCase();
  const metres = String(d.metres);
  return d.lineId ? `id:${d.lineId}:${label}:${metres}` : `label:${label}:${metres}`;
}

const DEPTH_TOKENS = [
  "city",
  "charing",
  "northbound",
  "southbound",
  "eastbound",
  "westbound",
] as const;

function normalizeDepthText(s: string): string {
  return s
    .toLowerCase()
    .replace(/north\s+bound/g, "northbound")
    .replace(/south\s+bound/g, "southbound")
    .replace(/east\s+bound/g, "eastbound")
    .replace(/west\s+bound/g, "westbound");
}

function depthTokens(s: string): Set<string> {
  const n = normalizeDepthText(s);
  return new Set(DEPTH_TOKENS.filter((t) => n.includes(t)));
}

function platformNumbersInLabel(label: string): number[] {
  const out: number[] = [];
  const re = /platform(?:s)?\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label))) {
    out.push(Number(m[1]));
  }
  return out;
}

export type PlatformDepthMatch = {
  metres?: number;
  ambiguous: boolean;
};

/**
 * Pick a depth-table row for a placed platform. One row for the line always
 * wins. Several rows need a unique number or token hit (city / charing /
 * northbound / …). Unmatched marks keep `depthM` unset so `foiDepthM`
 * first-wins remains the fallback.
 */
export function matchPlatformDepth(
  mark: {
    lineId: string | null;
    caption: string;
    platformNumbers: number[];
  },
  depths: readonly FoiDepth[],
): PlatformDepthMatch {
  if (!mark.lineId) return { ambiguous: false };
  const id = normalizeSchematicLineId(mark.lineId);
  const rows = depths.filter(
    (d) => d.lineId != null && normalizeSchematicLineId(d.lineId) === id,
  );
  if (rows.length === 0) return { ambiguous: false };
  const distinctM = new Set(rows.map((r) => r.metres));
  if (distinctM.size === 1) return { metres: rows[0]!.metres, ambiguous: false };

  const numberHits = rows.filter((d) => {
    const nums = platformNumbersInLabel(d.label);
    return mark.platformNumbers.some((n) => nums.includes(n));
  });
  if (numberHits.length === 1) {
    return { metres: numberHits[0]!.metres, ambiguous: false };
  }
  if (numberHits.length > 1) {
    const metres = new Set(numberHits.map((r) => r.metres));
    if (metres.size === 1) return { metres: numberHits[0]!.metres, ambiguous: false };
    return { ambiguous: true };
  }

  const markTok = depthTokens(mark.caption);
  if (markTok.size > 0) {
    const scored = rows
      .map((d) => {
        const dt = depthTokens(d.label);
        let n = 0;
        for (const t of markTok) if (dt.has(t)) n += 1;
        return { d, n };
      })
      .filter((x) => x.n > 0);
    if (scored.length > 0) {
      const best = Math.max(...scored.map((s) => s.n));
      const winners = scored.filter((s) => s.n === best);
      const metres = new Set(winners.map((w) => w.d.metres));
      if (metres.size === 1) return { metres: winners[0]!.d.metres, ambiguous: false };
      return { ambiguous: true };
    }
  }

  const labels = new Set(rows.map((r) => r.label.trim().toLowerCase()));
  return { ambiguous: labels.size === 1 };
}

function attachPlatformDepths(
  platforms: readonly FoiStationPlatform[],
  depths: readonly FoiDepth[],
  stationId: string,
): { platforms: FoiStationPlatform[]; issues: FoiPlacementIssue[] } {
  const issues: FoiPlacementIssue[] = [];
  const next = platforms.map((p) => {
    const hit = matchPlatformDepth(p, depths);
    const plat =
      hit.metres != null ? { ...p, depthM: hit.metres } : p;
    if (hit.ambiguous) {
      const src = p.sources[0];
      if (
        src &&
        !issues.some(
          (i) =>
            i.file === src.file &&
            i.page === src.page &&
            i.reason === "depth-ambiguous",
        )
      ) {
        issues.push({
          file: src.file,
          page: src.page,
          stationId,
          reason: "depth-ambiguous",
        });
      }
    }
    return plat;
  });
  return { platforms: next, issues };
}

export type FoiPlacementIssue = {
  file: string;
  page: number;
  stationId: string | null;
  reason: string;
};

export function mergeStationLayouts(
  pages: readonly FoiPageExtract[],
): {
  stations: FoiStationLayout[];
  northConflicts: string[];
  placementIssues: FoiPlacementIssue[];
} {
  const byStation = new Map<string, FoiPageExtract[]>();
  for (const p of pages) {
    if (!p.stationId) continue;
    const list = byStation.get(p.stationId) ?? [];
    list.push(p);
    byStation.set(p.stationId, list);
  }

  const stations: FoiStationLayout[] = [];
  const northConflicts: string[] = [];
  const placementIssues: FoiPlacementIssue[] = [];
  for (const [stationId, group] of [...byStation.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const highNorth = group.filter(
      (p) => p.confidence === "high" && p.northDeg != null,
    );
    const northDeg = mergeNorthDeg(group);
    if (highNorth.length >= 2 && northDeg == null) northConflicts.push(stationId);

    const byKey = new Map<string, FoiDepth>();
    const ordered = [...group].sort(
      (a, b) => Number(b.confidence === "high") - Number(a.confidence === "high"),
    );
    for (const p of ordered) {
      for (const d of attachLineIds(p.depths)) {
        const k = depthKey(d);
        if (!byKey.has(k)) byKey.set(k, d);
      }
    }

    const depths = [...byKey.values()];
    const { platforms, issues, marks } = mergeStationPlatforms(group);
    const attached = attachPlatformDepths(platforms, depths, stationId);
    placementIssues.push(...issues, ...attached.issues);

    stations.push({
      stationId,
      northDeg,
      depths,
      platforms: attached.platforms,
      marks,
      sources: group.map((p) => ({ file: p.file, page: p.page })),
    });
  }
  return { stations, northConflicts, placementIssues };
}

function platformKey(lineId: string, numbers: number[]): string {
  const nums = [...numbers].sort((a, b) => a - b).join(",");
  return nums ? `${lineId}:${nums}` : `${lineId}:*`;
}

function usableMarks(page: FoiPageExtract): FoiPlatformMark[] {
  return (page.platforms ?? []).filter((m) => {
    if (foiConfidenceRank(m.confidence) < PLACEMENT_MIN_CONFIDENCE) return false;
    if (m.bearingDeg == null || m.lineId == null) return false;
    const du = m.b[0] - m.a[0];
    const dv = m.b[1] - m.a[1];
    return Math.hypot(du, dv) > 1e-6;
  });
}

type ProjectedMark = {
  mark: FoiPlatformMark;
  eastM: number;
  northM: number;
  bearingDeg: number;
  file: string;
  page: number;
  residual: number;
};

type PageProj = {
  file: string;
  page: number;
  stationId: string | null;
  residual: number;
  items: ProjectedMark[];
};

function mergeStationPlatforms(group: readonly FoiPageExtract[]): {
  platforms: FoiStationPlatform[];
  issues: FoiPlacementIssue[];
  marks: FoiStationMark[];
} {
  const issues: FoiPlacementIssue[] = [];
  const projected: PageProj[] = [];
  for (const page of group) {
    const marks = usableMarks(page);
    if (marks.length === 0) continue;
    const origin = page.reference?.at;
    const basis = fitSheetBasis(
      marks.map((m) => ({
        a: m.a,
        b: m.b,
        bearingDeg: m.bearingDeg!,
      })),
      page.northDeg,
      origin,
    );
    if (basis.residual > PLACEMENT_RESIDUAL_LIMIT) {
      issues.push({
        file: page.file,
        page: page.page,
        stationId: page.stationId,
        reason: "placement-residual",
      });
    }
    const items: ProjectedMark[] = marks.map((m) => {
      const [u, v] = markCentre(m);
      const p = imageToPlan(u, v, basis);
      return {
        mark: m,
        eastM: p.eastM,
        northM: p.northM,
        bearingDeg: undirectedBearingDeg(m.bearingDeg!),
        file: page.file,
        page: page.page,
        residual: basis.residual,
      };
    });
    projected.push({
      file: page.file,
      page: page.page,
      stationId: page.stationId,
      residual: basis.residual,
      items,
    });
  }

  const trusted = projected
    .filter((p) => p.items.length > 0)
    .sort((a, b) => {
      const aOk = a.residual <= PLACEMENT_RESIDUAL_LIMIT ? 0 : 1;
      const bOk = b.residual <= PLACEMENT_RESIDUAL_LIMIT ? 0 : 1;
      if (aOk !== bOk) return aOk - bOk;
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      if (a.residual !== b.residual) return a.residual - b.residual;
      return `${a.file}\0${a.page}`.localeCompare(`${b.file}\0${b.page}`);
    });

  const placed = new Map<string, FoiStationPlatform>();
  const anchor = trusted[0];
  if (!anchor) {
    return { platforms: [], issues, marks: collectStationMarks(group, [], placed) };
  }

  const toStation = (
    item: ProjectedMark,
    dx = 0,
    dy = 0,
  ): FoiStationPlatform => ({
    lineId: item.mark.lineId!,
    platformNumbers: [...item.mark.platformNumbers],
    eastM: item.eastM + dx,
    northM: item.northM + dy,
    bearingDeg: item.bearingDeg,
    confidence: item.mark.confidence,
    caption: item.mark.caption,
    end: item.mark.end,
    a: item.mark.a,
    b: item.mark.b,
    grid: item.mark.grid,
    residual: item.residual,
    sources: [{ file: item.file, page: item.page }],
  });

  for (const item of anchor.items) {
    placed.set(
      platformKey(item.mark.lineId!, item.mark.platformNumbers),
      toStation(item),
    );
  }

  for (const other of trusted.slice(1)) {
    const shared = other.items.filter((i) =>
      placed.has(platformKey(i.mark.lineId!, i.mark.platformNumbers)),
    );
    if (shared.length === 0) continue;
    let dx = 0;
    let dy = 0;
    for (const s of shared) {
      const hit = placed.get(platformKey(s.mark.lineId!, s.mark.platformNumbers))!;
      dx += hit.eastM - s.eastM;
      dy += hit.northM - s.northM;
    }
    dx /= shared.length;
    dy /= shared.length;
    let disagree = false;
    for (const s of shared) {
      const hit = placed.get(platformKey(s.mark.lineId!, s.mark.platformNumbers))!;
      const err = Math.hypot(s.eastM + dx - hit.eastM, s.northM + dy - hit.northM);
      if (err > PLACEMENT_DISAGREE_M) disagree = true;
    }
    if (disagree) {
      issues.push({
        file: other.file,
        page: other.page,
        stationId: other.stationId,
        reason: "placement-disagreement",
      });
      continue;
    }
    for (const item of other.items) {
      const k = platformKey(item.mark.lineId!, item.mark.platformNumbers);
      if (placed.has(k)) continue;
      placed.set(k, toStation(item, dx, dy));
    }
  }

  const platforms = [...placed.values()].sort((a, b) => {
    const c = a.lineId.localeCompare(b.lineId);
    if (c !== 0) return c;
    return a.platformNumbers.join(",").localeCompare(b.platformNumbers.join(","));
  });
  return {
    platforms,
    issues,
    marks: collectStationMarks(group, projected, placed),
  };
}

function collectStationMarks(
  group: readonly FoiPageExtract[],
  projected: readonly PageProj[],
  placed: Map<string, FoiStationPlatform>,
): FoiStationMark[] {
  const itemsByPage = new Map<string, ProjectedMark[]>();
  for (const page of projected) {
    itemsByPage.set(`${page.file}\0${page.page}`, page.items);
  }
  const marks: FoiStationMark[] = [];
  for (const page of group) {
    const items = itemsByPage.get(`${page.file}\0${page.page}`) ?? [];
    for (const m of page.platforms ?? []) {
      const item = items.find((i) => i.mark === m);
      const k =
        m.lineId != null ? platformKey(m.lineId, m.platformNumbers) : null;
      const winner = k ? placed.get(k) : undefined;
      const placedHere =
        item != null &&
        winner != null &&
        winner.sources.some((s) => s.file === item.file && s.page === item.page);
      marks.push({
        file: page.file,
        page: page.page,
        caption: m.caption,
        lineId: m.lineId,
        platformNumbers: [...m.platformNumbers],
        end: m.end,
        bearingDeg: m.bearingDeg,
        a: m.a,
        b: m.b,
        grid: m.grid,
        confidence: m.confidence,
        eastM: item?.eastM ?? null,
        northM: item?.northM ?? null,
        residual: item?.residual ?? null,
        placed: placedHere,
      });
    }
  }
  return marks;
}

export function undirectedAngleGap(a: number, b: number): number {
  const d = Math.abs(undirectedBearingDeg(a) - undirectedBearingDeg(b));
  return Math.min(d, 180 - d);
}

function markSlopeDeg(a: [number, number], b: [number, number]): number | null {
  const du = b[0] - a[0];
  const dv = b[1] - a[1];
  if (Math.hypot(du, dv) <= 1e-6) return null;
  return undirectedBearingDeg((Math.atan2(dv, du) * 180) / Math.PI);
}

/** Per-page reasons: bearing copied from a→b, or parallel boxes with disagreeing bearings. */
export function pageBearingIssues(page: FoiPageExtract): FoiPlacementIssue[] {
  const marks = (page.platforms ?? []).filter(
    (m) => m.bearingDeg != null && markSlopeDeg(m.a, m.b) != null,
  );
  if (marks.length === 0) return [];
  const out: FoiPlacementIssue[] = [];
  const slopeHits = marks.filter((m) => {
    const slope = markSlopeDeg(m.a, m.b);
    return slope != null && undirectedAngleGap(m.bearingDeg!, slope) <= SLOPE_MATCH_DEG;
  });
  if (slopeHits.length * 2 >= marks.length) {
    out.push({
      file: page.file,
      page: page.page,
      stationId: page.stationId,
      reason: "bearing-from-slope",
    });
  }
  let conflict = false;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const sa = markSlopeDeg(marks[i]!.a, marks[i]!.b);
      const sb = markSlopeDeg(marks[j]!.a, marks[j]!.b);
      if (sa == null || sb == null) continue;
      if (undirectedAngleGap(sa, sb) > PARALLEL_DIR_DEG) continue;
      if (
        undirectedAngleGap(marks[i]!.bearingDeg!, marks[j]!.bearingDeg!) >
        BEARING_CONFLICT_DEG
      ) {
        conflict = true;
      }
    }
  }
  if (conflict) {
    out.push({
      file: page.file,
      page: page.page,
      stationId: page.stationId,
      reason: "bearing-conflict",
    });
  }
  return out;
}

export function chordKey(stationId: string, lineId: string): string {
  return `${stationId}\0${normalizeSchematicLineId(lineId)}`;
}

/** Neighbour-station chords keyed by stationId + lineId. */
export type ChordIndex = Record<string, number[]>;

export function geographyIssues(
  stations: readonly FoiStationLayout[],
  chords: ChordIndex,
): FoiPlacementIssue[] {
  const out: FoiPlacementIssue[] = [];
  for (const st of stations) {
    for (const p of st.platforms) {
      const list = chords[chordKey(st.stationId, p.lineId)] ?? [];
      if (list.length === 0) continue;
      const gap = Math.min(
        ...list.map((c) => undirectedAngleGap(p.bearingDeg, c)),
      );
      if (gap <= GEOGRAPHY_GAP_LIMIT) continue;
      const src = p.sources[0];
      if (!src) continue;
      const already = out.some(
        (i) =>
          i.file === src.file &&
          i.page === src.page &&
          i.reason === "bearing-vs-geography",
      );
      if (already) continue;
      out.push({
        file: src.file,
        page: src.page,
        stationId: st.stationId,
        reason: "bearing-vs-geography",
      });
    }
  }
  return out;
}

export function annotatePlatformFlags(
  stations: readonly FoiStationLayout[],
  issues: readonly FoiPlacementIssue[],
  chords: ChordIndex = {},
): FoiStationLayout[] {
  const byPage = new Map<string, string[]>();
  for (const issue of issues) {
    const k = `${issue.file}\0${issue.page}`;
    const list = byPage.get(k) ?? [];
    if (!list.includes(issue.reason)) list.push(issue.reason);
    byPage.set(k, list);
  }
  return stations.map((st) => ({
    ...st,
    platforms: st.platforms.map((p) => {
      const flags = new Set<string>();
      for (const src of p.sources) {
        for (const r of byPage.get(`${src.file}\0${src.page}`) ?? []) {
          flags.add(r);
        }
      }
      const list = chords[chordKey(st.stationId, p.lineId)] ?? [];
      if (list.length > 0) {
        const gap = Math.min(
          ...list.map((c) => undirectedAngleGap(p.bearingDeg, c)),
        );
        if (gap > GEOGRAPHY_GAP_LIMIT) flags.add("bearing-vs-geography");
      }
      if (flags.size === 0) return p;
      return { ...p, flags: [...flags].sort() };
    }),
  }));
}

export function reviewExtract(
  pages: readonly FoiPageExtract[],
  northConflicts: readonly string[] = [],
  placementIssues: readonly FoiPlacementIssue[] = [],
): FoiExtractReview[] {
  const conflict = new Set(northConflicts);
  const byPage = new Map<string, string[]>();
  for (const issue of placementIssues) {
    const k = `${issue.file}\0${issue.page}`;
    const list = byPage.get(k) ?? [];
    if (!list.includes(issue.reason)) list.push(issue.reason);
    byPage.set(k, list);
  }
  const out: FoiExtractReview[] = [];
  for (const p of pages) {
    if (p.reviewed) continue;
    const reasons: string[] = [];
    if (p.confidence === "low") reasons.push("low-confidence");
    if (p.depths.length === 0) reasons.push("no-depths");
    if (p.northDeg == null) reasons.push("no-north");
    if (p.depths.some((d) => d.lineId == null)) reasons.push("unknown-line");
    if (p.stationId && conflict.has(p.stationId)) reasons.push("north-disagreement");
    if (p.stationId && (p.platforms ?? []).length === 0) {
      reasons.push("no-placement");
    }
    const extra = byPage.get(`${p.file}\0${p.page}`);
    if (extra) reasons.push(...extra);
    for (const issue of pageBearingIssues(p)) {
      if (!reasons.includes(issue.reason)) reasons.push(issue.reason);
    }
    if (reasons.length > 0) {
      out.push({
        file: p.file,
        page: p.page,
        stationId: p.stationId,
        reasons,
      });
    }
  }
  return out;
}

type ObservedDepth = {
  label?: unknown;
  metres?: unknown;
  meters?: unknown;
  lineId?: unknown;
};

/** Raw body of one data/foi/observations/<sheet>.json file. */
export type ObservationBody = {
  northDeg?: unknown;
  depths?: unknown;
  confidence?: unknown;
  raw?: unknown;
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/m$/i, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read an observation body into the depth / compass half of a page extract. */
export function parseObservedLayout(raw: unknown): Pick<
  FoiPageExtract,
  "northDeg" | "depths" | "confidence" | "raw"
> {
  const obj = observationBody(raw);
  const northDeg = asNumber(obj.northDeg);
  const depthList = Array.isArray(obj.depths) ? obj.depths : [];
  const depths: FoiDepth[] = [];
  for (const item of depthList) {
    if (!item || typeof item !== "object") continue;
    const d = item as ObservedDepth;
    const metres = asNumber(d.metres ?? d.meters);
    const label = typeof d.label === "string" ? d.label.trim() : "";
    if (metres == null || !label) continue;
    const lineId =
      typeof d.lineId === "string" && d.lineId.trim()
        ? normalizeSchematicLineId(d.lineId)
        : null;
    depths.push(
      ...attachLineIds([{ label, metres, lineId }]),
    );
  }
  const confidence = obj.confidence === "low" ? "low" : "high";
  const note = typeof obj.raw === "string" ? obj.raw : "";
  return { northDeg, depths, confidence, raw: note };
}

function asNormPoint(v: unknown): [number, number] | null {
  let u: number | null = null;
  let w: number | null = null;
  if (Array.isArray(v) && v.length >= 2) {
    u = asNumber(v[0]);
    w = asNumber(v[1]);
  } else if (v && typeof v === "object") {
    const o = v as { u?: unknown; v?: unknown; x?: unknown; y?: unknown };
    u = asNumber(o.u ?? o.x);
    w = asNumber(o.v ?? o.y);
  }
  if (u == null || w == null) return null;
  if (Math.abs(u) > 1.5 || Math.abs(w) > 1.5) {
    u /= 100;
    w /= 100;
  }
  return [u, w];
}

function numbersFromUnknown(v: unknown, caption: string): number[] {
  const out: number[] = [];
  const add = (n: number) => {
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  };
  if (Array.isArray(v)) {
    for (const item of v) {
      const n = asNumber(item);
      if (n != null) add(Math.round(n));
    }
  } else {
    const n = asNumber(v);
    if (n != null) add(Math.round(n));
  }
  const re = /(?:plat(?:form)?s?\s*)(\d+)(?:\s*(?:&|and|,|\/)\s*(\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption))) {
    add(Number(m[1]));
    if (m[2]) add(Number(m[2]));
  }
  return out;
}

function parseEnd(v: unknown): FoiPlatformEnd | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "north" || s === "south" || s === "east" || s === "west") return s;
  return null;
}

/** Read an observation body into platform endpoint marks. */
export function parseObservedPlacement(raw: unknown): {
  platforms: FoiPlatformMark[];
  reference: FoiPageReference | undefined;
  confidence: FoiConfidence;
  raw: string;
} {
  const obj = observationBody(raw) as Record<string, unknown>;
  const list = Array.isArray(obj.platforms) ? obj.platforms : [];
  const platforms: FoiPlatformMark[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const caption =
      typeof p.caption === "string"
        ? p.caption.trim()
        : typeof p.label === "string"
          ? p.label.trim()
          : "";
    const a = asNormPoint(p.a);
    const b = asNormPoint(p.b);
    if (!a || !b) continue;
    const bearingDeg = asNumber(p.bearingDeg ?? p.bearing);
    const lineRaw =
      typeof p.lineId === "string" && p.lineId.trim()
        ? normalizeSchematicLineId(p.lineId)
        : null;
    const platformNumbers = numbersFromUnknown(
      p.platformNumbers ?? p.numbers,
      caption,
    );
    const grid =
      typeof p.grid === "string" && p.grid.trim() ? p.grid.trim() : null;
    const confidence = p.confidence === "low" ? "low" : "high";
    platforms.push(
      ...attachPlatformLineIds([
        {
          caption: caption || "platform",
          lineId: lineRaw,
          platformNumbers,
          end: parseEnd(p.end),
          bearingDeg,
          a,
          b,
          grid,
          confidence,
        },
      ]),
    );
  }
  let reference: FoiPageReference | undefined;
  const ref = obj.reference;
  if (ref && typeof ref === "object") {
    const r = ref as Record<string, unknown>;
    const at = asNormPoint(r.at);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (at && label) reference = { label, at };
  }
  const confidence = obj.confidence === "low" ? "low" : "high";
  const note = typeof obj.raw === "string" ? obj.raw : "";
  return { platforms, reference, confidence, raw: note };
}

function observationBody(raw: unknown): ObservationBody {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed) as ObservationBody;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as ObservationBody;
  return {};
}
