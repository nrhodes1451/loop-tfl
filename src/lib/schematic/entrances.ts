/**
 * OSM street-entrance overlay: shared-node building footprints and steps.
 * Isolated from routing — do not import plan/status/topology.
 */

import { NATIONAL_RAIL_RED } from "../tokens";
import { distanceM, latLonToEnu, type LatLon } from "./geo";
import { ringAabb } from "./osm";

export const ENTRANCE_MATCH_M = 200;
export const DEFAULT_HALL_HEIGHT_M = 7;
export const MAX_HALL_HEIGHT_M = 16;
export const STAIR_WIDTH_M = 2.5;
/** Schematic risers — not OSM `step_count`. */
export const STAIR_RISERS = 8;
/** Total drop below street (metres). */
export const STAIR_DROP_M = 3.2;
/** Pixel width for the stair cage, same order as dollhouse GlowLine. */
export const STAIR_LINE_WIDTH = 2;
export const STAIR_COLOR = NATIONAL_RAIL_RED;

export const OVERPASS_ENDPOINTS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const;

/** [lat, lon] */
export type LatLonPair = [number, number];

export type EntranceBuilding = {
  osmWayId: number;
  name?: string;
  height?: number;
  ring: LatLonPair[];
};

export type EntranceStairs = {
  osmWayId: number;
  path: LatLonPair[];
  /** Raw OSM `incline`, when present. `path[0]` is always the street end. */
  incline?: string;
};

/** `up` = uphill along the way (first node is bottom). */
export type InclineDir = "up" | "down";

type IndexedStairs = EntranceStairs & { nodeIds: number[] };

export type StationEntrances = {
  buildings: EntranceBuilding[];
  stairs: EntranceStairs[];
};

export type EntranceOverlayFile = {
  generatedAt: string;
  stations: Record<string, StationEntrances>;
};

export type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

export type OverpassWay = {
  type: "way";
  id: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

export type OverpassResponse = {
  elements?: (OverpassNode | OverpassWay | { type: string })[];
};

export type EntranceStationRef = {
  id: string;
  lat: number;
  lon: number;
};

export function overpassQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const { south, west, north, east } = bbox;
  return `[out:json][timeout:180];
(
  node["railway"="subway_entrance"](${south},${west},${north},${east});
  node["railway"="train_station_entrance"](${south},${west},${north},${east});
)->.ent;
.ent out;
way(bn.ent)["building"];
out geom;
way(bn.ent)["highway"];
out geom;
`;
}

export function networkBbox(
  stations: EntranceStationRef[],
  padDeg: number = 0.02,
): { south: number; west: number; north: number; east: number } {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    south = Math.min(south, s.lat);
    north = Math.max(north, s.lat);
    west = Math.min(west, s.lon);
    east = Math.max(east, s.lon);
  }
  if (!Number.isFinite(south)) {
    return { south: 51.33, west: -0.98, north: 51.72, east: 0.34 };
  }
  return {
    south: south - padDeg,
    west: west - padDeg,
    north: north + padDeg,
    east: east + padDeg,
  };
}

function dropClosingDuplicate(ring: LatLonPair[]): LatLonPair[] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function pairList(
  geometry: { lat: number; lon: number }[] | undefined,
): LatLonPair[] {
  if (!geometry) return [];
  const out: LatLonPair[] = [];
  for (const p of geometry) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    out.push([p.lat, p.lon]);
  }
  return out;
}

export function ringAabbAreaM2(ring: LatLonPair[]): number {
  if (ring.length < 3) return 0;
  const origin: LatLon = { lat: ring[0]![0], lon: ring[0]![1] };
  const enu: [number, number][] = ring.map(([lat, lon]) => {
    const p = latLonToEnu(lat, lon, origin);
    return [p.x, p.z];
  });
  const aabb = ringAabb(enu);
  const w = aabb.maxX - aabb.minX;
  const d = aabb.maxZ - aabb.minZ;
  if (!Number.isFinite(w) || !Number.isFinite(d) || w < 0 || d < 0) return 0;
  return w * d;
}

export function hallHeightM(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_HALL_HEIGHT_M;
  }
  return Math.min(MAX_HALL_HEIGHT_M, Math.max(4, raw));
}

