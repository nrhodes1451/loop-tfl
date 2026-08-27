"use client";

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import {
  hallsToBottomGeometry,
  hallsToLineSegments,
  stairsToBottomGeometry,
  stairsToLineSegments,
} from "@/lib/schematic/building-geom";
import {
  STAIR_COLOR,
  STAIR_DROP_M,
  STAIR_LINE_WIDTH,
  STAIR_RISERS,
  overlayGeometries,
  type EntranceOverlayFile,
} from "@/lib/schematic/entrances";
import {
  schematicEdgeColor,
  VOLUME_BOTTOM_OPACITY,
} from "@/lib/schematic/scene";
import type { LatLon } from "@/lib/schematic/geo";
import { DoubleSide } from "three";

// Same queue as VolumeMesh / GlowLine. City buildings write depth later
// (order 3); painting first lets them composite over the cages the way
// the rest of the dollhouse shows through the block.
const VOLUME_ORDER = 1;
const LINE_ORDER = 2;

function noopRaycast() {}

export function EntranceOverlay({
  origin,
  overlay,
  stationIds,
}: {
  origin: LatLon;
  overlay: EntranceOverlayFile;
  stationIds: string[];
}) {
  const { hallPts, hallBottom, stairPts, stairBottom } = useMemo(() => {
    const { halls, stairs } = overlayGeometries(overlay, origin, stationIds);
    return {
      hallPts: hallsToLineSegments(halls),
      hallBottom: hallsToBottomGeometry(halls),
      stairPts: stairsToLineSegments(stairs, STAIR_RISERS, STAIR_DROP_M),
      stairBottom: stairsToBottomGeometry(stairs, STAIR_RISERS, STAIR_DROP_M),
    };
  }, [overlay, origin, stationIds]);

  const hallColor = schematicEdgeColor("street");

  return (
    <group>
      {hallBottom ? (
        <mesh
          geometry={hallBottom}
          renderOrder={VOLUME_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={hallColor}
            transparent
            opacity={VOLUME_BOTTOM_OPACITY}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ) : null}
      {hallPts.length >= 2 ? (
        <Line
          points={hallPts}
          segments
          color={hallColor}
          lineWidth={STAIR_LINE_WIDTH}
          transparent
          opacity={0.95}
          toneMapped={false}
          frustumCulled={false}
          renderOrder={LINE_ORDER}
          depthWrite={false}
          fog={false}
          raycast={noopRaycast}
        />
      ) : null}
      {stairBottom ? (
        <mesh
          geometry={stairBottom}
          renderOrder={VOLUME_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={STAIR_COLOR}
            transparent
            opacity={VOLUME_BOTTOM_OPACITY}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ) : null}
      {stairPts.length >= 2 ? (
        <Line
          points={stairPts}
          segments
          color={STAIR_COLOR}
          lineWidth={STAIR_LINE_WIDTH}
          transparent
          opacity={0.95}
          toneMapped={false}
          frustumCulled={false}
          renderOrder={LINE_ORDER}
          depthWrite={false}
          fog={false}
          raycast={noopRaycast}
        />
      ) : null}
    </group>
  );
}
