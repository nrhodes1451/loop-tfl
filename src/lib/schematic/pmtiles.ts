/**
 * PMTiles / MVT helpers for the schematic surface layer.
 * Isolated from routing — do not import plan/status/topology.
 */

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";
import { latLonToEnu, type LatLon } from "./geo";
import {
  DEFAULT_BUILDING_HEIGHT_M,
  MIN_RING_EDGE_M,
  simplifyRing,
  type OsmArea,
  type OsmBuilding,
  type OsmLine,
} from "./osm";

export const PMTILES_URL = "/api/osm/london.pmtiles";
export const PMTILES_ATTRIBUTION =
  "© OpenStreetMap contributors. Tiles: Protomaps";

/** Protomaps planet/basemap tiles typically stop at z15. */
export const PMTILES_MAX_ZOOM = 15;
export const PMTILES_MIN_BUILDING_ZOOM = 14;
/** Footprints are decoded at z13+ (z13 is the pulled-back building zoom). */
export const PMTILES_BUILDING_LAYER_MIN_ZOOM = 13;
export const PMTILES_LAND_MIN_ZOOM = 11;

export type TileCoord = { z: number; x: number; y: number };

export type TileSurface = {
  land: OsmArea[];
  water: OsmArea[];
  waterways: OsmLine[];
  roads: OsmLine[];
  buildings: OsmBuilding[];
};

const PARK_KINDS = new Set([
  "park",
  "forest",
  "wood",
  "garden",
  "grass",
  "meadow",
  "cemetery",
  "pitch",
  "playground",
  "golf_course",
  "nature_reserve",
  "national_park",
  "recreation_ground",
  "dog_park",
  "protected_area",
]);

const WATER_POLY_KINDS = new Set([
  "water",
  "lake",
  "ocean",
  "playa",
  "other",
]);

const WATERWAY_DETAILS = new Set(["canal", "river"]);

const ROAD_KINDS = new Set(["highway", "major_road", "rail"]);

let archive: PMTiles | null = null;

export function getLondonPmtiles(): PMTiles {
  archive ??= new PMTiles(PMTILES_URL);
  return archive;
}

export function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.floor(((lon + 180) / 360) * n);
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
      n,
  );
}

export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const n = 2 ** z;
  return {
    z,
    x: Math.min(n - 1, Math.max(0, lonToTileX(lon, z))),
    y: Math.min(n - 1, Math.max(0, latToTileY(lat, z))),
  };
}

export function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Pixel in an MVT (extent, usually 4096) → WGS84. */
export function tilePointToLonLat(
  tile: TileCoord,
  px: number,
  py: number,
  extent: number,
): LatLon {
  const fracX = px / extent;
  const fracY = py / extent;
  return {
    lon: tileToLon(tile.x + fracX, tile.z),
    lat: tileToLat(tile.y + fracY, tile.z),
  };
}

/**
 * Camera distance → building tile zoom. Null = skip 3D footprints.
 * Caps at z15 (typical Protomaps maxzoom). Farther views drop to z14/z13
 * so each tile covers more ground.
 */
export function zoomForDistance(distM: number): number | null {
  if (!Number.isFinite(distM) || distM > 16_000) return null;
  if (distM > 6_000) return 13;
  if (distM > 2_000) return PMTILES_MIN_BUILDING_ZOOM;
  return PMTILES_MAX_ZOOM;
}

/**
 * Land / water / roads stay loaded after buildings drop.
 * Same z15–z13 ladder as footprints, then z12 to ~22 km and z11 beyond.
 */
export function landZoomForDistance(distM: number): number {
  const buildings = zoomForDistance(distM);
  if (buildings != null) return buildings;
  if (!Number.isFinite(distM) || distM > 22_000) return PMTILES_LAND_MIN_ZOOM;
  return 12;
}

