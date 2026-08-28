/**
 * PMTiles / MVT helpers for the schematic surface layer.
 * Isolated from routing — do not import plan/status/topology.
 */

import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { latLonToEnu, type Aabb2, type LatLon } from "./geo";
import {
  DEFAULT_BUILDING_HEIGHT_M,
  MIN_RING_EDGE_M,
  clipPathToRect,
  clipRingToRect,
  pointInRing,
  ringAabb,
  ringCentroid,
  simplifyRing,
  type OsmArea,
  type OsmBuilding,
  type OsmLine,
} from "./osm";

export const PMTILES_URL = "/api/osm/london.pmtiles";
/** Archive availability plus the version that keys every tile URL. */
export const TILES_META_URL = "/api/osm/tiles";
export const PMTILES_ATTRIBUTION =
  "© OpenStreetMap contributors. Tiles: Protomaps";

/** Protomaps planet/basemap tiles typically stop at z15. */
export const PMTILES_MAX_ZOOM = 15;
export const PMTILES_MIN_BUILDING_ZOOM = 14;
/** Footprints are decoded at z13+ (z13 is the pulled-back building zoom). */
export const PMTILES_BUILDING_LAYER_MIN_ZOOM = 13;
export const PMTILES_LAND_MIN_ZOOM = 11;
/**
 * Every layer is clipped to the tile plus this much overspill, so neighbours
 * hold overlapping copies of anything near an edge. Drawing both compounds the
 * translucent surface alpha into a visible grid, hence the clipping below.
 * Measured at 64/4096 on the London extract.
 */
export const PMTILES_TILE_BUFFER_UNITS = 64;

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

export function tileKey(tile: TileCoord): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/**
 * One immutable URL per tile. The archive version sits in the path so the
 * browser disk cache serves repeat pans without a request, and a rebuilt
 * extract lands on fresh URLs.
 */
