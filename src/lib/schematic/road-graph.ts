/**
 * Snap OSM road ways into a per-tile graph and stitch degree-2 chains.
 * Isolated from routing — do not import plan/status/topology.
 */

import { MIN_RING_EDGE_M, simplifyRing } from "./osm";

/** ENU snap grid so neighbouring tiles agree on seam vertices. */
export const ROAD_SNAP_M = 0.5;

export type RoadWay = {
  path: [number, number][];
  widthM: number;
};

/** Outer junction triangle in ENU [east, north]. */
export type RoadWedge = {
  node: [number, number];
  a: [number, number];
  b: [number, number];
};

type End = "start" | "end";

type EndHit = { way: number; end: End };

type Spoke = {
  way: number;
  /** Scene unit direction from the node toward the neighbour. */
  dx: number;
  dz: number;
  half: number;
};

function snapCoord(v: number): number {
  return Math.round(v / ROAD_SNAP_M) * ROAD_SNAP_M;
}

function nodeKey(e: number, n: number): string {
  return `${Math.round(e / ROAD_SNAP_M)},${Math.round(n / ROAD_SNAP_M)}`;
}

function snapPath(path: [number, number][]): [number, number][] {
  const simple = simplifyRing(path, MIN_RING_EDGE_M);
  const out: [number, number][] = [];
  for (const [e, n] of simple) {
    const p: [number, number] = [snapCoord(e), snapCoord(n)];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

function lastIndex(path: [number, number][]): number {
  return path.length - 1;
}

function endPoint(way: RoadWay, end: End): [number, number] {
  return end === "start" ? way.path[0]! : way.path[lastIndex(way.path)]!;
}

function concatWays(a: RoadWay, aEnd: End, b: RoadWay, bEnd: End): RoadWay {
  let path: [number, number][];
  if (aEnd === "end" && bEnd === "start") {
    path = [...a.path, ...b.path.slice(1)];
  } else if (aEnd === "end" && bEnd === "end") {
    path = [...a.path, ...[...b.path].reverse().slice(1)];
  } else if (aEnd === "start" && bEnd === "end") {
    path = [...b.path, ...a.path.slice(1)];
  } else {
    path = [...[...b.path].reverse(), ...a.path.slice(1)];
  }
  return { path, widthM: a.widthM };
}

function interiorKeys(ways: RoadWay[]): Set<string> {
  const keys = new Set<string>();
  for (const way of ways) {
    for (let i = 1; i < way.path.length - 1; i++) {
      const p = way.path[i]!;
      keys.add(nodeKey(p[0], p[1]));
    }
  }
  return keys;
}

function endpointIndex(ways: RoadWay[]): Map<string, EndHit[]> {
  const map = new Map<string, EndHit[]>();
  const add = (way: number, end: End, p: [number, number]) => {
    const key = nodeKey(p[0], p[1]);
    const list = map.get(key);
    const hit = { way, end };
    if (list) list.push(hit);
    else map.set(key, [hit]);
  };
  for (let i = 0; i < ways.length; i++) {
    const path = ways[i]!.path;
    add(i, "start", path[0]!);
    add(i, "end", path[lastIndex(path)]!);
  }
  return map;
}

function mergeDegree2(ways: RoadWay[]): RoadWay[] {
  let cur = ways;
  for (let step = 0; step < ways.length + 2; step++) {
    const interiors = interiorKeys(cur);
    const ends = endpointIndex(cur);
    let merged: { a: number; aEnd: End; b: number; bEnd: End } | null = null;
    for (const [key, hits] of ends) {
      if (interiors.has(key) || hits.length !== 2) continue;
      const a = hits[0]!;
      const b = hits[1]!;
      if (a.way === b.way) continue;
      const wa = cur[a.way]!;
      const wb = cur[b.way]!;
      if (wa.widthM !== wb.widthM) continue;
      merged = { a: a.way, aEnd: a.end, b: b.way, bEnd: b.end };
      break;
    }
    if (!merged) return cur;
    const hi = Math.max(merged.a, merged.b);
    const lo = Math.min(merged.a, merged.b);
    const next = concatWays(
      cur[merged.a]!,
      merged.aEnd,
      cur[merged.b]!,
      merged.bEnd,
    );
    cur = cur.filter((_, i) => i !== lo && i !== hi);
    if (next.path.length >= 2) cur.push(next);
  }
  return cur;
}

function sceneAway(
  node: [number, number],
  neighbor: [number, number],
): { dx: number; dz: number } | null {
  const dx = -(neighbor[0] - node[0]);
  const dz = neighbor[1] - node[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  return { dx: dx / len, dz: dz / len };
}

function leftNormal(dx: number, dz: number): { x: number; z: number } {
  return { x: -dz, z: dx };
}

function spokesAt(
  ways: RoadWay[],
  node: [number, number],
): Spoke[] {
  const key = nodeKey(node[0], node[1]);
  const spokes: Spoke[] = [];
  for (let w = 0; w < ways.length; w++) {
    const path = ways[w]!.path;
    const half = ways[w]!.widthM / 2;
    for (let i = 0; i < path.length; i++) {
      const p = path[i]!;
      if (nodeKey(p[0], p[1]) !== key) continue;
      const prev = i > 0 ? path[i - 1] : null;
      const next = i < path.length - 1 ? path[i + 1] : null;
      if (prev) {
        const dir = sceneAway(p, prev);
        if (dir) spokes.push({ way: w, ...dir, half });
      }
      if (next) {
        const dir = sceneAway(p, next);
        if (dir) spokes.push({ way: w, ...dir, half });
      }
    }
  }
  return spokes;
}

function ccwAngle(from: Spoke, to: Spoke): number {
  const cross = from.dx * to.dz - from.dz * to.dx;
  const dot = from.dx * to.dx + from.dz * to.dz;
  let a = Math.atan2(cross, dot);
  if (a < 0) a += Math.PI * 2;
  return a;
}

function outerWedge(
  node: [number, number],
  a: Spoke,
  b: Spoke,
): RoadWedge | null {
  const inDx = -a.dx;
  const inDz = -a.dz;
  const cross = inDx * b.dz - inDz * b.dx;
  const inL = leftNormal(inDx, inDz);
  const outL = leftNormal(b.dx, b.dz);
  const nodeX = -node[0];
  const nodeZ = node[1];
  let ax: number;
  let az: number;
  let bx: number;
  let bz: number;
  if (cross >= 0) {
    ax = nodeX - inL.x * a.half;
    az = nodeZ - inL.z * a.half;
    bx = nodeX - outL.x * b.half;
    bz = nodeZ - outL.z * b.half;
  } else {
    ax = nodeX + inL.x * a.half;
    az = nodeZ + inL.z * a.half;
    bx = nodeX + outL.x * b.half;
    bz = nodeZ + outL.z * b.half;
  }
  const area = (az - nodeZ) * (bx - nodeX) - (ax - nodeX) * (bz - nodeZ);
  if (Math.abs(area) < 1e-4) return null;
  return {
    node,
    a: [-ax, az],
    b: [-bx, bz],
  };
}

function wedgesForWays(ways: RoadWay[]): RoadWedge[] {
  const seen = new Set<string>();
  const wedges: RoadWedge[] = [];
  const visit = (p: [number, number]) => {
    const key = nodeKey(p[0], p[1]);
    if (seen.has(key)) return;
    seen.add(key);
    const spokes = spokesAt(ways, p);
    if (spokes.length < 2) return;
    const ordered = [...spokes].sort(
      (s, t) => Math.atan2(s.dz, s.dx) - Math.atan2(t.dz, t.dx),
    );
    const n = ordered.length;
    const thetas = ordered.map((s, i) => ccwAngle(s, ordered[(i + 1) % n]!));
    const reflex = thetas.findIndex((t) => t > Math.PI + 1e-6);
    const pairs: [number, number][] = [];
    if (reflex >= 0) {
      pairs.push([reflex, (reflex + 1) % n]);
    } else {
      for (let i = 0; i < n; i++) pairs.push([i, (i + 1) % n]);
    }
    for (const [i, j] of pairs) {
      const a = ordered[i]!;
      const b = ordered[j]!;
      if (a.way === b.way) continue;
      const wedge = outerWedge(p, a, b);
      if (wedge) wedges.push(wedge);
    }
  };
  for (const way of ways) {
    for (const p of way.path) visit(p);
  }
  return wedges;
}

/**
 * Snap vertices, stitch same-width degree-2 chains, and describe outer
 * wedges at remaining junctions (width changes and T/Y hubs).
 */
export function stitchRoads(
  roads: { path: [number, number][]; widthM: number }[],
): { ways: RoadWay[]; wedges: RoadWedge[] } {
  const snapped: RoadWay[] = [];
  for (const road of roads) {
    const path = snapPath(road.path);
    if (path.length < 2 || road.widthM <= 0) continue;
    snapped.push({ path, widthM: road.widthM });
  }
  const ways = mergeDegree2(snapped);
  return { ways, wedges: wedgesForWays(ways) };
}
