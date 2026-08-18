"use client";

import { useLayoutEffect, useMemo } from "react";
import { DoubleSide } from "three";
import {
  BUILDING_COLOR,
  GROUND_COLOR,
  SURFACE_OPACITY,
  buildingsToGeometry,
  groundGeometry,
} from "@/lib/schematic/building-geom";
import type { OsmSurface } from "@/lib/schematic/osm";

function noopRaycast() {}

export function SurfaceLayer({ surface }: { surface: OsmSurface }) {
  const ground = useMemo(
    () => groundGeometry(surface.sizeM),
    [surface.sizeM],
  );
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const buildings = useMemo(
    () => buildingsToGeometry(surface.buildings),
    [surface.buildings],
  );

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