function parseHeight(tags: Record<string, string> | undefined): number | undefined {
  if (!tags?.height) return undefined;
  const n = Number.parseFloat(tags.height);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function isEntranceNode(el: OverpassNode): boolean {
  const railway = el.tags?.railway;
  return railway === "subway_entrance" || railway === "train_station_entrance";
}

function isConveying(tags: Record<string, string> | undefined): boolean {
  const v = tags?.conveying;
  return v != null && v !== "" && v !== "no";
}

export function parseIncline(raw: string | undefined): InclineDir | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "no" || s === "0" || s === "0%" || s === "0°") {
    return null;
  }
  if (s === "up" || s === "yes") return "up";
  if (s === "down") return "down";
  const n = Number.parseFloat(s.replace(/[%°]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? "up" : "down";
}

/**
 * OSM way order plus `incline` (or the entrance vertex) so `path[0]` is street.
 */
export function orientStairPath(
  path: LatLonPair[],
  opts: {
    incline?: string;
    nodeIds?: number[];
    entranceNodeId?: number;
  } = {},
): LatLonPair[] {
  if (path.length < 2) return path;
  const dir = parseIncline(opts.incline);
  if (dir === "up") return [...path].reverse();
  if (dir === "down") return path;
  const ids = opts.nodeIds;
  const ent = opts.entranceNodeId;
  if (ids == null || ids.length < 2 || ent == null) return path;
  const idx = ids.indexOf(ent);
  if (idx < 0) return path;
  const last = ids.length - 1;
  if (idx > last - idx) return [...path].reverse();
  return path;
}

export function entranceRingToEnu(
  ring: LatLonPair[],
  origin: LatLon,
): [number, number][] {
  return ring.map(([lat, lon]) => {
    const p = latLonToEnu(lat, lon, origin);
    return [p.x, p.z];
  });
}

export function hidesStreetCuboid(row: StationEntrances | undefined): boolean {
  if (!row) return false;
  return row.buildings.length > 0 || row.stairs.length > 0;
}

type BuildingCand = EntranceBuilding & { area: number };

/** Smallest positive-area ring that shares the entrance node. No size cap. */
export function pickBuildingForEntrance(
  nodeId: number,
  buildingsByNode: Map<number, EntranceBuilding[]>,
): EntranceBuilding | null {
  const cands: BuildingCand[] = [];
  for (const b of buildingsByNode.get(nodeId) ?? []) {
    const area = ringAabbAreaM2(b.ring);
    if (area <= 0) continue;
    cands.push({ ...b, area });
  }
  cands.sort((a, b) => a.area - b.area || a.osmWayId - b.osmWayId);
  const best = cands[0];
  if (!best) return null;
  const { area: _area, ...rest } = best;
  return rest;
}

function indexOsm(osm: OverpassResponse): {
  nodes: OverpassNode[];
  buildingsByNode: Map<number, EntranceBuilding[]>;
  stairsByNode: Map<number, IndexedStairs[]>;
} {
  const nodes: OverpassNode[] = [];
  const buildingsByNode = new Map<number, EntranceBuilding[]>();
  const stairsByNode = new Map<number, IndexedStairs[]>();

  const push = <T,>(map: Map<number, T[]>, nodeId: number, row: T) => {
    const list = map.get(nodeId) ?? [];
    list.push(row);
    map.set(nodeId, list);
  };

  for (const el of osm.elements ?? []) {
    if (el.type === "node") {
      const node = el as OverpassNode;
      if (isEntranceNode(node)) nodes.push(node);
      continue;
    }
    if (el.type !== "way") continue;
    const way = el as OverpassWay;
    const tags = way.tags ?? {};
    const nodeIds = way.nodes ?? [];
    if (tags.building) {
      if (tags.building === "roof") continue;
      const ring = dropClosingDuplicate(pairList(way.geometry));
      if (ring.length < 3) continue;
      const row: EntranceBuilding = {
        osmWayId: way.id,
        name: tags.name || undefined,
        height: parseHeight(tags),
        ring,
      };
      for (const nid of nodeIds) push(buildingsByNode, nid, row);
      continue;
    }
    if (tags.highway === "steps" && !isConveying(tags)) {
      let path = pairList(way.geometry);
      let ids = [...nodeIds];
      if (path.length >= 2) {
        const first = path[0]!;
        const last = path[path.length - 1]!;
        if (first[0] === last[0] && first[1] === last[1]) {
          path = path.slice(0, -1);
          if (ids.length === path.length + 1) ids = ids.slice(0, -1);
        }
      }
      if (path.length < 2) continue;
      const row: IndexedStairs = {
        osmWayId: way.id,
        path,
        nodeIds: ids,
        incline: tags.incline || undefined,
      };
      for (const nid of ids) push(stairsByNode, nid, row);
    }
  }

  return { nodes, buildingsByNode, stairsByNode };
}

export const OSM_HALL_ID_PREFIX = "osm-hall::";
export const OSM_STAIR_ID_PREFIX = "osm-stairs::";

export function overlayHallId(osmWayId: number): string {
  return `${OSM_HALL_ID_PREFIX}${osmWayId}`;
}

export function overlayStairId(osmWayId: number): string {
  return `${OSM_STAIR_ID_PREFIX}${osmWayId}`;
}

export type OverlayHallItem = {
  id: string;
  stationId: string;
  osmWayId: number;
  label: string;
  ring: [number, number][];
  height: number;
};

export type OverlayStairItem = {
  id: string;
  stationId: string;
  osmWayId: number;
  label: string;
  path: [number, number][];
  widthM: number;
};

export type OverlayHoverVolume = {
  id: string;
  label: string;
  type: string;
  level: number;
};

export function overlayGeometries(
  overlay: EntranceOverlayFile,
  origin: LatLon,
  stationIds: Iterable<string>,
): {
  halls: OverlayHallItem[];
  stairs: OverlayStairItem[];
} {
  const halls: OverlayHallItem[] = [];
  const stairs: OverlayStairItem[] = [];
  const seen = new Set<string>();
  for (const id of stationIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = overlay.stations[id];
    if (!row) continue;
    for (const b of row.buildings) {
      halls.push({
        id: overlayHallId(b.osmWayId),
        stationId: id,
        osmWayId: b.osmWayId,
        label: b.name?.trim() || "Entrance",
        ring: entranceRingToEnu(b.ring, origin),
        height: hallHeightM(b.height),
      });
    }
    for (const s of row.stairs) {
      stairs.push({
        id: overlayStairId(s.osmWayId),
        stationId: id,
        osmWayId: s.osmWayId,
        label: "Stairs",
        path: entranceRingToEnu(s.path, origin),
        widthM: STAIR_WIDTH_M,
      });
    }
  }
  return { halls, stairs };
}

/** Tooltip payload for an OSM hall/stair pick, same fields as a dollhouse volume. */
export function overlayHoverVolume(
  overlay: EntranceOverlayFile | null | undefined,
  stationId: string,
  volumeId: string,
): OverlayHoverVolume | null {
  if (!overlay) return null;
  const row = overlay.stations[stationId];
  if (!row) return null;
  if (volumeId.startsWith(OSM_HALL_ID_PREFIX)) {
    const wayId = Number(volumeId.slice(OSM_HALL_ID_PREFIX.length));
    const b = row.buildings.find((x) => x.osmWayId === wayId);
    if (!b) return null;
    return {
      id: volumeId,
      label: b.name?.trim() || "Entrance",
      type: "street",
      level: 0,
    };
  }
  if (volumeId.startsWith(OSM_STAIR_ID_PREFIX)) {
    const wayId = Number(volumeId.slice(OSM_STAIR_ID_PREFIX.length));
    const s = row.stairs.find((x) => x.osmWayId === wayId);
    if (!s) return null;
    return {
      id: volumeId,
      label: "Stairs",
      type: "stairs",
      level: 0,
    };
  }
  return null;
}

export function bakeEntrances(
  osm: OverpassResponse,
  stations: EntranceStationRef[],
  generatedAt: string = new Date().toISOString(),
): EntranceOverlayFile {
  const { nodes, buildingsByNode, stairsByNode } = indexOsm(osm);
  const out: Record<string, StationEntrances> = {};

  for (const station of stations) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const buildings = new Map<number, EntranceBuilding>();
    const stairs = new Map<number, EntranceStairs>();
    for (const node of nodes) {
      if (distanceM(station, node) > ENTRANCE_MATCH_M) continue;
      const building = pickBuildingForEntrance(node.id, buildingsByNode);
      if (building) buildings.set(building.osmWayId, building);
      for (const step of stairsByNode.get(node.id) ?? []) {
        const path = orientStairPath(step.path, {
          incline: step.incline,
          nodeIds: step.nodeIds,
          entranceNodeId: node.id,
        });
        stairs.set(step.osmWayId, {
          osmWayId: step.osmWayId,
          path,
          incline: step.incline,
        });
      }
    }
    if (buildings.size === 0 && stairs.size === 0) continue;
    out[station.id] = {
      buildings: [...buildings.values()].sort((a, b) => a.osmWayId - b.osmWayId),
      stairs: [...stairs.values()].sort((a, b) => a.osmWayId - b.osmWayId),
    };
  }

  return { generatedAt, stations: out };
}
