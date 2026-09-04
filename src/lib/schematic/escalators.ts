/**
 * CULG escalator identity/rise joined to FOI bank geometry.
 * Isolated from routing — do not import plan/status/topology.
 * Transcribed CULG rows and StopPoint counts are snapshots, never live fetches.
 */

import type { FoiDepth, FoiStationEscalator, FoiStationLayout } from "./foi-extract";

export const CULG_SOURCE = "https://www.davros.org/rail/culg/vertical.html";

export const RISE_DISAGREE_M = 3;

/** CULG 26°23′ shafts. Standard LU escalators are 30°. */
export const CULG_ANGLE_26_23 = 26.383;

export type CulgEscalatorBank = {
  eNumbers: string[];
  from: string;
  to: string;
  riseM: number | null;
  angleDeg: number;
  /** True when CULG says the bank is being installed. */
  installing?: boolean;
};

export type CulgStationEscalators = {
  stationId: string;
  name: string;
  tflEscalatorCount: number;
  banks: CulgEscalatorBank[];
};

export type CulgEscalatorsFile = {
  source: string;
  disclaimer: string;
  tflSnapshotAt: string;
  stations: CulgStationEscalators[];
};

const STOP = new Set([
  "the",
  "to",
  "and",
  "line",
  "plus",
  "end",
  "level",
  "a",
  "of",
  "same",
  "shaft",
  "bank",
]);

