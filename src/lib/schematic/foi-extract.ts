/**
 * FOI axonometric layout extract: platform depths (metres) and compass.
 * Isolated from routing — do not import plan/status/topology.
 * Metres are approximate (~2015 FOI), never used for access decisions.
 */

import { normalizeSchematicLineId } from "./levels";

export type FoiConfidence = "high" | "low";

export type FoiDepth = {
  label: string;
  metres: number;
  lineId: string | null;
};

export type FoiPageExtract = {
  file: string;
  page: number;
  stationId: string | null;
  northDeg: number | null;
  depths: FoiDepth[];
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

export type FoiStationLayout = {
  stationId: string;
  northDeg: number | null;
  depths: FoiDepth[];
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
  "Approximate platform depths and drawing north from TfL FOI ~2015 axonometrics. Not survey, not for routing or access decisions.";

export const NORTH_AGREE_DEG = 20;

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
      confidence: hit.confidence ?? page.confidence,
      raw: hit.raw ?? page.raw,
    };
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
  return d.lineId ? `id:${d.lineId}` : `label:${d.label.trim().toLowerCase()}`;
}

export function mergeStationLayouts(
  pages: readonly FoiPageExtract[],
): { stations: FoiStationLayout[]; northConflicts: string[] } {
  const byStation = new Map<string, FoiPageExtract[]>();
  for (const p of pages) {
    if (!p.stationId) continue;
    const list = byStation.get(p.stationId) ?? [];
    list.push(p);
    byStation.set(p.stationId, list);
  }

  const stations: FoiStationLayout[] = [];
  const northConflicts: string[] = [];
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

    stations.push({
      stationId,
      northDeg,
      depths: [...byKey.values()],
      sources: group.map((p) => ({ file: p.file, page: p.page })),
    });
  }
  return { stations, northConflicts };
}

export function reviewExtract(
  pages: readonly FoiPageExtract[],
  northConflicts: readonly string[] = [],
): FoiExtractReview[] {
  const conflict = new Set(northConflicts);
  const out: FoiExtractReview[] = [];
  for (const p of pages) {
    if (p.reviewed) continue;
    const reasons: string[] = [];
    if (p.confidence === "low") reasons.push("low-confidence");
    if (p.depths.length === 0) reasons.push("no-depths");
    if (p.northDeg == null) reasons.push("no-north");
    if (p.depths.some((d) => d.lineId == null)) reasons.push("unknown-line");
    if (p.stationId && conflict.has(p.stationId)) reasons.push("north-disagreement");
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

type VlmDepth = {
  label?: unknown;
  metres?: unknown;
  meters?: unknown;
  lineId?: unknown;
};

export type VlmLayout = {
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

/** Parse a vision-model JSON object (or fenced string) into a page extract body. */
export function parseVlmLayout(raw: unknown): Pick<
  FoiPageExtract,
  "northDeg" | "depths" | "confidence" | "raw"
> {
  const obj = unwrapVlm(raw);
  const northDeg = asNumber(obj.northDeg);
  const depthList = Array.isArray(obj.depths) ? obj.depths : [];
  const depths: FoiDepth[] = [];
  for (const item of depthList) {
    if (!item || typeof item !== "object") continue;
    const d = item as VlmDepth;
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

function unwrapVlm(raw: unknown): VlmLayout {
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(trimmed) as VlmLayout;
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1)) as VlmLayout;
        } catch {
          return {};
        }
      }
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as VlmLayout;
  return {};
}
