/**
 * Inter-station line chains, platform anchors, and bearings.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  HUBKGX_ORIGIN,
  SCHEMATIC_METRES_PER_UNIT,
  latLonToWorld,
  type LatLon,
} from "./geo";
import { bearingToRotationY } from "./foi-project";
import {
  normalizeSchematicLineId,
  schematicLevelForLine,
} from "./levels";
import {
  DEEP_TUBE_DIAMETER_M,
  PLATFORM_TUBE_OFFSET_M,
  PLATFORM_WIDTH_M,
  SCHEMATIC_UNIT_M,
  isSubsurfaceLine,
} from "./lu-scale";
import type { SchematicNode, SchematicStation } from "./types";

export { bearingToRotationY };

export type LineAnchor = {
  /** Schematic-plan offset from the street centroid. x → world X, y → world Z. */
  dx: number;
  dz: number;
};

export type LineChain = {
  id: string;
  lineId: string;
  level: number;
  stationIds: string[];
  /** True when the path is a loop (Circle, etc.). */
  closed?: boolean;
};

export type LineStation = {
  lat: number;
  lon: number;
};

/** One shared tube, or a left/right pair for deep-level running tunnels. */
export type LineTrackAnchors = LineAnchor | [LineAnchor, LineAnchor];

export type LineNetwork = {
  generatedAt: string;
  stations: Record<string, LineStation>;
  /** stationId → lineId → offset(s). Missing means `{ dx: 0, dz: 0 }`. */
  anchors: Record<string, Record<string, LineTrackAnchors>>;
  /** stationId → lineId → rotationY (radians) aligning a +Z-long slab to the line. */
  angles: Record<string, Record<string, number>>;
  /** stationId → lineId set when `bearingDeg` came from FOI. */
  foi: Record<string, Record<string, true>>;
  chains: LineChain[];
};

export type LineNetworkInput = {
  stations: { id: string; lat: number; lon: number }[];
  edges: { from: string; to: string; lineId: string }[];
  schematics: Map<string, SchematicStation>;
  origin?: LatLon;
  generatedAt?: string;
};

export function streetCentroid(
  nodes: SchematicNode[],
): { x: number; y: number } {
  const streets = nodes.filter((n) => n.type === "street");
  const refs = streets.length > 0 ? streets : nodes;
  if (refs.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const n of refs) {
    x += n.x;
    y += n.y;
  }
  return { x: x / refs.length, y: y / refs.length };
}

function platformsOnLine(
  nodes: SchematicNode[],
  lineId: string,
): SchematicNode[] {
  const id = normalizeSchematicLineId(lineId);
  return nodes.filter(
    (n) =>
      n.type === "platform" &&
      n.lineId &&
      normalizeSchematicLineId(n.lineId) === id,
  );
}

function headingAngle(plats: SchematicNode[]): number {
  for (const p of plats) {
    if (p.bearingDeg != null) return bearingToRotationY(p.bearingDeg);
  }
  return 0;
}

