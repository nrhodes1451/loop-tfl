/**
 * OSM National Rail platform bake: parse Overpass ways, match TfL refs.
 * Isolated from routing — do not import plan/status/topology.
 */

import { distanceM, latLonToEnu, type LatLon } from "./geo";
import { undirectedBearingDeg } from "./foi-project";
import { platformNumberFromLabel, type GeneratePlacementPlatform } from "./generate";
import type { OverpassResponse, OverpassWay } from "./entrances";

/** NR platforms at termini sit farther from the TfL stop than LU entrances. */
export const OSM_PLATFORM_MATCH_M = 400;

const OTHER_NETWORK = [
  "london underground",
  "london overground",
  "docklands light railway",
  "elizabeth line",
  "tfl rail",
  "london trams",
  "tramlink",
];

export type OsmPlatformFeature = {
  osmWayId: number;
  kind: "area" | "line";
  ref?: string;
  platformNumbers: number[];
  lat: number;
  lon: number;
  bearingDeg: number;
  underground: boolean;
};

export type OsmStationRef = {
  id: string;
  lat: number;
  lon: number;
};

export type OsmPlatformTarget = {
  id: string;
  lineId: string;
  label: string;
};

type OverpassRelMember = {
  type?: string;
  role?: string;
  geometry?: { lat: number; lon: number }[];
};

type OverpassRelation = {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: OverpassRelMember[];
};

type GeomPoint = { lat: number; lon: number };

export function osmPlatformsQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const { south, west, north, east } = bbox;
  return `[out:json][timeout:180];
(
  way["railway"="platform"](${south},${west},${north},${east});
  way["public_transport"="platform"]["train"="yes"](${south},${west},${north},${east});
  rel["railway"="platform"](${south},${west},${north},${east});
);
out geom;
`;
}

