/**
 * OSM building footprint helpers for the schematic surface.
 * Isolated from routing — do not import plan/status/topology.
 */

import type { Aabb2 } from "./geo";

export const DEFAULT_BUILDING_HEIGHT_M = 10;
/** Drop footprint vertices closer than this; keeps the blocky look cheap. */
export const MIN_RING_EDGE_M = 2;

export type OsmBuilding = {
  id: string;
  height: number;
  /** ENU metres, [east, north]. */
  ring: [number, number][];
};

export type OsmArea = {
  id: string;
  kind: string;
  /** ENU metres, [east, north]. */
  ring: [number, number][];
};

export type OsmLine = {
  id: string;
  kind: string;
  /** ENU metres, [east, north]. */
  path: [number, number][];
};

function dropClosingDuplicate(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

/**
 * Collapse short edges. Closed rings stay closed in the caller (no duplicate last point).
 */
export function simplifyRing(
  ring: [number, number][],
  minEdgeM: number = MIN_RING_EDGE_M,
): [number, number][] {
  const open = dropClosingDuplicate(ring);
  if (open.length <= 4) return open;
  const out: [number, number][] = [open[0]!];
  for (let i = 1; i < open.length; i++) {
    const prev = out[out.length - 1]!;
    const p = open[i]!;
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= minEdgeM) out.push(p);
  }
  if (out.length < 3) return open;
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (
    out.length > 3 &&
    Math.hypot(last[0] - first[0], last[1] - first[1]) < minEdgeM
  ) {
    out.pop();
  }
  return out.length >= 3 ? out : open;
}

/** Sutherland–Hodgman against one axis-aligned half-plane. */
function clipRingToHalfPlane(
  ring: [number, number][],
  axis: 0 | 1,
  limit: number,
  keepAbove: boolean,
): [number, number][] {
  if (ring.length === 0) return ring;
  const inside = (p: [number, number]) =>
    keepAbove ? p[axis] >= limit : p[axis] <= limit;
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const aIn = inside(a);
    if (aIn) out.push(a);
    if (aIn === inside(b)) continue;
    // a and b straddle `limit`, so the axis delta is non-zero.
    const t = (limit - a[axis]) / (b[axis] - a[axis]);
    const cross: [number, number] = [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
    ];
    cross[axis] = limit;
    out.push(cross);
  }
  return out;
}

/**
 * Clip a footprint to `rect`. Empty when nothing survives. Concave rings are
 * fine — the clip region is convex, which is what Sutherland–Hodgman needs.
 */
export function clipRingToRect(
  ring: [number, number][],
  rect: Aabb2,
): [number, number][] {
  let out = dropClosingDuplicate(ring);
  out = clipRingToHalfPlane(out, 0, rect.minX, true);
  out = clipRingToHalfPlane(out, 0, rect.maxX, false);
  out = clipRingToHalfPlane(out, 1, rect.minZ, true);
  out = clipRingToHalfPlane(out, 1, rect.maxZ, false);
  return out.length >= 3 ? out : [];
}

/** Liang–Barsky. Null when the segment misses `rect` entirely. */
function clipSegmentToRect(
  a: [number, number],
  b: [number, number],
  rect: Aabb2,
): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  // Each boundary is `t * p <= q`.
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a[0] - rect.minX)) return null;
  if (!clip(dx, rect.maxX - a[0])) return null;
  if (!clip(-dz, a[1] - rect.minZ)) return null;
  if (!clip(dz, rect.maxZ - a[1])) return null;
  if (t1 <= t0) return null;
  return [
    [a[0] + dx * t0, a[1] + dz * t0],
    [a[0] + dx * t1, a[1] + dz * t1],
  ];
}

/**
 * Clip a polyline to `rect`, one sub-path per run that stays inside. A road
 * crossing a tile edge yields one piece per tile, meeting flush on the edge.
 */
export function clipPathToRect(
  path: [number, number][],
  rect: Aabb2,
): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run);
    run = [];
  };
  for (let i = 0; i < path.length - 1; i++) {
    const seg = clipSegmentToRect(path[i]!, path[i + 1]!, rect);
    if (!seg) {
      flush();
      continue;
    }
    const [a, b] = seg;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const last = run[run.length - 1];
    if (last && last[0] === a[0] && last[1] === a[1]) {
      run.push(b);
      continue;
    }
    flush();
    run = [a, b];
  }
  flush();
  return out;
}

export function ringAabb(ring: [number, number][]): Aabb2 {
  const aabb: Aabb2 = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const [x, z] of ring) {
    aabb.minX = Math.min(aabb.minX, x);
    aabb.maxX = Math.max(aabb.maxX, x);
    aabb.minZ = Math.min(aabb.minZ, z);
    aabb.maxZ = Math.max(aabb.maxZ, z);
  }
  return aabb;
}
