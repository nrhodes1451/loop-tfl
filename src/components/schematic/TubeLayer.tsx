"use client";

import { Line } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import { DoubleSide } from "three";
import type { LatLon } from "@/lib/schematic/geo";
import type { LineNetwork } from "@/lib/schematic/lines";
import {
  TUBE_RENDER_ORDER,
  buildTubeMeshes,
  disposeTubeMeshes,
} from "@/lib/schematic/tubes";
import { VOLUME_FACE_OPACITY, type SceneQuality } from "@/lib/schematic/scene";

function noopRaycast() {}

export function TubeLayer({
  network,
  origin,
  focus,
  shown,
  quality,
}: {
  network: LineNetwork;
  origin: LatLon;
  focus: LatLon;
  shown: boolean;
  quality: SceneQuality;
}) {
  const focusLat = focus.lat;
  const focusLon = focus.lon;
  const meshes = useMemo(() => {
    if (!shown) return [];
    return buildTubeMeshes(
      network,
      origin,
      { lat: focusLat, lon: focusLon },
      quality,
    );
  }, [network, origin, focusLat, focusLon, shown, quality]);

  useLayoutEffect(() => () => disposeTubeMeshes(meshes), [meshes]);

  if (!shown || meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((mesh) => (
        <mesh
          key={mesh.lineId}
          geometry={mesh.geometry}
          renderOrder={TUBE_RENDER_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={mesh.faceColor}
            transparent
            opacity={VOLUME_FACE_OPACITY}
            depthWrite={false}
            side={DoubleSide}
            toneMapped
            fog={false}
          />
        </mesh>
      ))}
      {meshes.map((mesh) =>
        mesh.centreline.length >= 2 ? (
          <Line
            key={`${mesh.lineId}-line`}
            points={mesh.centreline}
            segments
            color={mesh.edgeColor}
            lineWidth={1.15}
            transparent
            opacity={0.95}
            toneMapped={false}
            frustumCulled={false}
            renderOrder={TUBE_RENDER_ORDER + 1}
            depthWrite={false}
            fog={false}
            raycast={noopRaycast}
          />
        ) : null,
      )}
    </group>
  );
}
