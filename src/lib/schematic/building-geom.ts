/**
 * Shared Three.js extrusion for OSM-style building rings.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MIN_RING_EDGE_M, simplifyRing } from "./osm";

export const BUILDING_COLOR = "#9ec5e8";
export const GROUND_COLOR = "#cceeff";
export const SURFACE_OPACITY = 0.7;

const EXTRUDE = {
  bevelEnabled: false,
  steps: 1,
  curveSegments: 1,
} as const;

export function buildingGeometry(
  ring: [number, number][],
  height: number,
): ExtrudeGeometry {
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
  const geom = new ExtrudeGeometry(shape, { ...EXTRUDE, depth: height });
  geom.rotateX(-Math.PI / 2);
  return geom;
}

export function groundGeometry(sizeM: number): PlaneGeometry {
  const geom = new PlaneGeometry(sizeM, sizeM);
  geom.rotateX(-Math.PI / 2);
  return geom;
}

export function mergeBuildingBatch(
  geoms: ExtrudeGeometry[],
): BufferGeometry | null {
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

export function buildingsToGeometry(
  buildings: { ring: [number, number][]; height: number }[],
): BufferGeometry | null {
  const geoms: ExtrudeGeometry[] = [];
  for (const b of buildings) {
    const ring = simplifyRing(b.ring, MIN_RING_EDGE_M);
    if (ring.length < 3) continue;
    geoms.push(buildingGeometry(ring, b.height));
  }
  return mergeBuildingBatch(geoms);
}
