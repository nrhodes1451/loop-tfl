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
import { stitchRoads } from "./road-graph";

export const BUILDING_COLOR = "#9ec5e8";
export const BUILDING_COLOR_LOW = "#c5dff0";
export const BUILDING_COLOR_HIGH = "#6a9ec0";
export const GROUND_COLOR = "#dcf2ff";
/**
 * Park / water sit over the ground at SURFACE_OPACITY, so the source
 * hexes are a bit greener / bluer than the designed look. Lighting shifts
 * them; tweak by eye.
 */
export const LAND_COLOR = "#92d4a6";
export const WATER_COLOR = "#3d8ed0";
export const ROAD_COLOR = "#778899";
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

type Xz = { x: number; z: number };

type RibbonJoin = {
  inL: Xz;
  inR: Xz;
  outL: Xz;
  outR: Xz;
  bevel: boolean;
};

/** Max miter length as a multiple of half-width; sharper corners bevel. */
const RIBBON_MITER_LIMIT = 4;

function leftNormal(dir: Xz): Xz {
  return { x: -dir.z, z: dir.x };
}

function xzAdd(p: Xz, n: Xz, s: number): Xz {
  return { x: p.x + n.x * s, z: p.z + n.z * s };
}

function ribbonJoins(pts: Xz[], half: number): RibbonJoin[] {
  const dirs: Xz[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    dirs.push({ x: dx / len, z: dz / len });
  }
  const joins: RibbonJoin[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = i > 0 ? leftNormal(dirs[i - 1]!) : null;
    const next = i < dirs.length ? leftNormal(dirs[i]!) : null;
    if (!prev && next) {
      const l = xzAdd(p, next, half);
      const r = xzAdd(p, next, -half);
      joins.push({ inL: l, inR: r, outL: l, outR: r, bevel: false });
      continue;
    }
    if (prev && !next) {
      const l = xzAdd(p, prev, half);
      const r = xzAdd(p, prev, -half);
      joins.push({ inL: l, inR: r, outL: l, outR: r, bevel: false });
      continue;
    }
    if (!prev || !next) continue;
    const dot = prev.x * next.x + prev.z * next.z;
    const denom = 1 + dot;
    if (denom >= 1e-4) {
      const ox = ((prev.x + next.x) * half) / denom;
      const oz = ((prev.z + next.z) * half) / denom;
      if (Math.hypot(ox, oz) / half <= RIBBON_MITER_LIMIT) {
        const l = { x: p.x + ox, z: p.z + oz };
        const r = { x: p.x - ox, z: p.z - oz };
        joins.push({ inL: l, inR: r, outL: l, outR: r, bevel: false });
        continue;
      }
    }
    joins.push({
      inL: xzAdd(p, prev, half),
      inR: xzAdd(p, prev, -half),
      outL: xzAdd(p, next, half),
      outR: xzAdd(p, next, -half),
      bevel: true,
    });
  }
  return joins;
}

function ribbonScenePts(path: [number, number][]): Xz[] {
  const pts: Xz[] = [];
  for (const [east, north] of path) {
    const p = { x: -east, z: north };
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 1e-6) continue;
    pts.push(p);
  }
  return pts;
}

export function ribbonGeometry(
  path: [number, number][],
  widthM: number,
): BufferGeometry | null {
  if (path.length < 2 || widthM <= 0) return null;
  const pts = ribbonScenePts(path);
  if (pts.length < 2) return null;
  const half = widthM / 2;
  const joins = ribbonJoins(pts, half);
  if (joins.length < 2) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  const push = (p: Xz): number => {
    const i = positions.length / 3;
    positions.push(p.x, 0, p.z);
    return i;
  };
  /* Winding must face +Y. (0,1,2)/(1,3,2) on a segment quad points down. */
  const quad = (aL: Xz, aR: Xz, bL: Xz, bR: Xz) => {
    const i0 = push(aL);
    const i1 = push(aR);
    const i2 = push(bL);
    const i3 = push(bR);
    indices.push(i0, i2, i1, i1, i2, i3);
  };
  const tri = (a: Xz, b: Xz, c: Xz) => {
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const i0 = push(a);
    const i1 = push(ny >= 0 ? b : c);
    const i2 = push(ny >= 0 ? c : b);
    indices.push(i0, i1, i2);
  };

  for (let i = 0; i < joins.length - 1; i++) {
    const a = joins[i]!;
    const b = joins[i + 1]!;
    quad(a.outL, a.outR, b.inL, b.inR);
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const join = joins[i]!;
    if (!join.bevel) continue;
    const prev = { x: pts[i]!.x - pts[i - 1]!.x, z: pts[i]!.z - pts[i - 1]!.z };
    const next = { x: pts[i + 1]!.x - pts[i]!.x, z: pts[i + 1]!.z - pts[i]!.z };
    const cross = prev.x * next.z - prev.z * next.x;
    if (cross >= 0) tri(pts[i]!, join.inR, join.outR);
    else tri(pts[i]!, join.inL, join.outL);
  }

  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    normals[i * 3 + 1] = 1;
  }
  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

