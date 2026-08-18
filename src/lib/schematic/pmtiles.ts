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
  type OsmBuilding,
} from "./osm";

export const PMTILES_URL = "/api/osm/london.pmtiles";
export const PMTILES_ATTRIBUTION =
  "© OpenStreetMap contributors. Tiles: Protomaps";

/** Protomaps planet/basemap tiles typically stop at z15. */
export const PMTILES_MAX_ZOOM = 15;
export const PMTILES_MIN_BUILDING_ZOOM = 14;

export type TileCoord = { z: number; x: number; y: number };

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

/** Mercator tile width in metres at `lat`. */
export function tileWidthM(z: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/**
 * Neighbourhood radius so the loaded square is wider than the oblique view.
 * Close: 3×3. Zoomed out: up to 9×9.
 */
export function ringForDistance(
  distM: number,
  z: number,
  lat: number = 51.53,
): number {
  const tileM = tileWidthM(z, lat);
  const span = Math.max(distM * 2, tileM);
  return Math.min(4, Math.max(1, Math.ceil(span / tileM)));
}

/** Linear fog so the tile-window edge fades into the scene background. */
export function fogRange(
  distM: number,
  z: number,
  lat: number = 51.53,
): { near: number; far: number } {
  const ring = ringForDistance(distM, z, lat);
  const windowM = (2 * ring + 1) * tileWidthM(z, lat);
  const near = Math.max(80, distM * 0.9);
  const far = Math.max(near + 50, Math.min(distM * 2.2, windowM));
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

function buildingsFromGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: LatLon,
  id: string,
  height: number,
): OsmBuilding[] {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;
  const out: OsmBuilding[] = [];
  let part = 0;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    const ring = ringFromLonLatCoords(outer, origin);
    if (ring.length < 3) continue;
    out.push({
      id: part === 0 ? id : `${id}/${part}`,
      height,
      ring,
    });
    part += 1;
  }
  return out;
}

export function buildingsFromMvt(
  data: Uint8Array,
  tile: TileCoord,
  origin: LatLon,
): OsmBuilding[] {
  const vt = new VectorTile(new PbfReader(data));
  const layer = vt.layers.buildings ?? vt.layers.building;
  if (!layer) return [];
  const out: OsmBuilding[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feat = layer.feature(i);
    if (feat.type !== 3) continue;
    const kind = feat.properties.kind;
    if (kind === "address") continue;
    const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
    if (gj.geometry.type !== "Polygon" && gj.geometry.type !== "MultiPolygon") {
      continue;
    }
    const id = `tile/${tileKey(tile)}/${feat.id ?? i}`;
    out.push(
      ...buildingsFromGeometry(
        gj.geometry,
        origin,
        id,
        heightFromProps(feat.properties as Record<string, unknown>),
      ),
    );
  }
  return out;
}

export async function fetchTileBuildings(
  tile: TileCoord,
  origin: LatLon,
  source: PMTiles = getLondonPmtiles(),
): Promise<OsmBuilding[]> {
  const result = await source.getZxy(tile.z, tile.x, tile.y);
  if (!result) return [];
  const raw = result.data;
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : new Uint8Array(raw as ArrayBuffer);
  return buildingsFromMvt(bytes, tile, origin);
}
