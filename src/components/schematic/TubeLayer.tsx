"use client";

import { Line } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import { DoubleSide } from "three";
import type { LatLon } from "@/lib/schematic/geo";
import type { LineNetwork } from "@/lib/schematic/lines";
import {
  TUBE_FACE_OPACITY,
  TUBE_RENDER_ORDER,
  buildTubeMeshes,
  disposeTubeMeshes,
} from "@/lib/schematic/tubes";
import type { SceneQuality } from "@/lib/schematic/scene";

function noopRaycast() {}

export function TubeLayer({
  network,
  origin,
  quality,
}: {
  network: LineNetwork;
  origin: LatLon;
  quality: SceneQuality;
}) {
  const meshes = useMemo(
    () => buildTubeMeshes(network, origin, quality),
    [network, origin, quality],
  );

  useLayoutEffect(() => () => disposeTubeMeshes(meshes), [meshes]);

  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((mesh) => (
        <mesh
          key={`${mesh.lineId}::${mesh.track}`}
          geometry={mesh.geometry}
          renderOrder={TUBE_RENDER_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={mesh.faceColor}
            transparent
            opacity={TUBE_FACE_OPACITY}
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
            key={`${mesh.lineId}::${mesh.track}-line`}
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
