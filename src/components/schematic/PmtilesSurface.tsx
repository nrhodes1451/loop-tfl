"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, type BufferGeometry } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  BUILDING_COLOR,
  GROUND_COLOR,
  SURFACE_OPACITY,
  buildingsToGeometry,
  groundGeometry,
} from "@/lib/schematic/building-geom";
import { enuToLatLon, type LatLon } from "@/lib/schematic/geo";
import {
  fetchTileBuildings,
  tileKey,
  tilesAround,
  zoomForDistance,
  type TileCoord,
} from "@/lib/schematic/pmtiles";

/** Ground plane in ENU metres — Greater London fits with margin. */
const GROUND_SIZE_M = 50_000;
const TILE_RING = 1;
const SAMPLE_EVERY_MS = 120;

function noopRaycast() {}

function tileSetKey(tiles: TileCoord[]): string {
  return tiles.map(tileKey).join(",");
}

export function PmtilesSurface({ origin }: { origin: LatLon }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const [tiles, setTiles] = useState<TileCoord[]>([]);
  const [geoms, setGeoms] = useState<Map<string, BufferGeometry>>(
    () => new Map(),
  );
  const geomsRef = useRef(geoms);
  const lastSample = useRef(0);
  const lastKey = useRef("");
  const originRef = useRef(origin);
  useLayoutEffect(() => {
    originRef.current = origin;
  }, [origin]);

  useFrame(() => {
    const now = performance.now();
    if (now - lastSample.current < SAMPLE_EVERY_MS) return;
    lastSample.current = now;
    const target = controls?.target;
    if (!target) return;
    const dist = camera.position.distanceTo(target);
    const z = zoomForDistance(dist);
    if (z == null) {
      if (lastKey.current !== "") {
        lastKey.current = "";
        setTiles([]);
      }
      return;
    }
    // buildingGeometry negates east so Three.js +X is west; undo that for tiles.
    const ll = enuToLatLon(-target.x, target.z, originRef.current);
    const next = tilesAround(ll.lon, ll.lat, z, TILE_RING);
    const key = tileSetKey(next);
    if (key === lastKey.current) return;
    lastKey.current = key;
    setTiles(next);
  });

  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(tiles.map(tileKey));

    setGeoms((prev) => {
      const kept = new Map<string, BufferGeometry>();
      for (const [key, geom] of prev) {
        if (wanted.has(key)) kept.set(key, geom);
      }
      geomsRef.current = kept;
      return kept;
    });

    const missing = tiles.filter((t) => !geomsRef.current.has(tileKey(t)));
    if (missing.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      missing.map(async (tile) => {
        const buildings = await fetchTileBuildings(tile, originRef.current);
        return { key: tileKey(tile), geom: buildingsToGeometry(buildings) };
      }),
    ).then((rows) => {
      if (cancelled) {
        for (const row of rows) row.geom?.dispose();
        return;
      }
      setGeoms((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          if (!wanted.has(row.key)) {
            row.geom?.dispose();
            continue;
          }
          if (row.geom) next.set(row.key, row.geom);
        }
        geomsRef.current = next;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [tiles]);

  const prevGeoms = useRef<Map<string, BufferGeometry>>(new Map());
  useLayoutEffect(() => {
    const prev = prevGeoms.current;
    prevGeoms.current = geoms;
    for (const [key, geom] of prev) {
      if (!geoms.has(key)) geom.dispose();
    }
  }, [geoms]);

  useLayoutEffect(() => {
    return () => {
      for (const geom of prevGeoms.current.values()) geom.dispose();
      prevGeoms.current = new Map();
    };
  }, []);

  const ground = useMemo(() => groundGeometry(GROUND_SIZE_M), []);
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const visible = tiles
    .map((t) => {
      const key = tileKey(t);
      const geom = geoms.get(key);
      return geom ? { key, geom } : null;
    })
    .filter((row): row is { key: string; geom: BufferGeometry } => row != null);

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
      {visible.map((row) => (
        <mesh key={row.key} geometry={row.geom} raycast={noopRaycast}>
          <meshLambertMaterial
            color={BUILDING_COLOR}
            transparent
            opacity={SURFACE_OPACITY}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
