/**
 * Shared Three.js extrusion for OSM-style building rings.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MIN_RING_EDGE_M, simplifyRing } from "./osm";

export const BUILDING_COLOR = "#9ec5e8";
export const BUILDING_COLOR_LOW = "#c5dff0";
export const BUILDING_COLOR_HIGH = "#6a9ec0";
export const GROUND_COLOR = "#cceeff";
/**
 * Park / water sit over the cyan ground at SURFACE_OPACITY, so the source
 * hexes are a bit greener / bluer than the designed look. Lighting shifts
 * them; tweak by eye.
 */
export const LAND_COLOR = "#92d4a6";
export const WATER_COLOR = "#3d8ed0";
export const ROAD_COLOR = "#b0c4d2";
export const SURFACE_OPACITY = 0.7;

export const SURFACE_ORDER = {
  ground: -1,
  land: 0,
  water: 1,
  roads: 2,
  buildings: 3,
} as const;

export const ROAD_WIDTH_M = {
  highway: 22,
  major_road: 14,
  rail: 8,
} as const;

export const WATERWAY_WIDTH_M = 10;

/** Sky / ground colours for the outdoor hemisphere fill. */
export const SURFACE_SKY = "#eef3f7";
export const SURFACE_HEMI_GROUND = "#5a6b78";
export const SURFACE_HEMI_INTENSITY = 0.8;
export const SURFACE_SUN_INTENSITY = 0.5;
export const SURFACE_SUN_POSITION = [140, 220, 90] as const;

const LAMBERT_DOT_NL =
  "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );";
const WRAP_LAMBERT_DOT_NL =
  "float dotNL = saturate( 0.5 * dot( geometryNormal, directLight.direction ) + 0.5 );";

/**
 * Half-Lambert (wrap) so a directional light has mid-tones instead of a
 * hard lit / unlit cliff on each prism face.
 */
export function wrapLambertFragment(fragmentShader: string): string {
  if (!fragmentShader.includes(LAMBERT_DOT_NL)) return fragmentShader;
  return fragmentShader.replace(LAMBERT_DOT_NL, WRAP_LAMBERT_DOT_NL);
}

export function wrapLambertCompile(shader: { fragmentShader: string }) {
  shader.fragmentShader = wrapLambertFragment(shader.fragmentShader);
}

export function wrapLambertCacheKey() {
  return "wrapLambert";
}

const EXTRUDE = {
  bevelEnabled: false,
  steps: 1,
  curveSegments: 1,
} as const;

/** Floor for `height - minHeight` so a degenerate slab still has faces. */
export const MIN_BUILDING_EXTRUDE_M = 0.05;

function parseHexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function buildingColorForHeight(heightM: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (heightM - 10) / 70));
  const a = parseHexRgb(BUILDING_COLOR_LOW);
  const b = parseHexRgb(BUILDING_COLOR_HIGH);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function paintGeometry(geom: BufferGeometry, rgb: [number, number, number]) {
  const n = geom.getAttribute("position")?.count ?? 0;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  geom.setAttribute("color", new BufferAttribute(colors, 3));
}