/**
 * Resample a polyline to `pointCount` vertices along arc length.
 */
export function resamplePolyline(
  path: [number, number][],
  pointCount: number,
): [number, number][] {
  if (path.length < 2 || pointCount < 2) return path;
  const dist = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    dist.push(total);
  }
  if (total < 1e-6) return path;
  const out: [number, number][] = [];
  for (let i = 0; i < pointCount; i++) {
    const t = (i / (pointCount - 1)) * total;
    let s = 1;
    while (s < dist.length && dist[s]! < t) s += 1;
    const i1 = Math.max(1, s);
    const i0 = i1 - 1;
    const d0 = dist[i0]!;
    const d1 = dist[i1]!;
    const span = d1 - d0;
    const u = span > 1e-9 ? (t - d0) / span : 0;
    const a = path[i0]!;
    const b = path[i1]!;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

export type StairLinePoint = [number, number, number];

function sceneXZ(east: number, north: number): [number, number] {
  return [-east, north];
}

function addSeg(
  out: StairLinePoint[],
  a: StairLinePoint,
  b: StairLinePoint,
) {
  out.push(a, b);
}

function lrAt(
  pts: [number, number][],
  i: number,
  half: number,
): { left: [number, number]; right: [number, number] } {
  const last = pts.length - 1;
  let dx: number;
  let dz: number;
  if (i <= 0) {
    dx = pts[1]![0] - pts[0]![0];
    dz = pts[1]![1] - pts[0]![1];
  } else if (i >= last) {
    dx = pts[last]![0] - pts[last - 1]![0];
    dz = pts[last]![1] - pts[last - 1]![1];
  } else {
    const ax = pts[i]![0] - pts[i - 1]![0];
    const az = pts[i]![1] - pts[i - 1]![1];
    const bx = pts[i + 1]![0] - pts[i]![0];
    const bz = pts[i + 1]![1] - pts[i]![1];
    const al = Math.hypot(ax, az) || 1;
    const bl = Math.hypot(bx, bz) || 1;
    dx = ax / al + bx / bl;
    dz = az / al + bz / bl;
  }
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * half;
  const pz = (dx / len) * half;
  const p = pts[i]!;
  return {
    left: [p[0] + px, p[1] + pz],
    right: [p[0] - px, p[1] - pz],
  };
}

function flightCageEdges(
  pts: [number, number][],
  yTop: number,
  yBot: number,
  risers: number,
  half: number,
  includeFloor: boolean,
): StairLinePoint[] {
  if (pts.length < 2 || risers < 1) return [];
  const n = risers;
  const drop = yBot - yTop;
  if (Math.abs(drop) < 1e-6) return [];
  const yAt = (i: number) => yTop + (drop * i) / n;
  const corners = pts.map((_, i) => lrAt(pts, i, half));
  const out: StairLinePoint[] = [];
  const L = (i: number, y: number): StairLinePoint => [
    corners[i]!.left[0],
    y,
    corners[i]!.left[1],
  ];
  const R = (i: number, y: number): StairLinePoint => [
    corners[i]!.right[0],
    y,
    corners[i]!.right[1],
  ];

  for (let i = 0; i < n; i++) {
    const y = yAt(i);
    addSeg(out, L(i, y), L(i + 1, y));
    addSeg(out, R(i, y), R(i + 1, y));
  }
  addSeg(out, L(0, yTop), R(0, yTop));
  addSeg(out, L(0, yBot), R(0, yBot));
  for (let i = 1; i < n; i++) {
    addSeg(out, L(i, yAt(i - 1)), R(i, yAt(i - 1)));
    addSeg(out, L(i, yAt(i)), R(i, yAt(i)));
  }
  addSeg(out, L(n, yAt(n - 1)), R(n, yAt(n - 1)));
  addSeg(out, L(n, yBot), R(n, yBot));
  for (let i = 1; i <= n; i++) {
    addSeg(out, L(i, yAt(i - 1)), L(i, yAt(i)));
    addSeg(out, R(i, yAt(i - 1)), R(i, yAt(i)));
  }
  addSeg(out, L(0, yTop), L(0, yBot));
  addSeg(out, R(0, yTop), R(0, yBot));
  if (includeFloor) {
    for (let i = 0; i < n; i++) {
      addSeg(out, L(i, yBot), L(i + 1, yBot));
      addSeg(out, R(i, yBot), R(i + 1, yBot));
    }
  }
  return out;
}

/**
 * Outer cage of a staircase (treads, risers, stringers, floor).
 * `path[0]` is street (Y=0). Returns `[a, b, c, d, …]` for `<Line segments>`.
 */
export function stairFlightEdges(
  path: [number, number][],
  widthM: number,
  risers: number,
  dropM: number,
): StairLinePoint[] {
  if (path.length < 2 || widthM <= 0 || risers < 1 || dropM <= 0) return [];
  const samples = resamplePolyline(path, risers + 1);
  const pts = samples.map(([e, n]) => sceneXZ(e, n));
  if (pts.length < 2) return [];
  return flightCageEdges(pts, 0, -dropM, risers, widthM / 2, true);
}

/**
 * Stair-style cage between two schematic points `[x, localY, z]`.
 * Treads are horizontal; no floor ribbon (long runs would slab the station).
 */
export function inclinedFlightEdges(
  from: StairLinePoint,
  to: StairLinePoint,
  width: number,
  risers: number,
): StairLinePoint[] {
  if (width <= 0 || risers < 1) return [];
  const top = from[1] >= to[1] ? from : to;
  const bot = from[1] >= to[1] ? to : from;
  const path: [number, number][] = [
    [top[0], top[2]],
    [bot[0], bot[2]],
  ];
  const samples = resamplePolyline(path, risers + 1);
  if (samples.length < 2) return [];
  return flightCageEdges(
    samples,
    top[1],
    bot[1],
    risers,
    width / 2,
    false,
  );
}

export function stairsToLineSegments(
  lines: { path: [number, number][]; widthM: number }[],
  risers: number,
  dropM: number,
): StairLinePoint[] {
  const out: StairLinePoint[] = [];
  for (const line of lines) {
    out.push(...stairFlightEdges(line.path, line.widthM, risers, dropM));
  }
  return out;
}

export function stairFlightBottomGeometry(
  path: [number, number][],
  widthM: number,
  risers: number,
  dropM: number,
): BufferGeometry | null {
  if (path.length < 2 || widthM <= 0 || dropM < 0) return null;
  const samples = resamplePolyline(path, Math.max(2, risers + 1));
  const geom = ribbonGeometry(samples, widthM);
  if (!geom) return null;
  geom.translate(0, -dropM, 0);
  return geom;
}

export function stairsToBottomGeometry(
  lines: { path: [number, number][]; widthM: number }[],
  risers: number,
  dropM: number,
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const line of lines) {
    const geom = stairFlightBottomGeometry(
      line.path,
      line.widthM,
      risers,
      dropM,
    );
    if (geom) geoms.push(geom);
  }
  return mergeGeomBatch(geoms);
}

