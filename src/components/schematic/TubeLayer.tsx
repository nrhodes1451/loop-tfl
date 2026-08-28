"use client";

import { Line } from "@react-three/drei";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DoubleSide, type BufferGeometry } from "three";
import type { LatLon } from "@/lib/schematic/geo";
import type { LineNetwork } from "@/lib/schematic/lines";
import {
  TUBE_FACE_OPACITY,
  TUBE_RENDER_ORDER,
  buildTubeMeshesChunked,
  disposeGeometries,
  disposeTubeMeshes,
  type TubeMesh,
} from "@/lib/schematic/tubes";
import type { SceneQuality } from "@/lib/schematic/scene";

function noopRaycast() {}

function tubeCacheKey(
  network: LineNetwork,
  origin: LatLon,
  quality: SceneQuality,
): string {
  return `${network.generatedAt}\0${origin.lat}\0${origin.lon}\0${quality}`;
}

const tubeMeshCache = new Map<string, TubeMesh[]>();

function evictTubeCacheExcept(keep: string) {
  for (const [k, meshes] of tubeMeshCache) {
    if (k !== keep) {
      disposeTubeMeshes(meshes);
      tubeMeshCache.delete(k);
    }
  }
}

export function TubeLayer({
  network,
  origin,
  quality,
}: {
  network: LineNetwork;
  origin: LatLon;
  quality: SceneQuality;
}) {
  const key = tubeCacheKey(network, origin, quality);
  const [meshes, setMeshes] = useState<TubeMesh[]>(
    () => tubeMeshCache.get(key) ?? [],
  );
  const leftoversRef = useRef<BufferGeometry[]>([]);

  useLayoutEffect(() => {
    const extra = leftoversRef.current;
    leftoversRef.current = [];
    if (extra.length > 0) disposeGeometries(extra);
  }, [meshes]);

  useEffect(() => {
    const hit = tubeMeshCache.get(key);
    if (hit) {
      setMeshes(hit);
      return;
    }
    setMeshes([]);
    const ac = new AbortController();
    void (async () => {
      const built = await buildTubeMeshesChunked(network, origin, quality, {
        signal: ac.signal,
        onChunk: (partial) => {
          if (!ac.signal.aborted) setMeshes(partial);
        },
      });
      if (ac.signal.aborted) {
        if (built.meshes.length > 0) {
          tubeMeshCache.set(key, built.meshes);
          evictTubeCacheExcept(key);
          disposeGeometries(built.leftovers);
        }
        return;
      }
      tubeMeshCache.set(key, built.meshes);
      evictTubeCacheExcept(key);
      leftoversRef.current = built.leftovers;
      setMeshes(built.meshes);
    })();
    return () => {
      ac.abort();
    };
  }, [key, network, origin, quality]);

  if (meshes.length === 0) return null;

  return (
    <group>
      {meshes.map((mesh, i) => (
        <mesh
          key={`${mesh.lineId}::${mesh.track}::${i}`}
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
          />
        </mesh>
      ))}
      {meshes.map((mesh, i) =>
        mesh.centreline.length >= 2 ? (
          <Line
            key={`${mesh.lineId}::${mesh.track}-line::${i}`}
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
            raycast={noopRaycast}
          />
        ) : null,
      )}
    </group>
  );
}