export function landingTokens(text: string): Set<string> {
  const s = text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(
    s
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Jaccard overlap of landing tokens; 0 when either side is empty. */
export function landingScore(a: string, b: string): number {
  const A = landingTokens(a);
  const B = landingTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const t of A) if (B.has(t)) n++;
  return n / (A.size + B.size - n);
}

/** Score a FOI caption against CULG from/to, splitting on " to " when present. */
export function bankLandingScore(
  foiCaption: string,
  from: string,
  to: string,
): number {
  const parts = foiCaption.split(/\s+to\s+/i);
  if (parts.length >= 2) {
    const foiFrom = parts[0]!;
    const foiTo = parts.slice(1).join(" to ");
    return 0.5 * landingScore(foiFrom, from) + 0.5 * landingScore(foiTo, to);
  }
  return landingScore(foiCaption, `${from} ${to}`);
}

export function culgMachineCount(station: CulgStationEscalators): number {
  let n = 0;
  for (const b of station.banks) {
    if (b.installing) continue;
    n += b.eNumbers.length;
  }
  return n;
}

export function escalatorCountMismatch(station: CulgStationEscalators): {
  culg: number;
  tfl: number;
  mismatch: boolean;
} {
  const culg = culgMachineCount(station);
  return {
    culg,
    tfl: station.tflEscalatorCount,
    mismatch: culg !== station.tflEscalatorCount,
  };
}

export function escalatorLengthM(riseM: number, angleDeg: number): number {
  const s = Math.sin((angleDeg * Math.PI) / 180);
  return s > 1e-9 ? riseM / s : riseM;
}

/** Horizontal run of a straight flight at `angleDeg`. */
export function escalatorPlanRunM(riseM: number, angleDeg: number): number {
  const t = Math.tan((angleDeg * Math.PI) / 180);
  return t > 1e-9 ? riseM / t : riseM;
}

export function pickRise(opts: {
  culgRiseM: number | null;
  topDepthM: number | null;
  botDepthM: number | null;
}): { riseM: number | null; flags: string[] } {
  const foiDelta =
    opts.topDepthM != null && opts.botDepthM != null
      ? Math.abs(opts.botDepthM - opts.topDepthM)
      : null;
  if (
    foiDelta != null &&
    opts.culgRiseM != null &&
    Math.abs(foiDelta - opts.culgRiseM) > RISE_DISAGREE_M
  ) {
    return { riseM: foiDelta, flags: ["rise-foi-over-culg"] };
  }
  return { riseM: opts.culgRiseM ?? foiDelta, flags: [] };
}

export function escalatorNodeId(stationId: string, eNumbers: string[]): string {
  const n = eNumbers
    .map((e) => Number.parseInt(e.replace(/^E/i, ""), 10))
    .filter((x) => Number.isFinite(x));
  const min = n.length > 0 ? Math.min(...n) : 0;
  return `${stationId}-Esc-${min}`;
}

const LINE_PATTERNS: [string, RegExp][] = [
  ["northern", /\bnorthern\b/i],
  ["victoria", /\bvictoria\b/i],
  ["piccadilly", /\bpiccadilly\b/i],
  ["central", /\bcentral\b/i],
  ["bakerloo", /\bbakerloo\b/i],
  ["jubilee", /\bjubilee\b/i],
  ["circle", /\bcircle\b/i],
  ["district", /\bdistrict\b/i],
  ["hammersmith-city", /\bhammersmith|\bh\s*&\s*c\b/i],
  ["metropolitan", /\bmetropolitan\b/i],
  ["waterloo-city", /\bwaterloo\s*&\s*city|\bw\s*&\s*c\b/i],
  ["dlr", /\bdlr\b/i],
];

export function landingLineIds(text: string): string[] {
  return LINE_PATTERNS.filter(([, re]) => re.test(text)).map(([id]) => id);
}

export function depthForLanding(
  text: string,
  depths: readonly FoiDepth[],
): number | null {
  const ids = landingLineIds(text);
  if (ids.length === 0) return null;
  const metres = [
    ...new Set(
      depths
        .filter((d) => d.lineId != null && ids.includes(d.lineId))
        .map((d) => d.metres),
    ),
  ];
  return metres.length === 1 ? metres[0]! : null;
}

export function isSurfaceLanding(text: string): boolean {
  return /\bstreet\b|\bsurface\b/.test(text.toLowerCase());
}

function landingDepths(
  from: string,
  to: string,
  depths: readonly FoiDepth[],
  culgRiseM: number | null,
): { topDepthM: number | null; botDepthM: number | null } {
  let topDepthM = isSurfaceLanding(from) ? 0 : depthForLanding(from, depths);
  let botDepthM = isSurfaceLanding(to) ? 0 : depthForLanding(to, depths);
  if (botDepthM == null && topDepthM != null && culgRiseM != null) {
    botDepthM = topDepthM + culgRiseM;
  }
  if (topDepthM == null && botDepthM != null && culgRiseM != null) {
    topDepthM = botDepthM - culgRiseM;
  }
  return { topDepthM, botDepthM };
}

function eKey(nums: readonly string[]): string {
  return [...nums].map((e) => e.toUpperCase()).sort().join(",");
}

type MatchCand = {
  banks: CulgEscalatorBank[];
  score: number;
};

function sameLandings(a: CulgEscalatorBank, b: CulgEscalatorBank): boolean {
  return (
    a.from.trim().toLowerCase() === b.from.trim().toLowerCase() &&
    a.to.trim().toLowerCase() === b.to.trim().toLowerCase()
  );
}

function combine(banks: CulgEscalatorBank[]): CulgEscalatorBank {
  const first = banks[0]!;
  return {
    eNumbers: banks.flatMap((b) => b.eNumbers),
    from: first.from,
    to: first.to,
    riseM: first.riseM,
    angleDeg: first.angleDeg,
    installing: banks.every((b) => b.installing) ? true : undefined,
  };
}

function candidatesForFoi(
  foi: FoiStationEscalator,
  remaining: CulgEscalatorBank[],
): MatchCand[] {
  const groups: CulgEscalatorBank[][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < remaining.length; i++) {
    if (seen.has(i)) continue;
    const g = [remaining[i]!];
    seen.add(i);
    for (let j = i + 1; j < remaining.length; j++) {
      if (seen.has(j)) continue;
      if (sameLandings(remaining[i]!, remaining[j]!)) {
        g.push(remaining[j]!);
        seen.add(j);
      }
    }
    groups.push(g);
  }

  const out: MatchCand[] = [];
  const foiKey = foi.eNumbers.length > 0 ? eKey(foi.eNumbers) : null;
  const caption = [foi.caption, foi.from, foi.to]
    .map((s) => s.trim())
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .join(" ");
  for (const g of groups) {
    const one = g[0]!;
    const merged = g.length > 1 ? combine(g) : one;
    if (foiKey) {
      if (eKey(one.eNumbers) === foiKey) out.push({ banks: [one], score: 2 });
      else if (eKey(merged.eNumbers) === foiKey) out.push({ banks: g, score: 2 });
      continue;
    }
    let score = bankLandingScore(caption, merged.from, merged.to);
    if (foi.machines > 0 && merged.eNumbers.length === foi.machines) {
      score += 0.15;
    }
    if (score >= 0.35) out.push({ banks: g.length > 1 ? g : [one], score });
  }
  return out;
}

function pickMatch(
  foi: FoiStationEscalator,
  remaining: CulgEscalatorBank[],
): CulgEscalatorBank[] | null {
  const cands = candidatesForFoi(foi, remaining);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0]!;
  if (cands.length > 1 && Math.abs(cands[1]!.score - best.score) < 1e-6) {
    return null;
  }
  return best.banks;
}