/**
 * Wire prism of an OSM hall: footprint at Y=0, roof at `height`, verticals.
 * Ring is ENU [east, north], same frame as `polygonGeometry`.
 */
export function hallPrismEdges(
  ring: [number, number][],
  height: number,
): StairLinePoint[] {
  const open = simplifyRing(ring, MIN_RING_EDGE_M);
  if (open.length < 3 || height <= 0) return [];
  const xz = open.map(([e, n]) => sceneXZ(e, n));
  const n = xz.length;
  const out: StairLinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = xz[i]!;
    const b = xz[j]!;
    addSeg(out, [a[0], 0, a[1]], [b[0], 0, b[1]]);
    addSeg(out, [a[0], height, a[1]], [b[0], height, b[1]]);
    addSeg(out, [a[0], 0, a[1]], [a[0], height, a[1]]);
  }
  return out;
}

export function hallsToLineSegments(
  halls: { ring: [number, number][]; height: number }[],
): StairLinePoint[] {
  const out: StairLinePoint[] = [];
  for (const hall of halls) {
    out.push(...hallPrismEdges(hall.ring, hall.height));
  }
  return out;
}

export function hallsToBottomGeometry(
  halls: { ring: [number, number][]; height: number }[],
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const hall of halls) {
    const ring = simplifyRing(hall.ring, MIN_RING_EDGE_M);
    if (ring.length < 3) continue;
    geoms.push(polygonGeometry(ring));
  }
  return mergeGeomBatch(geoms);
}