function ringToShape(ring: [number, number][]): Shape {
  const shape = new Shape();
  const first = ring[0]!;
  // Shape (x, −z) + rotateX(−90°) maps ENU into Y-up with a reflection;
  // negate east so the street layer matches the real block (west/east).
  shape.moveTo(-first[0], -first[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!;
    shape.lineTo(-p[0], -p[1]);
  }
  shape.closePath();
  return shape;
}

export function buildingGeometry(
  ring: [number, number][],
  height: number,
  minHeight: number = 0,
): ExtrudeGeometry {
  const base = Math.max(0, minHeight);
  const depth = Math.max(height - base, MIN_BUILDING_EXTRUDE_M);
  const geom = new ExtrudeGeometry(ringToShape(ring), { ...EXTRUDE, depth });
  geom.rotateX(-Math.PI / 2);
  if (base > 0) geom.translate(0, base, 0);
  // Nothing samples a texture, and dropping uv keeps more tiles cached.
  geom.deleteAttribute("uv");
  return geom;
}

export function polygonGeometry(ring: [number, number][]): BufferGeometry {
  const geom = new ShapeGeometry(ringToShape(ring));
  geom.rotateX(-Math.PI / 2);
  geom.computeVertexNormals();
  geom.deleteAttribute("uv");
  return geom;
}

export function ribbonGeometry(
  path: [number, number][],
  widthM: number,
): BufferGeometry | null {
  if (path.length < 2 || widthM <= 0) return null;
  const half = widthM / 2;
  const maxSegs = path.length - 1;
  const positions = new Float32Array(maxSegs * 4 * 3);
  const normals = new Float32Array(maxSegs * 4 * 3);
  const indices: number[] = [];
  let v = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const ax = -a[0];
    const az = a[1];
    const bx = -b[0];
    const bz = b[1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const px = (-dz / len) * half;
    const pz = (dx / len) * half;
    const corners: [number, number, number][] = [
      [ax + px, 0, az + pz],
      [ax - px, 0, az - pz],
      [bx + px, 0, bz + pz],
      [bx - px, 0, bz - pz],
    ];
    const base = v;
    for (const c of corners) {
      const o = v * 3;
      positions[o] = c[0];
      positions[o + 1] = c[1];
      positions[o + 2] = c[2];
      normals[o] = 0;
      normals[o + 1] = 1;
      normals[o + 2] = 0;
      v += 1;
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  if (v === 0) return null;
  const geom = new BufferGeometry();
  geom.setAttribute(
    "position",
    new Float32BufferAttribute(positions.subarray(0, v * 3), 3),
  );
  geom.setAttribute(
    "normal",
    new Float32BufferAttribute(normals.subarray(0, v * 3), 3),
  );
  geom.setIndex(indices);
  return geom;
}

/**
 * Solid kerb along an ENU path (east, north). Unlike `ribbonGeometry` this
 * has outward-facing walls so a camera above the ground sees the top.
 */
export function stairRibbonGeometry(
  path: [number, number][],
  widthM: number,
  heightM: number,
): BufferGeometry | null {
  if (path.length < 2 || widthM <= 0 || heightM <= 0) return null;
  const geoms: BufferGeometry[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const ax = -a[0];
    const az = a[1];
    const bx = -b[0];
    const bz = b[1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) continue;
    const box = new BoxGeometry(widthM, heightM, len);
    box.rotateY(Math.atan2(dx, dz));
    box.translate((ax + bx) / 2, heightM / 2, (az + bz) / 2);
    box.deleteAttribute("uv");
    geoms.push(box);
  }
  return mergeGeomBatch(geoms);
}

export function stairsToGeometry(
  lines: { path: [number, number][]; widthM: number }[],
  heightM: number,
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const line of lines) {
    const geom = stairRibbonGeometry(line.path, line.widthM, heightM);
    if (geom) geoms.push(geom);
  }
  return mergeGeomBatch(geoms);
}

export function roadWidthM(kind: string): number {
  if (kind === "highway") return ROAD_WIDTH_M.highway;
  if (kind === "major_road") return ROAD_WIDTH_M.major_road;
  if (kind === "rail") return ROAD_WIDTH_M.rail;
  return ROAD_WIDTH_M.major_road;
}

export function groundGeometry(sizeM: number): PlaneGeometry {
  const geom = new PlaneGeometry(sizeM, sizeM);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

export function mergeGeomBatch(geoms: BufferGeometry[]): BufferGeometry | null {
  if (geoms.length === 0) return null;
  if (geoms.length === 1) return geoms[0]!;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

export function mergeBuildingBatch(
  geoms: ExtrudeGeometry[],
): BufferGeometry | null {
  return mergeGeomBatch(geoms);
}

export function buildingsToGeometry(
  buildings: { ring: [number, number][]; height: number; minHeight?: number }[],
): BufferGeometry | null {
  const geoms: ExtrudeGeometry[] = [];
  for (const b of buildings) {
    const ring = simplifyRing(b.ring, MIN_RING_EDGE_M);
    if (ring.length < 3) continue;
    const geom = buildingGeometry(ring, b.height, b.minHeight ?? 0);
    paintGeometry(geom, buildingColorForHeight(b.height));
    geoms.push(geom);
  }
  return mergeGeomBatch(geoms);
}

export function polygonsToGeometry(
  areas: { ring: [number, number][] }[],
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const a of areas) {
    const ring = simplifyRing(a.ring, MIN_RING_EDGE_M);
    if (ring.length < 3) continue;
    geoms.push(polygonGeometry(ring));
  }
  return mergeGeomBatch(geoms);
}

export function ribbonsToGeometry(
  lines: { path: [number, number][]; widthM: number }[],
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const line of lines) {
    const path = simplifyRing(line.path, MIN_RING_EDGE_M);
    if (path.length < 2) continue;
    const geom = ribbonGeometry(path, line.widthM);
    if (geom) geoms.push(geom);
  }
  return mergeGeomBatch(geoms);
}

export type SurfaceTileGeom = {
  land: BufferGeometry | null;
  water: BufferGeometry | null;
  roads: BufferGeometry | null;
  buildings: BufferGeometry | null;
};

export function featuresToTileGeom(features: {
  land: { ring: [number, number][] }[];
  water: { ring: [number, number][] }[];
  waterways: { path: [number, number][] }[];
  roads: { path: [number, number][]; kind: string }[];
  buildings: { ring: [number, number][]; height: number; minHeight?: number }[];
}): SurfaceTileGeom {
  const waterPolys = polygonsToGeometry(features.water);
  const waterLines = ribbonsToGeometry(
    features.waterways.map((w) => ({
      path: w.path,
      widthM: WATERWAY_WIDTH_M,
    })),
  );
  const waterParts = [waterPolys, waterLines].filter(
    (g): g is BufferGeometry => g != null,
  );
  return {
    land: polygonsToGeometry(features.land),
    water: mergeGeomBatch(waterParts),
    roads: ribbonsToGeometry(
      features.roads.map((r) => ({
        path: r.path,
        widthM: roadWidthM(r.kind),
      })),
    ),
    buildings: buildingsToGeometry(features.buildings),
  };
}

export function disposeSurfaceTile(geom: SurfaceTileGeom | null | undefined) {
  geom?.land?.dispose();
  geom?.water?.dispose();
  geom?.roads?.dispose();
  geom?.buildings?.dispose();
}