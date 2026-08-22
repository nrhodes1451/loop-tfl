"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fog, type BufferGeometry } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  GROUND_COLOR,
  LAND_COLOR,
  ROAD_COLOR,
  SURFACE_HEMI_GROUND,
  SURFACE_HEMI_INTENSITY,
  SURFACE_OPACITY,
  SURFACE_ORDER,
  SURFACE_SKY,
  SURFACE_SUN_INTENSITY,
  SURFACE_SUN_POSITION,
  WATER_COLOR,
  disposeSurfaceTile,
  featuresToTileGeom,
  groundGeometry,
  wrapLambertCacheKey,
  wrapLambertCompile,
  type SurfaceTileGeom,
} from "@/lib/schematic/building-geom";
import { SCENE_BACKGROUND } from "@/lib/schematic/scene";
import {
  CITY_MAX_DISTANCE_M,
  worldToLatLon,
  type LatLon,
} from "@/lib/schematic/geo";
import {
  fetchTileSurface,
  fogRange,
  landZoomForDistance,
  ringForDistance,
  tileKey,
  tilesAround,
  type TileCoord,
} from "@/lib/schematic/pmtiles";

/** Ground plane in ENU metres — Greater London fits with margin. */
const GROUND_SIZE_M = 50_000;
const SAMPLE_EVERY_MS = 120;
/**
 * Half a window of pan history beyond the widest 7×7 view, so stepping one
 * tile no longer evicts the tile just left behind. Kept small on purpose: a
 * z15 tile is roughly 2 MB of extruded geometry, so this is already ~150 MB
 * per zoom. Tile bytes come from the browser cache, so an eviction now costs
 * only decode and extrude.
 */
const MAX_TILES_PER_ZOOM = 72;

function noopRaycast() {}

function tileSetKey(tiles: TileCoord[]): string {
  return tiles.map(tileKey).join(",");
}

function visibleFromCache(
  tiles: TileCoord[],
  cache: TileGeomCache,
): Map<string, SurfaceTileGeom> {
  const shown = new Map<string, SurfaceTileGeom>();
  for (const tile of tiles) {
    const key = tileKey(tile);
    const geom = cache.geom(key);
    if (geom) shown.set(key, geom);
  }
  return shown;
}

function tilesReady(tiles: TileCoord[], cache: TileGeomCache): boolean {
  return tiles.length > 0 && tiles.every((t) => cache.has(tileKey(t)));
}

function keepKeys(...groups: TileCoord[][]): string[] {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const tile of group) keys.add(tileKey(tile));
  }
  return [...keys];
}

/** Keeps decoded tiles after the far-zoom drop so zooming back in is instant. */
class TileGeomCache {
  private readonly stored = new Map<string, SurfaceTileGeom | null>();
  private readonly orderByZoom = new Map<number, string[]>();
  private readonly inflight = new Map<string, Promise<SurfaceTileGeom | null>>();
  private keep = new Set<string>();
  private alive = true;

  setKeep(keys: Iterable<string>) {
    this.keep = new Set(keys);
  }

  has(key: string): boolean {
    return this.stored.has(key);
  }

  geom(key: string): SurfaceTileGeom | undefined | null {
    const hit = this.stored.get(key);
    if (hit !== undefined) this.touch(key);
    return hit;
  }

  private orderFor(key: string): string[] {
    const z = Number.parseInt(key, 10);
    let order = this.orderByZoom.get(z);
    if (!order) {
      order = [];
      this.orderByZoom.set(z, order);
    }
    return order;
  }

  /** Move to the recent end of its zoom's order, so eviction is LRU. */
  private touch(key: string) {
    const order = this.orderFor(key);
    const idx = order.indexOf(key);
    if (idx >= 0) order.splice(idx, 1);
    order.push(key);
  }

  private remember(key: string, geom: SurfaceTileGeom | null) {
    this.stored.set(key, geom);
    this.touch(key);
    const order = this.orderFor(key);
    while (order.length > MAX_TILES_PER_ZOOM) {
      const drop = order.find((k) => !this.keep.has(k));
      if (drop == null) break;
      order.splice(order.indexOf(drop), 1);
      const old = this.stored.get(drop);
      this.stored.delete(drop);
      disposeSurfaceTile(old);
    }
  }

