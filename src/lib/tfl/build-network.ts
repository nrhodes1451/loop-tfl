import { LINE_COLORS, MODES, lineColorForCanvas } from "../tokens";
import type {
  NetworkData,
  NetworkEdge,
  NetworkRide,
  NetworkStation,
} from "../types";
import type { TflLine, TflRouteSequence, TflStopPoint } from "./client";
import { buildTopology, normalizeLineId, type TopologyInputs } from "./topology";

/** Prefer hub / top-most parent so interchange modes share one node. */
export function canonicalStationId(stop: {
  id: string;
  parentId?: string;
  topMostParentId?: string;
  stationId?: string;
}): string {
  const top = stop.topMostParentId?.trim();
  if (top && top.startsWith("HUB")) return top;
  const parent = stop.parentId?.trim();
  if (parent && parent.startsWith("HUB")) return parent;
  if (top) return top;
  if (parent) return parent;
  return stop.id;
}

export function cleanStationName(name: string): string {
  return name
    .replace(/\s+Underground Station$/i, "")
    .replace(/\s+DLR Station$/i, "")
    .replace(/\s+Rail Station$/i, "")
    .replace(/\s+Tram Stop$/i, "")
    .replace(/\s+Station$/i, "")
    .trim();
}

function dist2(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dy = a.lat - b.lat;
  const dx = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180);
  return dx * dx + dy * dy;
}

/** True if any stop in the sequence resolves to a HUB* id. */
function sequenceHasHubs(seq: TflRouteSequence): boolean {
  for (const branch of seq.stopPointSequences ?? []) {
    for (const stop of branch.stopPoint ?? []) {
      if (canonicalStationId(stop).startsWith("HUB")) return true;
    }
  }
  return false;
}

/**
 * Order stops into a single path via nearest-neighbour from the northernmost
 * stop. Used only when Route/Sequence is empty (e.g. Bakerloo part closure).
 */
export function orderStopsNearestNeighbor<
  T extends { lat: number; lon: number },
>(stops: T[]): T[] {
  if (stops.length <= 1) return [...stops];
  const remaining = new Set(stops.keys());
  let start = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i]!.lat > stops[start]!.lat) start = i;
  }
  const order: T[] = [];
  let cur = start;
  remaining.delete(cur);
  order.push(stops[cur]!);
  while (remaining.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const i of remaining) {
      const d = dist2(stops[cur]!, stops[i]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cur = best;
    remaining.delete(cur);
    order.push(stops[cur]!);
  }
  return order;
}

/** Build a synthetic route sequence from StopPoints when Route/Sequence is empty. */
export function routeSequenceFromStopPoints(
  line: TflLine,
  stops: Array<{
    id: string;
    commonName?: string;
    name?: string;
    lat: number;
    lon: number;
    stationNaptan?: string;
    parentId?: string;
    topMostParentId?: string;
  }>,
): TflRouteSequence {
  const ordered = orderStopsNearestNeighbor(stops);
  const stopPoint: TflStopPoint[] = ordered.map((s) => ({
    id: s.id,
    name: s.commonName ?? s.name ?? s.id,
    lat: s.lat,
    lon: s.lon,
    stationId: s.stationNaptan ?? s.id,
    parentId: s.parentId,
    topMostParentId: s.topMostParentId,
  }));
  return {
    lineId: line.id,
    lineName: line.name,
    mode: line.modeName,
    stopPointSequences: [
      {
        lineId: line.id,
        direction: "all",
        branchId: 0,
        stopPoint,
      },
    ],
    stations: stopPoint,
  };
}

