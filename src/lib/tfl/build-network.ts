import { LINE_COLORS, MODES, lineColorForCanvas } from "../tokens";
import type { NetworkData, NetworkEdge, NetworkStation } from "../types";
import type { TflLine, TflRouteSequence } from "./client";
import { buildTopology, type TopologyInputs } from "./topology";

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

function cleanStationName(name: string): string {
  return name
    .replace(/\s+Underground Station$/i, "")
    .replace(/\s+DLR Station$/i, "")
    .replace(/\s+Rail Station$/i, "")
    .replace(/\s+Tram Stop$/i, "")
    .replace(/\s+Station$/i, "")
    .trim();
}

export function buildNetworkFromSources(args: {
  lines: TflLine[];
  sequences: TflRouteSequence[];
  topology: TopologyInputs;
}): NetworkData {
  const lineMeta = new Map<string, TflLine>();
  for (const l of args.lines) lineMeta.set(l.id, l);

  const stations = new Map<string, NetworkStation>();
  const edgeKeys = new Set<string>();
  const edges: NetworkEdge[] = [];

  for (const seq of args.sequences) {
    const lineId = seq.lineId;
    for (const branch of seq.stopPointSequences ?? []) {
      const stops = branch.stopPoint ?? [];
      for (const stop of stops) {
        const id = canonicalStationId(stop);
        const existing = stations.get(id);
        if (existing) {
          if (!existing.lineIds.includes(lineId)) existing.lineIds.push(lineId);
          // Prefer non-zero coords
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
      for (let i = 0; i < stops.length - 1; i++) {
        const a = canonicalStationId(stops[i]);
        const b = canonicalStationId(stops[i + 1]);
        if (a === b) continue;
        const [from, to] = a < b ? [a, b] : [b, a];
        const key = `${from}|${to}|${lineId}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({ from, to, lineId });
      }
    }
  }

  const topo = buildTopology(args.topology);

  // Merge topology station names / ensure stations referenced by lifts exist
  for (const [id, name] of topo.stationNameById) {
    const s = stations.get(id);
    if (s) {
      if (name) s.name = cleanStationName(name);
    }
  }

  // Remap platform stationIds that use naptan when graph uses hub
  const naptanToHub = new Map<string, string>();
  for (const seq of args.sequences) {
    for (const branch of seq.stopPointSequences ?? []) {
      for (const stop of branch.stopPoint ?? []) {
        const canon = canonicalStationId(stop);
        if (stop.id !== canon) naptanToHub.set(stop.id, canon);
        if (stop.stationId && stop.stationId !== canon) {
          naptanToHub.set(stop.stationId, canon);
        }
      }
    }
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

  // Keep platforms/lifts only for stations we have in the network graph
  const stationIds = new Set(stations.keys());
  const filteredPlatforms = platforms.filter((p) => stationIds.has(p.stationId));
  const platformIdSet = new Set(filteredPlatforms.map((p) => p.id));
  const filteredChains = topo.platformLiftChains.filter((c) =>
    platformIdSet.has(c.platformId),
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
    platforms: filteredPlatforms,
    lifts: filteredLifts,
    platformLiftChains: filteredChains,
  };
}

export { MODES };
