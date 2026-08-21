"use client";

import { useLayoutEffect, useMemo } from "react";
import {
  BUILDING_COLOR,
  GROUND_COLOR,
  SURFACE_HEMI_GROUND,
  SURFACE_HEMI_INTENSITY,
  SURFACE_OPACITY,
  SURFACE_SKY,
  SURFACE_SUN_INTENSITY,
  SURFACE_SUN_POSITION,
  buildingsToGeometry,
  groundGeometry,
  wrapLambertCacheKey,
  wrapLambertCompile,
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
      <hemisphereLight
        color={SURFACE_SKY}
        groundColor={SURFACE_HEMI_GROUND}
        intensity={SURFACE_HEMI_INTENSITY}
      />
      <directionalLight
        position={SURFACE_SUN_POSITION}
        intensity={SURFACE_SUN_INTENSITY}
      />
      {/* Ground before buildings regardless of transparent depth sorting. */}
      <mesh geometry={ground} renderOrder={-1} raycast={noopRaycast}>
        <meshLambertMaterial
          color={GROUND_COLOR}
          transparent
          opacity={SURFACE_OPACITY}
          depthWrite={false}
          onBeforeCompile={wrapLambertCompile}
          customProgramCacheKey={wrapLambertCacheKey}
        />
      </mesh>
      {buildings ? (
        <mesh geometry={buildings} raycast={noopRaycast}>
          <meshLambertMaterial
            color={BUILDING_COLOR}
            transparent
            opacity={SURFACE_OPACITY}
            depthWrite={false}
            onBeforeCompile={wrapLambertCompile}
            customProgramCacheKey={wrapLambertCacheKey}
          />
        </mesh>
      ) : null}
    </group>
  );
}