function bakeJoined(
  stationId: string,
  culg: CulgEscalatorBank,
  foi: FoiStationEscalator | null,
  depths: readonly FoiDepth[],
): FoiStationEscalator {
  const roundM = (n: number | null): number | null =>
    n == null ? null : Math.round(n * 1000) / 1000;
  const { topDepthM, botDepthM } = landingDepths(
    culg.from,
    culg.to,
    depths,
    culg.riseM,
  );
  const rise = pickRise({
    culgRiseM: culg.riseM,
    topDepthM,
    botDepthM,
  });
  const flags = [...rise.flags];
  if (culg.installing) flags.push("installing");
  const placed =
    foi != null &&
    foi.eastTopM != null &&
    foi.northTopM != null &&
    foi.eastBotM != null &&
    foi.northBotM != null;
  const out: FoiStationEscalator = {
    id: escalatorNodeId(stationId, culg.eNumbers),
    caption: foi?.caption || `${culg.from} to ${culg.to}`,
    eNumbers: [...culg.eNumbers],
    from: culg.from,
    to: culg.to,
    eastTopM: placed ? foi!.eastTopM : null,
    northTopM: placed ? foi!.northTopM : null,
    eastBotM: placed ? foi!.eastBotM : null,
    northBotM: placed ? foi!.northBotM : null,
    topDepthM: roundM(topDepthM),
    botDepthM: roundM(botDepthM),
    riseM: roundM(rise.riseM),
    angleDeg: culg.angleDeg,
    machines: culg.eNumbers.length,
    placed,
    sources: foi?.sources ?? [],
  };
  if (flags.length > 0) out.flags = flags.sort();
  return out;
}

/**
 * Attach CULG identity/rise to FOI-projected banks. Unmatched CULG rows stay
 * `placed: false`. Join is by eNumbers or landing text, never pixel order.
 */
export function joinCulgEscalators(
  stations: readonly FoiStationLayout[],
  culg: CulgEscalatorsFile,
): FoiStationLayout[] {
  const byId = new Map(culg.stations.map((s) => [s.stationId, s]));
  return stations.map((st) => {
    const entry = byId.get(st.stationId);
    if (!entry) return st;
    const remaining = [...entry.banks];
    const usedFoi = new Set<number>();
    const joined: FoiStationEscalator[] = [];

    const foiSorted = st.escalators
      .map((b, i) => ({ b, i }))
      .sort((a, b) => a.b.id.localeCompare(b.b.id));
    for (const { b, i } of foiSorted) {
      const hit = pickMatch(b, remaining);
      if (!hit) continue;
      usedFoi.add(i);
      for (const bank of hit) {
        const idx = remaining.indexOf(bank);
        if (idx >= 0) remaining.splice(idx, 1);
      }
      joined.push(bakeJoined(st.stationId, combine(hit), b, st.depths));
    }

    remaining.sort((a, b) => a.eNumbers[0]!.localeCompare(b.eNumbers[0]!));
    for (const bank of remaining) {
      joined.push(bakeJoined(st.stationId, bank, null, st.depths));
    }
    for (let i = 0; i < st.escalators.length; i++) {
      if (usedFoi.has(i)) continue;
      joined.push(st.escalators[i]!);
    }
    joined.sort((a, b) => a.id.localeCompare(b.id));
    return { ...st, escalators: joined };
  });
}
