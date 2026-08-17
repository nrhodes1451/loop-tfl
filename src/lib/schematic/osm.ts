/**
 * OSM building footprints for the schematic surface layer.
 * Isolated from routing — do not import plan/status/topology.
 */

import { latLonToEnu, type Aabb2, type LatLon } from "./geo";

export const DEFAULT_BUILDING_HEIGHT_M = 10;
export const METRES_PER_LEVEL = 3;

export type OsmBuilding = {
  id: string;
  height: number;
  /** ENU metres, [east, north]. */
  ring: [number, number][];
};

export type OsmSurface = {
  stationId: string;
  origin: { lat: number; lon: number; source: string };
  sizeM: number;
  fetchedAt: string;
  attribution: string;
  buildings: OsmBuilding[];
};

export type OverpassElement = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

export type OverpassResponse = {
  elements?: OverpassElement[];
};

export function parseBuildingHeight(
  tags: Record<string, string> | undefined,
): number {
  const raw = tags?.height ?? tags?.["building:height"];
  if (raw) {
    const n = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const levels = tags?.["building:levels"];
  if (levels) {
    const n = Number.parseFloat(levels.replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n * METRES_PER_LEVEL;
  }
  return DEFAULT_BUILDING_HEIGHT_M;
}

function dropClosingDuplicate(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

type Edge = {
  inside: (p: [number, number]) => boolean;
  intersect: (a: [number, number], b: [number, number]) => [number, number];
};

function clipAgainst(ring: [number, number][], edge: Edge): [number, number][] {
  if (ring.length === 0) return [];
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i]!;
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    const curIn = edge.inside(cur);
    const prevIn = edge.inside(prev);
    if (curIn) {
      if (!prevIn) out.push(edge.intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(edge.intersect(prev, cur));
    }
  }
  return out;
}

/** Axis-aligned square clip, origin-centred, half-extent `half` metres. */
export function clipRingToBox(
  ring: [number, number][],
  half: number,
): [number, number][] {
  const open = dropClosingDuplicate(ring);
  if (open.length < 3) return [];
  const edges: Edge[] = [
    {
      inside: (p) => p[0] >= -half,
      intersect: (a, b) => {
        const t = (-half - a[0]) / (b[0] - a[0] || 1e-12);
        return [-half, a[1] + t * (b[1] - a[1])];
      },
    },
    {
      inside: (p) => p[0] <= half,
      intersect: (a, b) => {
        const t = (half - a[0]) / (b[0] - a[0] || 1e-12);
        return [half, a[1] + t * (b[1] - a[1])];
      },
    },
    {
      inside: (p) => p[1] >= -half,
      intersect: (a, b) => {
        const t = (-half - a[1]) / (b[1] - a[1] || 1e-12);
        return [a[0] + t * (b[0] - a[0]), -half];
      },
    },
    {
      inside: (p) => p[1] <= half,
      intersect: (a, b) => {
        const t = (half - a[1]) / (b[1] - a[1] || 1e-12);
        return [a[0] + t * (b[0] - a[0]), half];
      },
    },
  ];
  let clipped = open;
  for (const edge of edges) clipped = clipAgainst(clipped, edge);
  return clipped.length >= 3 ? clipped : [];
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

export function buildingsFromOverpass(
  elements: OverpassElement[],
  origin: LatLon,
  sizeM: number,
): OsmBuilding[] {
  const half = sizeM / 2;
  const out: OsmBuilding[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const tags = el.tags ?? {};
    if (!tags.building || tags.building === "no") continue;
    const ring: [number, number][] = [];
    for (const g of el.geometry) {
      const p = latLonToEnu(g.lat, g.lon, origin);
      ring.push([p.x, p.z]);
    }
    const clipped = clipRingToBox(ring, half);
    if (clipped.length < 3) continue;
    out.push({
      id: `way/${el.id}`,
      height: parseBuildingHeight(tags),
      ring: clipped,
    });
  }
  return out;
}

export function overpassBbox(
  origin: LatLon,
  sizeM: number,
): { south: number; west: number; north: number; east: number } {
  const half = sizeM / 2;
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const dLat = half / mLat;
  const dLon = half / mLon;
  return {
    south: origin.lat - dLat,
    west: origin.lon - dLon,
    north: origin.lat + dLat,
    east: origin.lon + dLon,
  };
}
