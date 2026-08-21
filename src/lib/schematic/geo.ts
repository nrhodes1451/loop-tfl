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
/** Orbit ceiling when the London PMTiles surface is active. */
export const CITY_MAX_DISTANCE_M = 25_000;
export const CITY_FAR_M = 80_000;
/** Fetch radius for in-situ neighbor dollhouses (orbit-target, metres). */
export const NEIGHBOR_LOAD_RADIUS_M = 800;
/** Keep cached neighbors until they leave this radius (hysteresis). */
export const NEIGHBOR_UNLOAD_RADIUS_M = 1_100;
/**
 * Camera–target distance at or below which dollhouses mount.
 * Matches tile z15 (`zoomForDistance` is 15 only when dist ≤ 2000).
 */
export const STATION_SHOW_DIST_M = 1_750;
/** Hide all dollhouses once the camera is this far (zoom hysteresis). */
export const STATION_HIDE_DIST_M = 1_700;
/** How often to sample orbit target / distance, same as PMTiles tiles. */
export const STATION_LOD_SAMPLE_MS = 120;
export const STATION_LOD_MOVE_M = 40;
export const STATION_LOD_DIST_STEP_M = 50;

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

/**
 * Scene metres matching extruded OSM: Three +X is west, +Z is north.
 * `buildingGeometry` negates east; PMTiles camera sampling undoes the same flip.
 */
export function latLonToWorld(
  lat: number,
  lon: number,
  origin: LatLon,
): { x: number; z: number } {
  const enu = latLonToEnu(lat, lon, origin);
  return { x: -enu.x, z: enu.z };
}

export function worldToLatLon(
  x: number,
  z: number,
  origin: LatLon,
): LatLon {
  return enuToLatLon(-x, z, origin);
}

/** Planar distance in metres (local tangent at `b`). */
export function distanceM(a: LatLon, b: LatLon): number {
  const p = latLonToEnu(a.lat, a.lon, b);
  return Math.hypot(p.x, p.z);
}

/**
 * HUBKGX stays on the TfL StopPoint origin (scene origin).
 * Other stations plant at their schematic / index lat/lon.
 */
export function schematicWorldOffset(
  stationId: string,
  lat: number,
  lon: number,
  origin: LatLon = HUBKGX_ORIGIN,
): { x: number; z: number } {
  if (stationId === "HUBKGX") return { x: 0, z: 0 };
  return latLonToWorld(lat, lon, origin);
}

export function schematicPlacementLatLon(
  stationId: string,
  entrance: LatLon,
): LatLon {
  if (stationId === "HUBKGX") return HUBKGX_ORIGIN;
  return entrance;
}

/**
 * Hysteresis around STATION_SHOW_DIST / STATION_HIDE_DIST so rocking
 * across 2 km does not pop every dollhouse.
 */
export function stationsShownAtDistance(
  distM: number,
  currentlyShown: boolean,
): boolean {
  if (!Number.isFinite(distM) || distM < 0) return false;
  if (currentlyShown) return distM <= STATION_HIDE_DIST_M;
  return distM <= STATION_SHOW_DIST_M;
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

/** Same as `placeSchematic`, then translate so the street centroid sits on `world`. */
export function placeSchematicAt(
  geom: SceneGeometry,
  world: { x: number; z: number },
  scale: number = SCHEMATIC_METRES_PER_UNIT,
): SchematicPlacement {
  const local = placeSchematic(geom, scale);
  const position: Vec3 = [
    local.position[0] + world.x,
    local.position[1],
    local.position[2] + world.z,
  ];
  const min: Vec3 = [
    local.bounds.min[0] + world.x,
    local.bounds.min[1],
    local.bounds.min[2] + world.z,
  ];
  const max: Vec3 = [
    local.bounds.max[0] + world.x,
    local.bounds.max[1],
    local.bounds.max[2] + world.z,
  ];
  return {
    scale: local.scale,
    position,
    bounds: makeBounds(min, max),
    streetAabb: {
      minX: local.streetAabb.minX + world.x,
      maxX: local.streetAabb.maxX + world.x,
      minZ: local.streetAabb.minZ + world.z,
      maxZ: local.streetAabb.maxZ + world.z,
    },
    cutout: {
      minX: local.cutout.minX + world.x,
      maxX: local.cutout.maxX + world.x,
      minZ: local.cutout.minZ + world.z,
      maxZ: local.cutout.maxZ + world.z,
    },
  };
}

export function aabbIntersects(a: Aabb2, b: Aabb2): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}