/** +Z-long axis in schematic XZ after `rotationY`. */
export function headingAxis(rotationY: number): { x: number; z: number } {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

/** Perpendicular to a +Z-long slab (same as tube fanout). */
export function headingPerp(rotationY: number): { x: number; z: number } {
  return { x: Math.cos(rotationY), z: -Math.sin(rotationY) };
}

export function asTrackPair(value: LineTrackAnchors | undefined): LineAnchor[] {
  if (value == null) return [{ dx: 0, dz: 0 }];
  return Array.isArray(value) ? value : [value];
}

/**
 * Mean of every platform on the line minus the street centroid.
 * Subsurface lines keep this single shared offset.
 */
export function platformAnchorOffset(
  nodes: SchematicNode[],
  lineId: string,
): LineAnchor {
  const tracks = platformTrackAnchors(nodes, lineId);
  if (tracks.length === 1) return tracks[0]!;
  return {
    dx: (tracks[0]!.dx + tracks[1]!.dx) / 2,
    dz: (tracks[0]!.dz + tracks[1]!.dz) / 2,
  };
}

const FAN_GAP_M = PLATFORM_WIDTH_M + DEEP_TUBE_DIAMETER_M;
/** Twin-bore FOI boxes sit farther apart than a generate-fan / island pair. */
const FAR_PAIR_M = 1.25 * FAN_GAP_M;
const TUBE_OFFSET_U = PLATFORM_TUBE_OFFSET_M / SCHEMATIC_UNIT_M;

/**
 * Deep-level: two track offsets (left/right along the bearing perpendicular),
 * each a platform-half-width plus tube radius off the slab.
 * Cut-and-cover: one shared offset (the platform centroid).
 */
export function platformTrackAnchors(
  nodes: SchematicNode[],
  lineId: string,
): LineAnchor[] {
  const plats = platformsOnLine(nodes, lineId);
  const street = streetCentroid(nodes);
  if (isSubsurfaceLine(lineId)) {
    if (plats.length === 0) return [{ dx: 0, dz: 0 }];
    let x = 0;
    let y = 0;
    for (const p of plats) {
      x += p.x;
      y += p.y;
    }
    x /= plats.length;
    y /= plats.length;
    return [{ dx: x - street.x, dz: y - street.y }];
  }
  if (plats.length === 0) return [{ dx: 0, dz: 0 }, { dx: 0, dz: 0 }];
  const angle = headingAngle(plats);
  const perp = headingPerp(angle);
  const ranked = plats.map((p) => {
    const dx = p.x - street.x;
    const dz = p.y - street.y;
    return { dx, dz, s: dx * perp.x + dz * perp.z };
  });
  ranked.sort((a, b) => a.s - b.s || a.dx - b.dx || a.dz - b.dz);
  if (ranked.length === 1) {
    const gap = FAN_GAP_M / SCHEMATIC_UNIT_M;
    const a = ranked[0]!;
    return [
      { dx: a.dx - 0.5 * gap * perp.x, dz: a.dz - 0.5 * gap * perp.z },
      { dx: a.dx + 0.5 * gap * perp.x, dz: a.dz + 0.5 * gap * perp.z },
    ];
  }
  const lo = ranked[0]!;
  const hi = ranked[ranked.length - 1]!;
  const spanU = Math.hypot(hi.dx - lo.dx, hi.dz - lo.dz);
  const towardSibling = spanU * SCHEMATIC_UNIT_M > FAR_PAIR_M;
  const mx = (lo.dx + hi.dx) / 2;
  const mz = (lo.dz + hi.dz) / 2;
  const offsetFromSlab = (p: { dx: number; dz: number }): LineAnchor => {
    const vx = mx - p.dx;
    const vz = mz - p.dz;
    const len = Math.hypot(vx, vz);
    if (len < 1e-9) return { dx: p.dx, dz: p.dz };
    const sign = towardSibling ? 1 : -1;
    return {
      dx: p.dx + sign * TUBE_OFFSET_U * (vx / len),
      dz: p.dz + sign * TUBE_OFFSET_U * (vz / len),
    };
  };
  return [offsetFromSlab(lo), offsetFromSlab(hi)];
}

export function lineAnchor(
  anchors: LineNetwork["anchors"],
  stationId: string,
  lineId: string,
  track = 0,
): LineAnchor {
  const tracks = asTrackPair(anchors[stationId]?.[lineId]);
  return tracks[track] ?? tracks[0] ?? { dx: 0, dz: 0 };
}

export function lineAnchorMean(
  anchors: LineNetwork["anchors"],
  stationId: string,
  lineId: string,
): LineAnchor {
  const tracks = asTrackPair(anchors[stationId]?.[lineId]);
  if (tracks.length === 1) return tracks[0]!;
  return {
    dx: (tracks[0]!.dx + tracks[1]!.dx) / 2,
    dz: (tracks[0]!.dz + tracks[1]!.dz) / 2,
  };
}

export function lineAnchorWorld(
  station: LineStation,
  offset: LineAnchor,
  origin: LatLon,
  scale: number = SCHEMATIC_METRES_PER_UNIT,
): { x: number; z: number } {
  const w = latLonToWorld(station.lat, station.lon, origin);
  return {
    x: w.x + offset.dx * scale,
    z: w.z + offset.dz * scale,
  };
}

function undirectedKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Maximal paths per line, split at termini and junctions. Deterministic:
 * station ids and neighbour walks are sorted.
 */
export function walkLineChains(
  edges: { from: string; to: string; lineId: string }[],
): { lineId: string; stationIds: string[]; closed: boolean }[] {
  const byLine = new Map<string, { from: string; to: string }[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const lineId = normalizeSchematicLineId(e.lineId);
    const list = byLine.get(lineId) ?? [];
    list.push({ from: e.from, to: e.to });
    byLine.set(lineId, list);
  }

  const chains: { lineId: string; stationIds: string[]; closed: boolean }[] =
    [];
  const lineIds = [...byLine.keys()].sort((a, b) => a.localeCompare(b));

  for (const lineId of lineIds) {
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      const set = adj.get(a) ?? new Set<string>();
      set.add(b);
      adj.set(a, set);
    };
    for (const e of byLine.get(lineId)!) {
      add(e.from, e.to);
      add(e.to, e.from);
    }

    const used = new Set<string>();
    const neighbours = (id: string) =>
      [...(adj.get(id) ?? [])].sort((a, b) => a.localeCompare(b));

    const walk = (
      start: string,
      first: string,
    ): { stationIds: string[]; closed: boolean } => {
      const path = [start, first];
      used.add(undirectedKey(start, first));
      let prev = start;
      let cur = first;
      while (true) {
        const nexts = neighbours(cur).filter(
          (n) => n !== prev && !used.has(undirectedKey(cur, n)),
        );
        if (nexts.length !== 1) break;
        const next = nexts[0]!;
        used.add(undirectedKey(cur, next));
        path.push(next);
        prev = cur;
        cur = next;
      }
      let closed = false;
      if (path.length > 2 && path[0] === path[path.length - 1]) {
        path.pop();
        closed = true;
      }
      return { stationIds: path, closed };
    };

    const nodes = [...adj.keys()].sort((a, b) => a.localeCompare(b));
    const starts = nodes.filter((id) => neighbours(id).length !== 2);
    const seeds = starts.length > 0 ? starts : nodes;

    for (const start of seeds) {
      for (const nb of neighbours(start)) {
        if (!used.has(undirectedKey(start, nb))) {
          chains.push({ lineId, ...walk(start, nb) });
        }
      }
    }
    for (const start of nodes) {
      for (const nb of neighbours(start)) {
        if (!used.has(undirectedKey(start, nb))) {
          chains.push({ lineId, ...walk(start, nb) });
        }
      }
    }
  }

  return chains;
}

