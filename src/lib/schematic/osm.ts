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
