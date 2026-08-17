/**
 * Local ENU frame and schematic placement on a geographic block.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  makeBounds,
  type SceneBounds,
  type SceneGeometry,
  type SceneVolume,
  type Vec3,
} from "./scene";

export const SCHEMATIC_METRES_PER_UNIT = 4;
export const SURFACE_SIZE_M = 400;
export const CUTOUT_PAD_M = 8;

/** TfL StopPoint for HUBKGX — 3D origin, not the OSM wheelchair entrance. */
export const HUBKGX_ORIGIN = {
  lat: 51.530663,
  lon: -0.123194,
  source: "tfl-stoppoint",
} as const;

export type LatLon = { lat: number; lon: number };

export type Aabb2 = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type SchematicPlacement = {
  scale: number;
  /** Applied after uniform scale (Three.js TRS: T * R * S). */
  position: Vec3;
  bounds: SceneBounds;
  streetAabb: Aabb2;
  cutout: Aabb2;
};

const M_PER_DEG_LAT = 111_320;

export function metresPerDegree(origin: LatLon): { lat: number; lon: number } {
  return {
    lat: M_PER_DEG_LAT,
    lon: M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180),
  };
}

/** East = +X, north = +Z, metres from origin. */
export function latLonToEnu(
  lat: number,
  lon: number,
  origin: LatLon,
): { x: number; z: number } {
  const m = metresPerDegree(origin);
  return {
    x: (lon - origin.lon) * m.lon,
    z: (lat - origin.lat) * m.lat,
  };
}

export function enuToLatLon(
  x: number,
  z: number,
  origin: LatLon,
): LatLon {
  const m = metresPerDegree(origin);
  return {
    lat: origin.lat + z / m.lat,
    lon: origin.lon + x / m.lon,
  };
}

export function applyPlacement(
  p: Vec3,
  scale: number,
  position: Vec3,
): Vec3 {
  return [
    p[0] * scale + position[0],
    p[1] * scale + position[1],
    p[2] * scale + position[2],
  ];
}

function expandAabb(aabb: Aabb2, x: number, z: number) {
  aabb.minX = Math.min(aabb.minX, x);
  aabb.maxX = Math.max(aabb.maxX, x);
  aabb.minZ = Math.min(aabb.minZ, z);
  aabb.maxZ = Math.max(aabb.maxZ, z);
}

function volumeLocalCorners(vol: SceneVolume): Vec3[] {
  const [x, y, z] = vol.position;
  if (vol.kind === "box") {
    const hw = vol.size[0] / 2;
    const hh = vol.size[1] / 2;
    const hd = vol.size[2] / 2;
    return [
      [x - hw, y - hh, z - hd],
      [x + hw, y + hh, z + hd],
    ];
  }
  const r = vol.size[0];
  const hh = vol.size[1] / 2;
  return [
    [x - r, y - hh, z - r],
    [x + r, y + hh, z + r],
  ];
}

function volumeTopY(vol: SceneVolume): number {
  return vol.position[1] + vol.size[1] / 2;
}

/**
 * Plant schematic geometry so street-node tops sit on Y=0 at the ENU origin.
 * Schematic +Y (plan) maps to world +Z (north). No yaw.
 */
export function placeSchematic(
  geom: SceneGeometry,
  scale: number = SCHEMATIC_METRES_PER_UNIT,
): SchematicPlacement {
  const streets = geom.volumes.filter((v) => v.type === "street");
  const refs = streets.length > 0 ? streets : geom.volumes;

  let cx = 0;
  let cz = 0;
  for (const vol of refs) {
    cx += vol.position[0];
    cz += vol.position[2];
  }
  const n = Math.max(1, refs.length);
  cx /= n;
  cz /= n;

  let topY = -Infinity;
  for (const vol of refs) {
    topY = Math.max(topY, volumeTopY(vol));
  }
  if (!Number.isFinite(topY)) topY = 0;

  const position: Vec3 = [-cx * scale, -topY * scale, -cz * scale];

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const streetAabb: Aabb2 = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };

  const consider = (p: Vec3, asStreet: boolean) => {
    const w = applyPlacement(p, scale, position);
    min[0] = Math.min(min[0], w[0]);
    min[1] = Math.min(min[1], w[1]);
    min[2] = Math.min(min[2], w[2]);
    max[0] = Math.max(max[0], w[0]);
    max[1] = Math.max(max[1], w[1]);
    max[2] = Math.max(max[2], w[2]);
    if (asStreet) expandAabb(streetAabb, w[0], w[2]);
  };

  for (const vol of geom.volumes) {
    const isStreet = vol.type === "street";
    for (const c of volumeLocalCorners(vol)) consider(c, isStreet);
  }
  for (const line of geom.polylines) {
    for (const p of line.points) consider(p, false);
  }

  if (!Number.isFinite(min[0])) {
    min[0] = -1;
    min[1] = -1;
    min[2] = -1;
    max[0] = 1;
    max[1] = 1;
    max[2] = 1;
  }
  if (!Number.isFinite(streetAabb.minX)) {
    streetAabb.minX = min[0];
    streetAabb.maxX = max[0];
    streetAabb.minZ = min[2];
    streetAabb.maxZ = max[2];
  }

  const half = SURFACE_SIZE_M / 2;
  const cutout: Aabb2 = {
    minX: Math.max(-half, min[0] - CUTOUT_PAD_M),
    maxX: Math.min(half, max[0] + CUTOUT_PAD_M),
    minZ: Math.max(-half, min[2] - CUTOUT_PAD_M),
    maxZ: Math.min(half, max[2] + CUTOUT_PAD_M),
  };

  return {
    scale,
    position,
    bounds: makeBounds(min, max),
    streetAabb,
    cutout,
  };
}

export function aabbIntersects(a: Aabb2, b: Aabb2): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function surfaceWorldBounds(
  sizeM: number,
  maxBuildingHeight: number,
  schematic: SceneBounds,
): SceneBounds {
  const half = sizeM / 2;
  return makeBounds(
    [-half, Math.min(0, schematic.min[1]), -half],
    [half, Math.max(maxBuildingHeight, schematic.max[1]), half],
  );
}