export function tileUrl(tile: TileCoord, version: string): string {
  return `${TILES_META_URL}/${encodeURIComponent(version)}/${tileKey(tile)}`;
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
 * The tile square in ENU metres. Constant lon maps to constant x and constant
 * lat to constant z, so the tile stays axis-aligned and the rect is exact.
 */
export function tileEnuRect(tile: TileCoord, origin: LatLon): Aabb2 {
  const min = latLonToEnu(
    tileToLat(tile.y + 1, tile.z),
    tileToLon(tile.x, tile.z),
    origin,
  );
  const max = latLonToEnu(
    tileToLat(tile.y, tile.z),
    tileToLon(tile.x + 1, tile.z),
    origin,
  );
  return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
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
 * Ground-plane mist around the look-at, sized to the loaded tile window.
 * Zooming out widens the clear disk; only the unloaded rim is hidden.
 */
export function fogRange(
  distM: number,
  z: number,
  lat: number = 51.53,
): { near: number; far: number } {
  const ring = ringForDistance(distM, z, lat);
  const windowM = (2 * ring + 1) * tileWidthM(z, lat);
  const far = windowM * 0.5;
  const near = Math.max(80, far * 0.55);
  return { near, far: Math.max(near + 50, far) };
}

/** Same smoothstep as the overlay shader. */
export function fogOverlayFactor(
  distM: number,
  near: number,
  far: number,
): number {
  if (!(far > near)) return distM >= far ? 1 : 0;
  const t = Math.min(1, Math.max(0, (distM - near) / (far - near)));
  return t * t * (3 - 2 * t);
}

/** After surface (≤3) and dollhouse lines (2) so mist covers tubes too. */
export const FOG_OVERLAY_ORDER = 10_000;

export const FOG_OVERLAY_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FOG_OVERLAY_FRAGMENT = /* glsl */ `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec2 fogTarget;
uniform mat4 inverseViewProjection;
varying vec2 vNdc;
void main() {
  vec4 worldFar = inverseViewProjection * vec4(vNdc, 1.0, 1.0);
  vec3 worldPos = worldFar.xyz / worldFar.w;
  vec3 worldDir = normalize(worldPos - cameraPosition);
  float fogFactor = 0.0;
  if (abs(worldDir.y) > 1.0e-5) {
    float t = -cameraPosition.y / worldDir.y;
    if (t > 0.0) {
      vec3 hit = cameraPosition + worldDir * t;
      float groundDist = length(hit.xz - fogTarget);
      fogFactor = smoothstep(fogNear, fogFar, groundDist);
    }
  }
  gl_FragColor = vec4(fogColor, fogFactor);
  #include <colorspace_fragment>
}
`;

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

function finiteMetres(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function heightFromProps(props: Record<string, unknown>): number {
  return (
    finiteMetres(props.height) ??
    finiteMetres(props.render_height) ??
    DEFAULT_BUILDING_HEIGHT_M
  );
}

function minHeightFromProps(props: Record<string, unknown>): number {
  return finiteMetres(props.min_height) ?? 0;
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

function enuFromLonLatCoords(
  coords: number[][],
  origin: LatLon,
): [number, number][] {
  const out: [number, number][] = [];
  for (const c of coords) {
    const lon = c[0];
    const lat = c[1];
    if (lon == null || lat == null) continue;
    const p = latLonToEnu(lat, lon, origin);
    out.push([p.x, p.z]);
  }
  return out;
}

function ringFromLonLatCoords(
  coords: number[][],
  origin: LatLon,
): [number, number][] {
  return simplifyRing(enuFromLonLatCoords(coords, origin), MIN_RING_EDGE_M);
}

function ringsFromPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: LatLon,
  id: string,
  rect: Aabb2,
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
    const ring = clipRingToRect(ringFromLonLatCoords(outer, origin), rect);
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
  rect: Aabb2,
): { id: string; path: [number, number][] }[] {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.coordinates;
  const out: { id: string; path: [number, number][] }[] = [];
  let part = 0;
  for (const line of lines) {
    const full = ringFromLonLatCoords(line, origin);
    if (full.length < 2) continue;
    for (const path of clipPathToRect(full, rect)) {
      out.push({
        id: part === 0 ? id : `${id}/${part}`,
        path,
      });
      part += 1;
    }
  }
  return out;
}

/**
 * True when the tile's copy of a feature runs into the buffer bound, meaning it
 * may be cut off and the whole shape only exists in a neighbour. The bound is a
 * property of the archive, so every tile tests the same one.
 */
function reachesTileBuffer(feat: VectorTileFeature): boolean {
  const box = feat.bbox();
  const lo = -PMTILES_TILE_BUFFER_UNITS;
  const hi = feat.extent + PMTILES_TILE_BUFFER_UNITS;
  return (
    (box[0] ?? 0) <= lo ||
    (box[1] ?? 0) <= lo ||
    (box[2] ?? 0) >= hi ||
    (box[3] ?? 0) >= hi
  );
}

/**
 * Which tile owns a footprint that several of them hold whole. Bounds are
 * order-invariant so every neighbour agrees, and the max sides are exclusive
 * so exactly one tile claims it.
 */
function ownsFootprint(aabb: Aabb2, rect: Aabb2): boolean {
  const cx = (aabb.minX + aabb.maxX) / 2;
  const cz = (aabb.minZ + aabb.maxZ) / 2;
  return cx >= rect.minX && cx < rect.maxX && cz >= rect.minZ && cz < rect.maxZ;
}

/**
 * Footprints get an owner rather than a clip, because clipping one would leave
 * an extrusion wall on the seam and paint the tile grid back in. Truncated
 * copies fall back to clipping, where neighbours tile the shape between them.
 */
function footprintsFromPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: LatLon,
  id: string,
  rect: Aabb2,
  whole: boolean,
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
    const points = enuFromLonLatCoords(outer, origin);
    if (points.length < 3) continue;
    if (whole && !ownsFootprint(ringAabb(points), rect)) continue;
    const simple = simplifyRing(points, MIN_RING_EDGE_M);
    const ring = whole ? simple : clipRingToRect(simple, rect);
    if (ring.length < 3) continue;
    out.push({
      id: part === 0 ? id : `${id}/${part}`,
      ring,
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

type BuildingRow = {
  id: string;
  ring: [number, number][];
  height: number;
  minHeight: number;
  kind: string;
};

/**
 * OSM Simple 3D Buildings: once `building:part` volumes exist, the parent
 * `building=*` outline is 2D-only and must not be extruded.
 */
function keepBuildingRow(row: BuildingRow, parts: BuildingRow[]): boolean {
  if (row.kind !== "building") return true;
  return !parts.some((part) => {
    const [x, z] = ringCentroid(part.ring);
    return pointInRing(x, z, row.ring);
  });
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
  const rect = tileEnuRect(tile, origin);

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
        rect,
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
        for (const row of ringsFromPolygon(gj.geometry, origin, id, rect)) {
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
        for (const row of pathsFromLine(gj.geometry, origin, id, rect)) {
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
        rect,
      )) {
        out.roads.push({ ...row, kind });
      }
    }
  }

  if (tile.z >= PMTILES_BUILDING_LAYER_MIN_ZOOM) {
    const buildings = vt.layers.buildings ?? vt.layers.building;
    if (buildings) {
      const rows: BuildingRow[] = [];
      for (let i = 0; i < buildings.length; i++) {
        const feat = buildings.feature(i);
        if (feat.type !== 3) continue;
        const props = feat.properties as Record<string, unknown>;
        const kind = kindOf(props);
        if (kind === "address") continue;
        // `building:part=no` is the explicit "do not extrude" outline.
        if (kindDetailOf(props) === "no") continue;
        const gj = feat.toGeoJSON(tile.x, tile.y, tile.z);
        if (
          gj.geometry.type !== "Polygon" &&
          gj.geometry.type !== "MultiPolygon"
        ) {
          continue;
        }
        const height = heightFromProps(props);
        const minHeight = minHeightFromProps(props);
        for (const row of footprintsFromPolygon(
          gj.geometry,
          origin,
          featId(tile, "buildings", feat.id, i),
          rect,
          !reachesTileBuffer(feat),
        )) {
          rows.push({ ...row, height, minHeight, kind });
        }
      }
      const parts = rows.filter((row) => row.kind === "building_part");
      for (const row of rows) {
        if (!keepBuildingRow(row, parts)) continue;
        out.buildings.push({
          id: row.id,
          ring: row.ring,
          height: row.height,
          minHeight: row.minHeight,
        });
      }
    }
  }

  return out;
}

/** 204 (no such tile) and 404 (no extract) both mean nothing to draw. */
export async function fetchTileBytes(
  tile: TileCoord,
  version: string,
): Promise<Uint8Array | null> {
  const res = await fetch(tileUrl(tile, version));
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Tile ${tileKey(tile)} failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) return null;
  return bytes;
}

export async function fetchTileSurface(
  tile: TileCoord,
  origin: LatLon,
  version: string,
): Promise<TileSurface> {
  const bytes = await fetchTileBytes(tile, version);
  if (!bytes) return emptySurface();
  return surfaceFromMvt(bytes, tile, origin);
}
