"use client";

import { useMemo } from "react";
import {
  buildingGeometry,
  mergeGeomBatch,
  stairsToGeometry,
  SURFACE_ORDER,
  wrapLambertCacheKey,
  wrapLambertCompile,
} from "@/lib/schematic/building-geom";
import {
  STAIR_COLOR,
  STAIR_HEIGHT_M,
  STAIR_Y_M,
  overlayGeometries,
  type EntranceOverlayFile,
} from "@/lib/schematic/entrances";
import { MIN_RING_EDGE_M, simplifyRing } from "@/lib/schematic/osm";
import { schematicEdgeColor } from "@/lib/schematic/scene";
import type { LatLon } from "@/lib/schematic/geo";
import { DoubleSide, type BufferGeometry } from "three";

const HALL_OPACITY = 0.55;
const HALL_ORDER = SURFACE_ORDER.buildings + 1;
const STAIR_ORDER = SURFACE_ORDER.buildings + 2;

function noopRaycast() {}

function hallsToGeometry(
  halls: { ring: [number, number][]; height: number }[],
): BufferGeometry | null {
  const geoms: BufferGeometry[] = [];
  for (const hall of halls) {
    const ring = simplifyRing(hall.ring, MIN_RING_EDGE_M);
    if (ring.length < 3) continue;
    geoms.push(buildingGeometry(ring, hall.height, 0));
  }
  return mergeGeomBatch(geoms);
}

export function EntranceOverlay({
  origin,
  overlay,
  stationIds,
}: {
  origin: LatLon;
  overlay: EntranceOverlayFile;
  stationIds: string[];
}) {
  const { hallGeom, stairGeom } = useMemo(() => {
    const { halls, stairs } = overlayGeometries(overlay, origin, stationIds);
    return {
      hallGeom: hallsToGeometry(halls),
      stairGeom: stairsToGeometry(stairs, STAIR_HEIGHT_M),
    };
  }, [overlay, origin, stationIds]);

  const hallColor = schematicEdgeColor("street");

  return (
    <group>
      {hallGeom ? (
        <mesh geometry={hallGeom} renderOrder={HALL_ORDER} raycast={noopRaycast}>
          <meshLambertMaterial
            color={hallColor}
            transparent
            opacity={HALL_OPACITY}
            depthWrite
            onBeforeCompile={wrapLambertCompile}
            customProgramCacheKey={wrapLambertCacheKey}
          />
        </mesh>
      ) : null}
      {stairGeom ? (
        <mesh
          geometry={stairGeom}
          position={[0, STAIR_Y_M, 0]}
          renderOrder={STAIR_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={STAIR_COLOR}
            side={DoubleSide}
            toneMapped={false}
            fog
          />
        </mesh>
      ) : null}
    </group>
  );
}
