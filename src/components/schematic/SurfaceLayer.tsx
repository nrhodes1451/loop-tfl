"use client";

import { useLayoutEffect, useMemo } from "react";
import {
  DoubleSide,
  ExtrudeGeometry,
  Path,
  Shape,
} from "three";
import { aabbIntersects, type Aabb2, type SchematicPlacement } from "@/lib/schematic/geo";
import { ringAabb, type OsmBuilding, type OsmSurface } from "@/lib/schematic/osm";

const BUILDING_COLOR = "#8a929c";
const GROUND_COLOR = "#14171c";
const OVERLAP_OPACITY = 0.2;

function noopRaycast() {}

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
  const geom = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  });
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

  const geom = new ExtrudeGeometry(shape, {
    depth: 0.08,
    bevelEnabled: false,
    steps: 1,
  });
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, -0.04, 0);
  return geom;
}

function schematicAabb(placement: SchematicPlacement): Aabb2 {
  return {
    minX: placement.bounds.min[0],
    maxX: placement.bounds.max[0],
    minZ: placement.bounds.min[2],
    maxZ: placement.bounds.max[2],
  };
}

/** Building meshes are drawn at (−east, north); AABBs in the JSON are (east, north). */
function renderedBuildingAabb(ring: [number, number][]): Aabb2 {
  const a = ringAabb(ring);
  return { minX: -a.maxX, maxX: -a.minX, minZ: a.minZ, maxZ: a.maxZ };
}

function BuildingMesh({
  building,
  faded,
}: {
  building: OsmBuilding;
  faded: boolean;
}) {
  const geom = useMemo(
    () => buildingGeometry(building.ring, building.height),
    [building],
  );
  useLayoutEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} raycast={noopRaycast}>
      <meshLambertMaterial
        color={BUILDING_COLOR}
        transparent={faded}
        opacity={faded ? OVERLAP_OPACITY : 1}
        side={DoubleSide}
        depthWrite={!faded}
      />
    </mesh>
  );
}

export function SurfaceLayer({
  surface,
  placement,
}: {
  surface: OsmSurface;
  placement: SchematicPlacement;
}) {
  const hole = placement.cutout;
  const overlap = schematicAabb(placement);
  const ground = useMemo(
    () => groundGeometry(surface.sizeM, hole),
    [surface.sizeM, hole],
  );
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const fadedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of surface.buildings) {
      if (aabbIntersects(renderedBuildingAabb(b.ring), overlap)) ids.add(b.id);
    }
    return ids;
  }, [surface.buildings, overlap]);

  return (
    <group>
      <ambientLight intensity={0.42} />
      <directionalLight position={[140, 220, 90]} intensity={1.15} />
      <mesh geometry={ground} raycast={noopRaycast}>
        <meshLambertMaterial color={GROUND_COLOR} side={DoubleSide} />
      </mesh>
      {surface.buildings.map((building) => (
        <BuildingMesh
          key={building.id}
          building={building}
          faded={fadedIds.has(building.id)}
        />
      ))}
    </group>
  );
}