/** Next step down the z15–z11 ladder, or null at the coarsest land zoom. */
export function nextCoarserLandZoom(distM: number): number | null {
  const z = landZoomForDistance(distM);
  if (z <= PMTILES_LAND_MIN_ZOOM) return null;
  return z - 1;
}

/** Mercator tile width in metres at `lat`. */
export function tileWidthM(z: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/**
 * Neighbourhood radius so the loaded square is wider than the oblique view.
 * Close: 3×3. Zoomed out: up to 7×7.
 */
export function ringForDistance(
  distM: number,
  z: number,
  lat: number = 51.53,
): number {
  const tileM = tileWidthM(z, lat);
  const span = Math.max(distM * 2, tileM);
  return Math.min(3, Math.max(1, Math.ceil(span / tileM)));
}

/**
 * Linear fog that tracks camera distance so the ramp stays tight while
 * zooming. Far is still capped at the tile-window edge so unloaded tiles
 * never pop out of the mist.
 */
export function fogRange(
  distM: number,
  z: number,
  lat: number = 51.53,
): { near: number; far: number } {
  const ring = ringForDistance(distM, z, lat);
  const windowM = (2 * ring + 1) * tileWidthM(z, lat);
  const d = Number.isFinite(distM) ? distM : windowM;
  const near = Math.max(80, d * 0.9);
  const far = Math.max(near + 50, Math.min(d * 2.2, windowM));
  return { near, far };
}

export function tilesAround(
  lon: number,
  lat: number,
  z: number,
  ring: number = 1,
): TileCoord[] {
  const center = lonLatToTile(lon, lat, z);
  const n = 2 ** z;
  const out: TileCoord[] = [];
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const y = center.y + dy;
      if (y < 0 || y >= n) continue;
      const x = ((center.x + dx) % n + n) % n;
      out.push({ z, x, y });
    }
  }
  return out;
}

function heightFromProps(props: Record<string, unknown>): number {
  const raw = props.height ?? props.render_height;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_BUILDING_HEIGHT_M;
}

function propTrue(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === "true" ||
    value === "yes" ||
    value === "1"
  );
}

function kindOf(props: Record<string, unknown>): string {
  return String(props.kind ?? "");
}

function kindDetailOf(props: Record<string, unknown>): string {
  return String(props.kind_detail ?? "");
}

function ringFromLonLatCoords(
  coords: number[][],
  origin: LatLon,
): [number, number][] {
  const ring: [number, number][] = [];
  for (const c of coords) {
    const lon = c[0];
    const lat = c[1];
    if (lon == null || lat == null) continue;
    const p = latLonToEnu(lat, lon, origin);
    ring.push([p.x, p.z]);
  }
  return simplifyRing(ring, MIN_RING_EDGE_M);
}

function ringsFromPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: LatLon,
  id: string,
): { id: string; ring: [number, number][] }[] {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;
  const out: { id: string; ring: [number, number][] }[] = [];
  let part = 0;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const ring = ringFromLonLatCoords(outer, origin);
    if (ring.length < 3) continue;
    out.push({
      id: part === 0 ? id : `${id}/${part}`,
      ring,
    });
    part += 1;
  }
  return out;
}

function pathsFromLine(
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString,
  origin: LatLon,
  id: string,
): { id: string; path: [number, number][] }[] {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.coordinates;
  const out: { id: string; path: [number, number][] }[] = [];
  let part = 0;
  for (const line of lines) {
    const path = ringFromLonLatCoords(line, origin);
    if (path.length < 2) continue;
    out.push({
      id: part === 0 ? id : `${id}/${part}`,
      path,
    });
    part += 1;
  }
  return out;
}

function emptySurface(): TileSurface {
  return {
    land: [],
    water: [],
    waterways: [],
    roads: [],
    buildings: [],
  };
}

function featId(
  tile: TileCoord,
  layer: string,
  featIdRaw: unknown,
  i: number,
): string {
  return `tile/${tileKey(tile)}/${layer}/${featIdRaw ?? i}`;
}

