"use client";

import { useLayoutEffect, useMemo } from "react";
import {
  DoubleSide,
  ExtrudeGeometry,
  Path,
  Shape,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type Aabb2, type SchematicPlacement } from "@/lib/schematic/geo";
import {
  MIN_RING_EDGE_M,
  simplifyRing,
  type OsmSurface,
} from "@/lib/schematic/osm";

const BUILDING_COLOR = "#9ec5e8";
const GROUND_COLOR = "#d0d4db";
const SURFACE_OPACITY = 0.42;

function noopRaycast() {}

const EXTRUDE = {
  bevelEnabled: false,
  steps: 1,
  curveSegments: 1,
} as const;

function buildingGeometry(ring: [number, number][], height: number): ExtrudeGeometry {
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

function groundGeometry(sizeM: number, cutout: Aabb2): ExtrudeGeometry {
  const half = sizeM / 2;
  const shape = new Shape();
  shape.moveTo(-half, half);
  shape.lineTo(half, half);
  shape.lineTo(half, -half);
  shape.lineTo(-half, -half);
  shape.closePath();

  if (cutout.maxX - cutout.minX > 0.5 && cutout.maxZ - cutout.minZ > 0.5) {
    const hole = new Path();
    hole.moveTo(cutout.minX, -cutout.minZ);
    hole.lineTo(cutout.maxX, -cutout.minZ);
    hole.lineTo(cutout.maxX, -cutout.maxZ);
    hole.lineTo(cutout.minX, -cutout.maxZ);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geom = new ExtrudeGeometry(shape, { ...EXTRUDE, depth: 0.08 });
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, -0.04, 0);
  return geom;
}

function mergeBuildingBatch(geoms: ExtrudeGeometry[]): BufferGeometry | null {
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return merged;
}

export function SurfaceLayer({
  surface,
  placement,
}: {
  surface: OsmSurface;
  placement: SchematicPlacement;
}) {
  const hole = placement.cutout;
  const ground = useMemo(
    () => groundGeometry(surface.sizeM, hole),
    [surface.sizeM, hole],
  );
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const buildings = useMemo(() => {
    const geoms: ExtrudeGeometry[] = [];
    for (const b of surface.buildings) {
      const ring = simplifyRing(b.ring, MIN_RING_EDGE_M);
      if (ring.length < 3) continue;
      geoms.push(buildingGeometry(ring, b.height));
    }
    return mergeBuildingBatch(geoms);
  }, [surface.buildings]);

  useLayoutEffect(() => () => buildings?.dispose(), [buildings]);

  return (
    <group>
      <ambientLight intensity={0.55} />
      <directionalLight position={[140, 220, 90]} intensity={0.95} />
      <mesh geometry={ground} raycast={noopRaycast}>
        <meshLambertMaterial
          color={GROUND_COLOR}
          transparent
          opacity={SURFACE_OPACITY}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      {buildings ? (
        <mesh geometry={buildings} raycast={noopRaycast}>
          <meshLambertMaterial
            color={BUILDING_COLOR}
            transparent
            opacity={SURFACE_OPACITY}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ) : null}
    </group>
  );
}
