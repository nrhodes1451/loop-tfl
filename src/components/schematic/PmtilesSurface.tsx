"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fog, type BufferGeometry } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
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
import { SCENE_BACKGROUND } from "@/lib/schematic/scene";
import { enuToLatLon, type LatLon } from "@/lib/schematic/geo";
import {
  fetchTileBuildings,
  fogRange,
  ringForDistance,
  tileKey,
  tilesAround,
  zoomForDistance,
  type TileCoord,
} from "@/lib/schematic/pmtiles";

/** Ground plane in ENU metres — Greater London fits with margin. */
const GROUND_SIZE_M = 50_000;
const SAMPLE_EVERY_MS = 120;
/** One 7×7 window per zoom so pulling out does not evict closer tiles. */
const MAX_TILES_PER_ZOOM = 49;

function noopRaycast() {}

function tileSetKey(tiles: TileCoord[]): string {
  return tiles.map(tileKey).join(",");
}

function visibleFromCache(
  tiles: TileCoord[],
  cache: TileGeomCache,
): Map<string, BufferGeometry> {
  const shown = new Map<string, BufferGeometry>();
  for (const tile of tiles) {
    const key = tileKey(tile);
    const geom = cache.geom(key);
    if (geom) shown.set(key, geom);
  }
  return shown;
}

/** Keeps extruded tiles after the far-zoom drop so zooming back in is instant. */
class TileGeomCache {
  private readonly stored = new Map<string, BufferGeometry | null>();
  private readonly orderByZoom = new Map<number, string[]>();
  private readonly inflight = new Map<string, Promise<BufferGeometry | null>>();
  private keep = new Set<string>();
  private alive = true;

  setKeep(keys: Iterable<string>) {
    this.keep = new Set(keys);
  }

  has(key: string): boolean {
    return this.stored.has(key);
  }

  geom(key: string): BufferGeometry | undefined | null {
    return this.stored.get(key);
  }

  private remember(key: string, geom: BufferGeometry | null) {
    this.stored.set(key, geom);
    const z = Number.parseInt(key, 10);
    let order = this.orderByZoom.get(z);
    if (!order) {
      order = [];
      this.orderByZoom.set(z, order);
    }
    const idx = order.indexOf(key);
    if (idx >= 0) order.splice(idx, 1);
    order.push(key);
    while (order.length > MAX_TILES_PER_ZOOM) {
      const drop = order.find((k) => !this.keep.has(k));
      if (drop == null) break;
      order.splice(order.indexOf(drop), 1);
      const old = this.stored.get(drop);
      this.stored.delete(drop);
      old?.dispose();
    }
  }

  load(tile: TileCoord, origin: LatLon): Promise<BufferGeometry | null> {
    const key = tileKey(tile);
    if (this.stored.has(key)) return Promise.resolve(this.stored.get(key)!);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const next = fetchTileBuildings(tile, origin)
      .then((buildings) => {
        this.inflight.delete(key);
        if (!this.alive) {
          buildingsToGeometry(buildings)?.dispose();
          return null;
        }
        if (this.stored.has(key)) return this.stored.get(key)!;
        const geom = buildingsToGeometry(buildings);
        this.remember(key, geom);
        return geom;
      })
      .catch(() => {
        this.inflight.delete(key);
        return null;
      });
    this.inflight.set(key, next);
    return next;
  }

  dispose() {
    this.alive = false;
    for (const geom of this.stored.values()) geom?.dispose();
    this.stored.clear();
    this.orderByZoom.clear();
    this.inflight.clear();
  }
}

export function PmtilesSurface({ origin }: { origin: LatLon }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const [tiles, setTiles] = useState<TileCoord[]>([]);
  const [geoms, setGeoms] = useState<Map<string, BufferGeometry>>(
    () => new Map(),
  );
  const cacheRef = useRef<TileGeomCache | null>(null);
  if (cacheRef.current == null) cacheRef.current = new TileGeomCache();
  const cache = cacheRef.current;
  const lastSample = useRef(0);
  const lastKey = useRef("");
  const originRef = useRef(origin);
  useLayoutEffect(() => {
    originRef.current = origin;
  }, [origin]);

  useLayoutEffect(() => {
    const fog = new Fog(SCENE_BACKGROUND, 80, 2_000);
    scene.fog = fog;
    return () => {
      if (scene.fog === fog) scene.fog = null;
    };
  }, [scene]);

  useFrame(() => {
    const now = performance.now();
    const waiting = lastKey.current === "";
    if (!waiting && now - lastSample.current < SAMPLE_EVERY_MS) return;
    lastSample.current = now;
    const target = controls?.target;
    if (!target) return;
    const dist = camera.position.distanceTo(target);
    const z = zoomForDistance(dist);
    const ll = enuToLatLon(-target.x, target.z, originRef.current);
    const fogZ = z ?? 13;
    const range = fogRange(dist, fogZ, ll.lat);
    if (scene.fog instanceof Fog) {
      scene.fog.near = range.near;
      scene.fog.far = range.far;
    }
    if (z == null) {
      if (lastKey.current !== "") {
        lastKey.current = "";
        cache.setKeep([]);
        setTiles([]);
        setGeoms(new Map());
      }
      return;
    }
    // buildingGeometry negates east so Three.js +X is west; undo that for tiles.
    const next = tilesAround(
      ll.lon,
      ll.lat,
      z,
      ringForDistance(dist, z, ll.lat),
    );
    const key = tileSetKey(next);
    if (key === lastKey.current) return;
    lastKey.current = key;
    cache.setKeep(next.map(tileKey));
    setTiles(next);
    setGeoms(visibleFromCache(next, cache));
  });

  useEffect(() => {
    let cancelled = false;
    const missing = tiles.filter((t) => !cache.has(tileKey(t)));
    if (missing.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      missing.map((tile) => cache.load(tile, originRef.current)),
    ).then(() => {
      if (cancelled) return;
      setGeoms(visibleFromCache(tiles, cache));
    });

    return () => {
      cancelled = true;
    };
  }, [cache, tiles]);

  useLayoutEffect(() => {
    return () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;
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
      <hemisphereLight
        color={SURFACE_SKY}
        groundColor={SURFACE_HEMI_GROUND}
        intensity={SURFACE_HEMI_INTENSITY}
      />
      <directionalLight
        position={SURFACE_SUN_POSITION}
        intensity={SURFACE_SUN_INTENSITY}
      />
      <mesh geometry={ground} raycast={noopRaycast}>
        <meshLambertMaterial
          color={GROUND_COLOR}
          transparent
          opacity={SURFACE_OPACITY}
          depthWrite={false}
          onBeforeCompile={wrapLambertCompile}
          customProgramCacheKey={wrapLambertCacheKey}
        />
      </mesh>
      {visible.map((row) => (
        <mesh key={row.key} geometry={row.geom} raycast={noopRaycast}>
          <meshLambertMaterial
            color={BUILDING_COLOR}
            transparent
            opacity={SURFACE_OPACITY}
            depthWrite={false}
            onBeforeCompile={wrapLambertCompile}
            customProgramCacheKey={wrapLambertCacheKey}
          />
        </mesh>
      ))}
    </group>
  );
}