function unitXZ(
  from: { x: number; z: number },
  to: { x: number; z: number },
): { x: number; z: number } | null {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const len = Math.hypot(x, z);
  if (len < 1e-6) return null;
  return { x: x / len, z: z / len };
}

/**
 * rotationY that maps a +Z-long platform onto the line's world-XZ tangent.
 * Through-stations use prev→next; termini use the single neighbour;
 * junctions pick the neighbour pair closest to a straight through-line.
 */
export function stationLineAngle(
  stationId: string,
  neighbourIds: string[],
  worldOf: (id: string) => { x: number; z: number },
): number | null {
  const unique = [...new Set(neighbourIds)].sort((a, b) =>
    a.localeCompare(b),
  );
  if (unique.length === 0) return null;
  const c = worldOf(stationId);
  let tx = 0;
  let tz = 0;
  if (unique.length === 1) {
    const n = worldOf(unique[0]!);
    tx = n.x - c.x;
    tz = n.z - c.z;
  } else {
    let bestDot = Infinity;
    let bestA = unique[0]!;
    let bestB = unique[1]!;
    for (let i = 0; i < unique.length; i++) {
      const ua = unitXZ(c, worldOf(unique[i]!));
      if (!ua) continue;
      for (let j = i + 1; j < unique.length; j++) {
        const ub = unitXZ(c, worldOf(unique[j]!));
        if (!ub) continue;
        const dot = ua.x * ub.x + ua.z * ub.z;
        if (dot < bestDot) {
          bestDot = dot;
          bestA = unique[i]!;
          bestB = unique[j]!;
        }
      }
    }
    const a = worldOf(bestA);
    const b = worldOf(bestB);
    tx = b.x - a.x;
    tz = b.z - a.z;
  }
  if (Math.hypot(tx, tz) < 1e-6) return null;
  return Math.atan2(tx, tz);
}