export function isNationalRailPlatform(
  tags: Record<string, string> | undefined,
): boolean {
  if (!tags) return false;
  if (isOtherMode(tags)) return false;
  const hay = `${tags.network ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  if (hay.includes("national rail") || hay.includes("network rail")) return true;
  if (tags.train === "yes") return true;
  return false;
}

export function parsePlatformRef(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  const parts = raw.split(/[;,/&]+|(?:\s+and\s+)/i);
  for (const part of parts) {
    const m =
      part.match(/(?:platform|plat)\s*0*(\d+)/i) ?? part.match(/0*(\d+)/);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n <= 0 || out.includes(n)) continue;
    out.push(n);
  }
  return out;
}

export function isOsmPlatformUnderground(
  tags: Record<string, string> | undefined,
): boolean {
  if (!tags) return false;
  const loc = (tags.location ?? "").toLowerCase();
  if (loc === "underground" || loc === "underwater") return true;
  if (tags.tunnel === "yes" || tags.covered === "yes") return true;
  const layer = Number.parseFloat(tags.layer ?? "");
  if (Number.isFinite(layer) && layer < 0) return true;
  const level = tags.level ?? "";
  if (level.startsWith("-")) return true;
  return false;
}

/** Undirected compass bearing of the long axis. Points are [east, north] metres. */
export function longAxisBearingDeg(points: [number, number][]): number | null {
  const open = dropClosingDuplicate(points);
  if (open.length < 2) return null;
  let cx = 0;
  let cz = 0;
  for (const p of open) {
    cx += p[0];
    cz += p[1];
  }
  cx /= open.length;
  cz /= open.length;
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const p of open) {
    const dx = p[0] - cx;
    const dz = p[1] - cz;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }
  const trace = xx + zz;
  if (trace < 1e-12) return null;
  const det = xx * zz - xz * xz;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + disc;
  let east: number;
  let north: number;
  if (Math.abs(xz) > 1e-12) {
    east = xz;
    north = l1 - xx;
  } else if (xx >= zz) {
    east = 1;
    north = 0;
  } else {
    east = 0;
    north = 1;
  }
  if (Math.hypot(east, north) < 1e-12) return null;
  return undirectedBearingDeg((Math.atan2(east, north) * 180) / Math.PI);
}

export function parseOsmPlatforms(osm: OverpassResponse): OsmPlatformFeature[] {
  const out: OsmPlatformFeature[] = [];
  for (const el of osm.elements ?? []) {
    if (el.type === "way") {
      const way = el as OverpassWay;
      const feat = featureFromGeom(way.id, way.tags, way.geometry ?? []);
      if (feat) out.push(feat);
      continue;
    }
    if (el.type !== "relation") continue;
    const rel = el as OverpassRelation;
    const geom = ringFromRelation(rel);
    if (!geom) continue;
    const feat = featureFromGeom(rel.id, rel.tags, geom);
    if (feat) out.push(feat);
  }
  return out.sort((a, b) => a.osmWayId - b.osmWayId);
}

export function matchOsmNationalRailPlacements(
  features: OsmPlatformFeature[],
  station: OsmStationRef,
  platforms: OsmPlatformTarget[],
  undergroundDepthM: number,
): GeneratePlacementPlatform[] {
  const tflNumbers = new Set<number>();
  for (const p of platforms) {
    if (p.lineId !== "national-rail") continue;
    const n = platformNumberFromLabel(p.label, p.id);
    if (n != null) tflNumbers.add(n);
  }
  if (tflNumbers.size === 0) return [];

  const origin: LatLon = { lat: station.lat, lon: station.lon };
  type Cand = OsmPlatformFeature & { distM: number };
  const nearby: Cand[] = [];
  for (const f of features) {
    const distM = distanceM({ lat: f.lat, lon: f.lon }, origin);
    if (distM > OSM_PLATFORM_MATCH_M) continue;
    if (!f.platformNumbers.some((n) => tflNumbers.has(n))) continue;
    nearby.push({ ...f, distM });
  }
  nearby.sort(
    (a, b) =>
      (a.kind === "area" ? 0 : 1) - (b.kind === "area" ? 0 : 1) ||
      a.distM - b.distM ||
      a.osmWayId - b.osmWayId,
  );

  const used = new Set<number>();
  const placements: GeneratePlacementPlatform[] = [];
  for (const f of nearby) {
    const nums = f.platformNumbers.filter(
      (n) => tflNumbers.has(n) && !used.has(n),
    );
    if (nums.length === 0) continue;
    for (const n of nums) used.add(n);
    const enu = latLonToEnu(f.lat, f.lon, origin);
    placements.push({
      lineId: "national-rail",
      platformNumbers: nums,
      eastM: enu.x,
      northM: enu.z,
      bearingDeg: f.bearingDeg,
      source: "osm",
      osmWayId: f.osmWayId,
      osmRef: f.ref,
      depthM: f.underground ? undergroundDepthM : 0,
      caption: f.ref ? `OSM platform ${f.ref}` : "OSM platform",
    });
  }
  return placements.sort(
    (a, b) => (a.osmWayId ?? 0) - (b.osmWayId ?? 0),
  );
}

function isOtherMode(tags: Record<string, string>): boolean {
  if (tags.subway === "yes") return true;
  const railway = (tags.railway ?? "").toLowerCase();
  if (
    railway === "subway" ||
    railway === "light_rail" ||
    railway === "tram" ||
    railway === "monorail"
  ) {
    return true;
  }
  const hay = `${tags.network ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  if (hay.includes("dlr") && !hay.includes("national rail")) return true;
  return OTHER_NETWORK.some((n) => hay.includes(n));
}

function featureFromGeom(
  id: number,
  tags: Record<string, string> | undefined,
  geom: GeomPoint[],
): OsmPlatformFeature | null {
  if (!isNationalRailPlatform(tags)) return null;
  if (geom.length < 2) return null;
  const enu = pathToEnu(geom);
  const bearing = longAxisBearingDeg(enu);
  if (bearing == null) return null;
  const kind: "area" | "line" = isClosed(geom) ? "area" : "line";
  const verts = isClosed(geom) ? geom.slice(0, -1) : geom;
  let lat = 0;
  let lon = 0;
  for (const p of verts) {
    lat += p.lat;
    lon += p.lon;
  }
  const n = Math.max(1, verts.length);
  const ref = tags?.ref?.trim() || undefined;
  return {
    osmWayId: id,
    kind,
    ref,
    platformNumbers: parsePlatformRef(ref),
    lat: lat / n,
    lon: lon / n,
    bearingDeg: bearing,
    underground: isOsmPlatformUnderground(tags),
  };
}

function pathToEnu(geom: GeomPoint[]): [number, number][] {
  const origin: LatLon = { lat: geom[0]!.lat, lon: geom[0]!.lon };
  return geom.map((p) => {
    const e = latLonToEnu(p.lat, p.lon, origin);
    return [e.x, e.z];
  });
}

function isClosed(geom: GeomPoint[]): boolean {
  if (geom.length < 4) return false;
  const a = geom[0]!;
  const b = geom[geom.length - 1]!;
  return a.lat === b.lat && a.lon === b.lon;
}

function dropClosingDuplicate(points: [number, number][]): [number, number][] {
  if (points.length < 2) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (a[0] === b[0] && a[1] === b[1]) return points.slice(0, -1);
  return points;
}

function samePoint(a: GeomPoint, b: GeomPoint): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

function ringFromRelation(rel: OverpassRelation): GeomPoint[] | null {
  const outers = (rel.members ?? []).filter(
    (m) =>
      m.type === "way" &&
      (m.role === "outer" || m.role === "" || m.role == null),
  );
  const pts: GeomPoint[] = [];
  for (const m of outers) {
    const g = m.geometry;
    if (!g?.length) continue;
    if (pts.length === 0) {
      pts.push(...g);
      continue;
    }
    const last = pts[pts.length - 1]!;
    const first = g[0]!;
    const end = g[g.length - 1]!;
    if (samePoint(last, first)) pts.push(...g.slice(1));
    else if (samePoint(last, end)) pts.push(...[...g].reverse().slice(1));
    else pts.push(...g);
  }
  return pts.length >= 2 ? pts : null;
}