/** Find an existing HUB station with the same cleaned name within ~500m. */
function findNearbyHub(
  stations: Map<string, NetworkStation>,
  name: string,
  lat: number,
  lon: number,
): NetworkStation | undefined {
  const clean = cleanStationName(name);
  const maxD = (0.5 / 111) ** 2;
  let best: NetworkStation | undefined;
  let bestD = maxD;
  for (const s of stations.values()) {
    if (!s.id.startsWith("HUB")) continue;
    if (s.name !== clean) continue;
    const d = dist2(s, { lat, lon });
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function buildNetworkFromSources(args: {
  lines: TflLine[];
  sequences: TflRouteSequence[];
  topology: TopologyInputs;
}): NetworkData {
  const stations = new Map<string, NetworkStation>();
  const edgeKeys = new Set<string>();
  const edges: NetworkEdge[] = [];
  const rideKeys = new Set<string>();
  const rides: NetworkRide[] = [];
  const naptanToHub = new Map<string, string>();

  // Hub-bearing sequences first so StopPoints fallbacks can fold into them.
  const sequences = [...args.sequences].sort(
    (a, b) => Number(sequenceHasHubs(b)) - Number(sequenceHasHubs(a)),
  );

  const rememberAlias = (stop: TflStopPoint, id: string) => {
    if (stop.id !== id) naptanToHub.set(stop.id, id);
    if (stop.stationId && stop.stationId !== id) {
      naptanToHub.set(stop.stationId, id);
    }
  };

  for (const seq of sequences) {
    const lineId = seq.lineId;
    for (const branch of seq.stopPointSequences ?? []) {
      const stops = branch.stopPoint ?? [];
      const resolvedIds: string[] = [];
      for (const stop of stops) {
        const canon = canonicalStationId(stop);
        const hub =
          canon.startsWith("HUB")
            ? null
            : findNearbyHub(stations, stop.name, stop.lat ?? 0, stop.lon ?? 0);
        const id = hub?.id ?? canon;
        rememberAlias(stop, id);
        if (canon.startsWith("HUB") && stop.id !== canon) {
          naptanToHub.set(stop.id, canon);
        }
        resolvedIds.push(id);

        const existing = stations.get(id);
        if (existing) {
          if (!existing.lineIds.includes(lineId)) existing.lineIds.push(lineId);
          if ((!existing.lat || !existing.lon) && stop.lat && stop.lon) {
            existing.lat = stop.lat;
            existing.lon = stop.lon;
          }
        } else {
          stations.set(id, {
            id,
            name: cleanStationName(stop.name),
            lat: stop.lat ?? 0,
            lon: stop.lon ?? 0,
            lineIds: [lineId],
          });
        }
      }
      for (let i = 0; i < resolvedIds.length - 1; i++) {
        const a = resolvedIds[i]!;
        const b = resolvedIds[i + 1]!;
        if (a === b) continue;
        const rideLine = normalizeLineId(lineId);
        const rideKey = `${a}|${b}|${rideLine}`;
        if (!rideKeys.has(rideKey)) {
          rideKeys.add(rideKey);
          rides.push({ from: a, to: b, lineId: rideLine });
        }
        const [from, to] = a < b ? [a, b] : [b, a];
        const key = `${from}|${to}|${lineId}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ from, to, lineId });
      }
    }
  }

  // Final pass: fold any leftover naptan duplicate onto its HUB namesake.
  const maxD = (0.5 / 111) ** 2;
  const mergeInto = new Map<string, string>();
  const list = Array.from(stations.values());
  for (const hub of list) {
    if (!hub.id.startsWith("HUB")) continue;
    for (const other of list) {
      if (other.id === hub.id || other.id.startsWith("HUB")) continue;
      if (other.name !== hub.name) continue;
      if (dist2(hub, other) > maxD) continue;
      mergeInto.set(other.id, hub.id);
      for (const lid of other.lineIds) {
        if (!hub.lineIds.includes(lid)) hub.lineIds.push(lid);
      }
    }
  }
  if (mergeInto.size > 0) {
    for (const [dropId, keepId] of mergeInto) {
      stations.delete(dropId);
      naptanToHub.set(dropId, keepId);
    }
    for (const [from, to] of [...naptanToHub.entries()]) {
      const mapped = mergeInto.get(to);
      if (mapped) naptanToHub.set(from, mapped);
    }
    const seen = new Set<string>();
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i]!;
      const from = mergeInto.get(e.from) ?? e.from;
      const to = mergeInto.get(e.to) ?? e.to;
      if (from === to) {
        edges.splice(i, 1);
        continue;
      }
      const [a, b] = from < to ? [from, to] : [to, from];
      const key = `${a}|${b}|${e.lineId}`;
      if (seen.has(key)) {
        edges.splice(i, 1);
        continue;
      }
      seen.add(key);
      e.from = a;
      e.to = b;
    }
    const seenRides = new Set<string>();
    for (let i = rides.length - 1; i >= 0; i--) {
      const r = rides[i]!;
      const from = mergeInto.get(r.from) ?? r.from;
      const to = mergeInto.get(r.to) ?? r.to;
      if (from === to) {
        rides.splice(i, 1);
        continue;
      }
      const key = `${from}|${to}|${r.lineId}`;
      if (seenRides.has(key)) {
        rides.splice(i, 1);
        continue;
      }
      seenRides.add(key);
      r.from = from;
      r.to = to;
    }
  }

  const topo = buildTopology(args.topology);

  for (const [id, name] of topo.stationNameById) {
    const s = stations.get(id);
    if (s && name) s.name = cleanStationName(name);
  }

  const resolveStation = (id: string) => naptanToHub.get(id) ?? id;

  const platforms = topo.platforms.map((p) => ({
    ...p,
    stationId: resolveStation(p.stationId),
  }));
  const lifts = topo.lifts.map((l) => ({
    ...l,
    stationId: resolveStation(l.stationId),
  }));

  const stationIds = new Set(stations.keys());
  const filteredPlatforms = platforms.filter((p) => stationIds.has(p.stationId));
  const platformIdSet = new Set(filteredPlatforms.map((p) => p.id));
  const filteredChains = topo.platformLiftChains.filter((c) =>
    platformIdSet.has(c.platformId),
  );
  const filteredInterchange = topo.interchangeChains.filter(
    (c) =>
      platformIdSet.has(c.fromPlatformId) && platformIdSet.has(c.toPlatformId),
  );
  const filteredLifts = lifts.filter((l) => stationIds.has(l.stationId));

  const networkLines = args.lines.map((l) => ({
    id: l.id,
    name: l.name,
    color: LINE_COLORS[l.id] ?? lineColorForCanvas(l.id),
    mode: l.modeName,
  }));

  return {
    generatedAt: new Date().toISOString(),
    lines: networkLines,
    stations: Array.from(stations.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    edges,
    rides,
    platforms: filteredPlatforms,
    lifts: filteredLifts,
    platformLiftChains: filteredChains,
    interchangeChains: filteredInterchange,
  };
}

export { MODES };