/** First FOI bearing on this line at the station, or null. Per-line fallback. */
export function foiBearingAngle(
  schematic: SchematicStation | undefined,
  lineId: string,
): number | null {
  if (!schematic) return null;
  const id = normalizeSchematicLineId(lineId);
  for (const n of schematic.nodes) {
    if (n.type !== "platform" || n.bearingDeg == null || !n.lineId) continue;
    if (normalizeSchematicLineId(n.lineId) !== id) continue;
    return bearingToRotationY(n.bearingDeg);
  }
  return null;
}

export function buildLineNetwork(input: LineNetworkInput): LineNetwork {
  const origin = input.origin ?? HUBKGX_ORIGIN;
  const stations: Record<string, LineStation> = {};
  for (const s of input.stations) {
    stations[s.id] = { lat: s.lat, lon: s.lon };
  }

  const rawChains = walkLineChains(input.edges);
  const chains: LineChain[] = rawChains.map((c, i) => ({
    id: `${c.lineId}::${i}`,
    lineId: c.lineId,
    level: schematicLevelForLine(c.lineId),
    stationIds: c.stationIds,
    ...(c.closed ? { closed: true as const } : {}),
  }));

  const adjByLine = new Map<string, Map<string, string[]>>();
  const addAdj = (lineId: string, a: string, b: string) => {
    let adj = adjByLine.get(lineId);
    if (!adj) {
      adj = new Map();
      adjByLine.set(lineId, adj);
    }
    const list = adj.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    adj.set(a, list);
  };
  for (const e of input.edges) {
    if (e.from === e.to) continue;
    const lineId = normalizeSchematicLineId(e.lineId);
    addAdj(lineId, e.from, e.to);
    addAdj(lineId, e.to, e.from);
  }

  const anchors: LineNetwork["anchors"] = {};
  const foi: LineNetwork["foi"] = {};
  const stationIds = [...new Set([...Object.keys(stations)])].sort((a, b) =>
    a.localeCompare(b),
  );
  const lineIdsAt = new Map<string, Set<string>>();
  for (const [lineId, adj] of adjByLine) {
    for (const id of adj.keys()) {
      const set = lineIdsAt.get(id) ?? new Set();
      set.add(lineId);
      lineIdsAt.set(id, set);
    }
  }

  for (const stationId of stationIds) {
    const schematic = input.schematics.get(stationId);
    const lines = lineIdsAt.get(stationId);
    if (!schematic || !lines) continue;
    for (const lineId of [...lines].sort((a, b) => a.localeCompare(b))) {
      const tracks = platformTrackAnchors(schematic.nodes, lineId);
      const nonzero = tracks.some((t) => t.dx !== 0 || t.dz !== 0);
      if (!nonzero) continue;
      const row = anchors[stationId] ?? (anchors[stationId] = {});
      row[lineId] = tracks.length === 1 ? tracks[0]! : [tracks[0]!, tracks[1]!];
    }
  }

  const worldOf = (stationId: string, lineId: string) => {
    const st = stations[stationId];
    if (!st) return { x: 0, z: 0 };
    return lineAnchorWorld(st, lineAnchorMean(anchors, stationId, lineId), origin);
  };

  const angles: LineNetwork["angles"] = {};
  for (const [lineId, adj] of [...adjByLine.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const ids = [...adj.keys()].sort((a, b) => a.localeCompare(b));
    for (const stationId of ids) {
      if (!stations[stationId]) continue;
      const schematic = input.schematics.get(stationId);
      const foiAngle = foiBearingAngle(schematic, lineId);
      const angle =
        foiAngle ??
        stationLineAngle(
          stationId,
          adj.get(stationId) ?? [],
          (id) => worldOf(id, lineId),
        );
      if (angle == null) continue;
      const row = angles[stationId] ?? (angles[stationId] = {});
      row[lineId] = angle;
      if (foiAngle != null) {
        const hit = foi[stationId] ?? (foi[stationId] = {});
        hit[lineId] = true;
      }
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    stations,
    anchors,
    angles,
    foi,
    chains,
  };
}