  load(
    tile: TileCoord,
    origin: LatLon,
    version: string,
  ): Promise<SurfaceTileGeom | null> {
    const key = tileKey(tile);
    if (this.stored.has(key)) return Promise.resolve(this.stored.get(key)!);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const next = fetchTileSurface(tile, origin, version)
      .then((features) => {
        this.inflight.delete(key);
        const geom = featuresToTileGeom(features);
        if (!this.alive) {
          disposeSurfaceTile(geom);
          return null;
        }
        if (this.stored.has(key)) {
          disposeSurfaceTile(geom);
          return this.stored.get(key)!;
        }
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
    for (const geom of this.stored.values()) disposeSurfaceTile(geom);
    this.stored.clear();
    this.orderByZoom.clear();
    this.inflight.clear();
  }
}

function LayerMesh({
  geometry,
  color,
  renderOrder,
  vertexColors = false,
}: {
  geometry: BufferGeometry;
  color: string;
  renderOrder: number;
  vertexColors?: boolean;
}) {
  return (
    <mesh geometry={geometry} renderOrder={renderOrder} raycast={noopRaycast}>
      <meshLambertMaterial
        color={vertexColors ? "#ffffff" : color}
        vertexColors={vertexColors}
        transparent
        opacity={SURFACE_OPACITY}
        depthWrite={false}
        onBeforeCompile={wrapLambertCompile}
        customProgramCacheKey={wrapLambertCacheKey}
      />
    </mesh>
  );
}

export function PmtilesSurface({
  origin,
  tilesVersion,
}: {
  origin: LatLon;
  tilesVersion: string;
}) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const [wanted, setWanted] = useState<TileCoord[]>([]);
  const [shown, setShown] = useState<TileCoord[]>([]);
  const [geoms, setGeoms] = useState<Map<string, SurfaceTileGeom>>(
    () => new Map(),
  );
  const cacheRef = useRef<TileGeomCache | null>(null);
  if (cacheRef.current == null) cacheRef.current = new TileGeomCache();
  const cache = cacheRef.current;
  const lastSample = useRef(0);
  const lastKey = useRef("");
  const originRef = useRef(origin);
  const shownRef = useRef<TileCoord[]>([]);
  const preloadRef = useRef<TileCoord[]>([]);
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
    const target = controls?.target;
    if (!target) return;
    const dist = camera.position.distanceTo(target);
    const z = landZoomForDistance(dist);
    const ll = worldToLatLon(target.x, target.z, originRef.current);
    const range = fogRange(dist, z, ll.lat);
    if (scene.fog instanceof Fog) {
      scene.fog.near = range.near;
      scene.fog.far = range.far;
    }
    const now = performance.now();
    const waiting = lastKey.current === "";
    if (!waiting && now - lastSample.current < SAMPLE_EVERY_MS) return;
    lastSample.current = now;
    const next = tilesAround(
      ll.lon,
      ll.lat,
      z,
      ringForDistance(dist, z, ll.lat),
    );
    const farZ = landZoomForDistance(CITY_MAX_DISTANCE_M);
    const preload =
      z > farZ
        ? tilesAround(
            ll.lon,
            ll.lat,
            farZ,
            ringForDistance(CITY_MAX_DISTANCE_M, farZ, ll.lat),
          )
        : [];
    preloadRef.current = preload;
    const key = tileSetKey(next);
    if (key === lastKey.current) return;
    lastKey.current = key;
    cache.setKeep(keepKeys(next, shownRef.current, preload));
    setWanted(next);
    const prevZ = shownRef.current[0]?.z;
    const zoomChanged = prevZ != null && prevZ !== z;
    // Hold the previous LOD until the new zoom's window is in cache.
    if (tilesReady(next, cache) || !zoomChanged) {
      shownRef.current = next;
      setShown(next);
      setGeoms(visibleFromCache(next, cache));
    }
  });

  useEffect(() => {
    if (wanted.length === 0) return;
    let cancelled = false;
    const origin = originRef.current;

    void (async () => {
      const missing = wanted.filter((t) => !cache.has(tileKey(t)));
      if (missing.length > 0) {
        await Promise.all(
          missing.map((tile) => cache.load(tile, origin, tilesVersion)),
        );
        if (cancelled) return;
        shownRef.current = wanted;
        setShown(wanted);
        setGeoms(visibleFromCache(wanted, cache));
      }

      const preload = preloadRef.current.filter((t) => !cache.has(tileKey(t)));
      if (preload.length === 0) return;
      await Promise.all(
        preload.map((tile) => cache.load(tile, origin, tilesVersion)),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [cache, wanted, tilesVersion]);

  useLayoutEffect(() => {
    return () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;
    };
  }, []);

  const ground = useMemo(() => groundGeometry(GROUND_SIZE_M), []);
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const visible = shown
    .map((t) => {
      const key = tileKey(t);
      const geom = geoms.get(key);
      return geom ? { key, geom } : null;
    })
    .filter((row): row is { key: string; geom: SurfaceTileGeom } => row != null);

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
      {/*
        Transparent meshes sort by bounding-sphere depth, so the ground plane
        (centred on the ENU origin) would otherwise paint over every tile
        beyond King's Cross and under every tile in front of it.
      */}
      <mesh geometry={ground} renderOrder={SURFACE_ORDER.ground} raycast={noopRaycast}>
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
        <group key={row.key}>
          {row.geom.land ? (
            <LayerMesh
              geometry={row.geom.land}
              color={LAND_COLOR}
              renderOrder={SURFACE_ORDER.land}
            />
          ) : null}
          {row.geom.water ? (
            <LayerMesh
              geometry={row.geom.water}
              color={WATER_COLOR}
              renderOrder={SURFACE_ORDER.water}
            />
          ) : null}
          {row.geom.roads ? (
            <LayerMesh
              geometry={row.geom.roads}
              color={ROAD_COLOR}
              renderOrder={SURFACE_ORDER.roads}
            />
          ) : null}
          {row.geom.buildings ? (
            <LayerMesh
              geometry={row.geom.buildings}
              color="#ffffff"
              renderOrder={SURFACE_ORDER.buildings}
              vertexColors
            />
          ) : null}
        </group>
      ))}
    </group>
  );
}