/** Invisible prism used to pick a hall cage. */
export function hallPickGeometry(
  ring: [number, number][],
  height: number,
): BufferGeometry | null {
  const open = simplifyRing(ring, MIN_RING_EDGE_M);
  if (open.length < 3 || height <= 0) return null;
  return buildingGeometry(open, height);
}

/** Invisible AABB covering a stair flight, for pointer hits. */
export function stairFlightPickGeometry(
  path: [number, number][],
  widthM: number,
  dropM: number,
): BufferGeometry | null {
  if (path.length < 2 || widthM <= 0 || dropM <= 0) return null;
  const samples = resamplePolyline(path, Math.max(2, path.length));
  const pts = samples.map(([e, n]) => sceneXZ(e, n));
  if (pts.length < 2) return null;
  const half = widthM / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const c = lrAt(pts, i, half);
    for (const p of [c.left, c.right]) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
  }
  const sx = Math.max(maxX - minX, 0.2);
  const sz = Math.max(maxZ - minZ, 0.2);
  const geom = new BoxGeometry(sx, dropM, sz);
  geom.translate((minX + maxX) / 2, -dropM / 2, (minZ + maxZ) / 2);
  return geom;
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

export function wedgesToGeometry(
  wedges: { node: [number, number]; a: [number, number]; b: [number, number] }[],
): BufferGeometry | null {
  if (wedges.length === 0) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const push = (e: number, n: number): number => {
    const i = positions.length / 3;
    positions.push(-e, 0, n);
    return i;
  };
  for (const w of wedges) {
    const i0 = push(w.node[0], w.node[1]);
    const sx0 = -w.node[0];
    const sz0 = w.node[1];
    const sx1 = -w.a[0];
    const sz1 = w.a[1];
    const sx2 = -w.b[0];
    const sz2 = w.b[1];
    const ny = (sz1 - sz0) * (sx2 - sx0) - (sx1 - sx0) * (sz2 - sz0);
    const i1 = push(ny >= 0 ? w.a[0] : w.b[0], ny >= 0 ? w.a[1] : w.b[1]);
    const i2 = push(ny >= 0 ? w.b[0] : w.a[0], ny >= 0 ? w.b[1] : w.a[1]);
    indices.push(i0, i1, i2);
  }
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
  const geom = new BufferGeometry();
  geom.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

export function roadsToGeometry(
  roads: { path: [number, number][]; kind: string }[],
): BufferGeometry | null {
  const { ways, wedges } = stitchRoads(
    roads.map((r) => ({
      path: r.path,
      widthM: roadWidthM(r.kind),
    })),
  );
  const geoms: BufferGeometry[] = [];
  for (const way of ways) {
    const geom = ribbonGeometry(way.path, way.widthM);
    if (geom) geoms.push(geom);
  }
  const extra = wedgesToGeometry(wedges);
  if (extra) geoms.push(extra);
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

export type TileGeomFeatures = {
  land: { ring: [number, number][] }[];
  water: { ring: [number, number][] }[];
  waterways: { path: [number, number][] }[];
  roads: { path: [number, number][]; kind: string }[];
  buildings: { ring: [number, number][]; height: number; minHeight?: number }[];
};

export function emptyTileGeom(): SurfaceTileGeom {
  return { land: null, water: null, roads: null, buildings: null };
}

export function tileWaterGeometry(features: TileGeomFeatures): BufferGeometry | null {
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
  return mergeGeomBatch(waterParts);
}

/** Land + water only — first paint of a tile while roads/buildings catch up. */
export function featuresToFlatGeom(features: TileGeomFeatures): SurfaceTileGeom {
  return {
    land: polygonsToGeometry(features.land),
    water: tileWaterGeometry(features),
    roads: null,
    buildings: null,
  };
}

export function featuresToTileGeom(features: TileGeomFeatures): SurfaceTileGeom {
  return {
    land: polygonsToGeometry(features.land),
    water: tileWaterGeometry(features),
    roads: roadsToGeometry(features.roads),
    buildings: buildingsToGeometry(features.buildings),
  };
}

export function disposeSurfaceTile(geom: SurfaceTileGeom | null | undefined) {
  geom?.land?.dispose();
  geom?.water?.dispose();
  geom?.roads?.dispose();
  geom?.buildings?.dispose();
}