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
import {
  normalizeSchematicLineId,
  schematicLevelForLine,
} from "./levels";
import type { SchematicNode, SchematicStation } from "./types";

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

export type LineNetwork = {
  generatedAt: string;
  stations: Record<string, LineStation>;
  /** stationId → lineId → offset. Missing means `{ dx: 0, dz: 0 }`. */
  anchors: Record<string, Record<string, LineAnchor>>;
  /** stationId → lineId → rotationY (radians) aligning a +Z-long slab to the line. */
  angles: Record<string, Record<string, number>>;
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

export function platformAnchorOffset(
  nodes: SchematicNode[],
  lineId: string,
): LineAnchor {
  const id = normalizeSchematicLineId(lineId);
  const plats = nodes.filter(
    (n) =>
      n.type === "platform" &&
      n.lineId &&
      normalizeSchematicLineId(n.lineId) === id,
  );
  if (plats.length === 0) return { dx: 0, dz: 0 };
  const street = streetCentroid(nodes);
  let x = 0;
  let y = 0;
  for (const p of plats) {
    x += p.x;
    y += p.y;
  }
  x /= plats.length;
  y /= plats.length;
  return { dx: x - street.x, dz: y - street.y };
}

export function lineAnchor(
  anchors: LineNetwork["anchors"],
  stationId: string,
  lineId: string,
): LineAnchor {
  return anchors[stationId]?.[lineId] ?? { dx: 0, dz: 0 };
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
      const offset = platformAnchorOffset(schematic.nodes, lineId);
      if (offset.dx === 0 && offset.dz === 0) continue;
      const row = anchors[stationId] ?? (anchors[stationId] = {});
      row[lineId] = offset;
    }
  }

  const worldOf = (stationId: string, lineId: string) => {
    const st = stations[stationId];
    if (!st) return { x: 0, z: 0 };
    return lineAnchorWorld(st, lineAnchor(anchors, stationId, lineId), origin);
  };

  const angles: LineNetwork["angles"] = {};
  for (const [lineId, adj] of [...adjByLine.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const ids = [...adj.keys()].sort((a, b) => a.localeCompare(b));
    for (const stationId of ids) {
      if (!stations[stationId]) continue;
      const angle = stationLineAngle(
        stationId,
        adj.get(stationId) ?? [],
        (id) => worldOf(id, lineId),
      );
      if (angle == null) continue;
      const row = angles[stationId] ?? (angles[stationId] = {});
      row[lineId] = angle;
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    stations,
    anchors,
    angles,
    chains,
  };
}