export function surfaceFromMvt(
  data: Uint8Array,
  tile: TileCoord,
  origin: LatLon,
): TileSurface {
  const out = emptySurface();
  const vt = new VectorTile(new PbfReader(data));

  const landuse = vt.layers.landuse;
  if (landuse) {
    for (let i = 0; i < landuse.length; i++) {
      const feat = landuse.feature(i);
      if (feat.type !== 3) continue;
      const props = feat.properties as Record<string, unknown>;
      const kind = kindOf(props);
      if (!PARK_KINDS.has(kind)) continue;
      const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
      if (gj.geometry.type !== "Polygon" && gj.geometry.type !== "MultiPolygon") {
        continue;
      }
      for (const row of ringsFromPolygon(
        gj.geometry,
        origin,
        featId(tile, "landuse", feat.id, i),
      )) {
        out.land.push({ ...row, kind });
      }
    }
  }

  const water = vt.layers.water;
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const feat = water.feature(i);
      const props = feat.properties as Record<string, unknown>;
      const kind = kindOf(props);
      const detail = kindDetailOf(props);
      const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
      const id = featId(tile, "water", feat.id, i);
      if (feat.type === 3) {
        if (kind && !WATER_POLY_KINDS.has(kind)) continue;
        if (
          gj.geometry.type !== "Polygon" &&
          gj.geometry.type !== "MultiPolygon"
        ) {
          continue;
        }
        for (const row of ringsFromPolygon(gj.geometry, origin, id)) {
          out.water.push({ ...row, kind: kind || "water" });
        }
      } else if (feat.type === 2) {
        if (!WATERWAY_DETAILS.has(detail)) continue;
        if (
          gj.geometry.type !== "LineString" &&
          gj.geometry.type !== "MultiLineString"
        ) {
          continue;
        }
        for (const row of pathsFromLine(gj.geometry, origin, id)) {
          out.waterways.push({ ...row, kind: detail });
        }
      }
    }
  }

  const roads = vt.layers.roads ?? vt.layers.road;
  if (roads) {
    for (let i = 0; i < roads.length; i++) {
      const feat = roads.feature(i);
      if (feat.type !== 2) continue;
      const props = feat.properties as Record<string, unknown>;
      const kind = kindOf(props);
      if (!ROAD_KINDS.has(kind)) continue;
      if (propTrue(props.is_link) || propTrue(props.is_tunnel)) continue;
      const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
      if (
        gj.geometry.type !== "LineString" &&
        gj.geometry.type !== "MultiLineString"
      ) {
        continue;
      }
      for (const row of pathsFromLine(
        gj.geometry,
        origin,
        featId(tile, "roads", feat.id, i),
      )) {
        out.roads.push({ ...row, kind });
      }
    }
  }

  if (tile.z >= PMTILES_BUILDING_LAYER_MIN_ZOOM) {
    const buildings = vt.layers.buildings ?? vt.layers.building;
    if (buildings) {
      for (let i = 0; i < buildings.length; i++) {
        const feat = buildings.feature(i);
        if (feat.type !== 3) continue;
        const props = feat.properties as Record<string, unknown>;
        if (kindOf(props) === "address") continue;
        const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
        if (
          gj.geometry.type !== "Polygon" &&
          gj.geometry.type !== "MultiPolygon"
        ) {
          continue;
        }
        for (const row of ringsFromPolygon(
          gj.geometry,
          origin,
          featId(tile, "buildings", feat.id, i),
        )) {
          out.buildings.push({
            ...row,
            height: heightFromProps(props),
          });
        }
      }
    }
  }

  return out;
}

export async function fetchTileSurface(
  tile: TileCoord,
  origin: LatLon,
  source: PMTiles = getLondonPmtiles(),
): Promise<TileSurface> {
  const result = await source.getZxy(tile.z, tile.x, tile.y);
  if (!result) return emptySurface();
  const raw = result.data;
  const bytes =
    raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
  return surfaceFromMvt(bytes, tile, origin);
}
