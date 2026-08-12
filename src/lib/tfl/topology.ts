/**
 * Build Outside→platform lift chains and platform↔platform interchange
 * chains from TfL stationdata-detailed CSVs.
 */

import type { InterchangeChain, PlatformLiftChain } from "../types";

export type CsvRow = Record<string, string>;

export type TopologyInputs = {
  stations: CsvRow[];
  platforms: CsvRow[];
  platformServices: CsvRow[];
  lifts: CsvRow[];
  sameLevelPaths: CsvRow[];
  rampRoutes: CsvRow[];
};

function splitAreas(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeLineId(line: string): string {
  const s = line.trim().toLowerCase().replace(/\s+/g, "-");
  const aliases: Record<string, string> = {
    "hammersmith-and-city": "hammersmith-city",
    elizabeth: "elizabeth-line",
    "tfl-rail": "elizabeth-line",
    "london-overground": "london-overground",
    "waterloo-and-city": "waterloo-city",
  };
  return aliases[s] ?? s;
}

export type BuiltTopology = {
  platforms: {
    id: string;
    stationId: string;
    lineId: string;
    direction: string;
    label: string;
  }[];
  lifts: {
    id: string;
    stationId: string;
    name: string;
    fromAreas: string[];
    toAreas: string[];
    /** Service platform ids adjacent via same-level/ramp to this lift's areas. */
    platformIds: string[];
  }[];
  platformLiftChains: PlatformLiftChain[];
  interchangeChains: InterchangeChain[];
  stationNameById: Map<string, string>;
  outsideByStation: Map<string, string>;
};

export function physicalPlatformId(servicePlatformId: string): string {
  const i = servicePlatformId.indexOf("::");
  return i === -1 ? servicePlatformId : servicePlatformId.slice(0, i);
}

type AdjEdge = { to: string; liftId?: string };

/**
 * BFS between two areas. Collect ordered unique lift IDs along the shortest path.
 * Same-level and ramp edges are free (no lift).
 * Returns `[]` when reachable without lifts; `null` when unreachable.
 */
export function findLiftChain(
  fromId: string,
  toId: string,
  adjacency: Map<string, AdjEdge[]>,
): string[] | null {
  if (fromId === toId) return [];
  const all = findAllLiftChainsFrom(fromId, adjacency);
  return all.get(toId) ?? null;
}

/** Shortest lift chain from `startId` to every reachable area (including itself as `[]`). */
export function findAllLiftChainsFrom(
  startId: string,
  adjacency: Map<string, AdjEdge[]>,
): Map<string, string[]> {
  const reached = new Map<string, string[]>([[startId, []]]);
  type Node = { id: string; lifts: string[] };
  const queue: Node[] = [{ id: startId, lifts: [] }];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of adjacency.get(cur.id) ?? []) {
      if (visited.has(e.to)) continue;
      const nextLifts = e.liftId
        ? cur.lifts.includes(e.liftId)
          ? cur.lifts
          : [...cur.lifts, e.liftId]
        : cur.lifts;
      visited.add(e.to);
      reached.set(e.to, nextLifts);
      queue.push({ id: e.to, lifts: nextLifts });
    }
  }
  return reached;
}

export function buildAdjacency(inputs: TopologyInputs): {
  adjacency: Map<string, AdjEdge[]>;
  freeAdjacency: Map<string, string[]>;
  lifts: Omit<BuiltTopology["lifts"][number], "platformIds">[];
} {
  const adjacency = new Map<string, AdjEdge[]>();
  const freeAdjacency = new Map<string, string[]>();
  const add = (from: string, to: string, liftId?: string) => {
    if (!from || !to) return;
    const list = adjacency.get(from) ?? [];
    list.push({ to, liftId });
    adjacency.set(from, list);
    if (!liftId) {
      const free = freeAdjacency.get(from) ?? [];
      free.push(to);
      freeAdjacency.set(from, free);
    }
  };

  for (const row of inputs.sameLevelPaths) {
    add(row.From ?? row.from, row.To ?? row.to);
  }
  for (const row of inputs.rampRoutes) {
    add(row.From ?? row.from, row.To ?? row.to);
  }

  const lifts: Omit<BuiltTopology["lifts"][number], "platformIds">[] = [];
  for (const row of inputs.lifts) {
    const id = (row.LiftUniqueId ?? "").trim();
    if (!id) continue;
    const stationId = (row.StationUniqueId ?? "").trim();
    const fromAreas = [
      ...splitAreas(row.FromAreas),
      ...splitAreas(row.IntermediateAreas),
    ];
    const toAreas = [
      ...splitAreas(row.ToAreas),
      ...splitAreas(row.IntermediateAreas),
    ];
    // Connect every from/intermediate/to area pair for this lift (undirected)
    const areas = Array.from(new Set([...fromAreas, ...toAreas]));
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        add(areas[i]!, areas[j]!, id);
        add(areas[j]!, areas[i]!, id);
      }
    }
    lifts.push({
      id,
      stationId,
      name: (row.FriendlyName || row.LiftName || id).trim(),
      fromAreas,
      toAreas,
    });
  }

  return { adjacency, freeAdjacency, lifts };
}

/** Platforms reachable from a lift's areas via same-level/ramp only (no other lifts). */
function platformsServedByLift(
  liftAreas: string[],
  freeAdjacency: Map<string, string[]>,
  physicalPlatformIds: Set<string>,
  servicesByPhysical: Map<string, string[]>,
): string[] {
  const servedPhysical = new Set<string>();
  for (const area of liftAreas) {
    if (physicalPlatformIds.has(area)) servedPhysical.add(area);
    for (const nxt of freeAdjacency.get(area) ?? []) {
      if (physicalPlatformIds.has(nxt)) servedPhysical.add(nxt);
    }
  }
  const out: string[] = [];
  for (const phys of servedPhysical) {
    for (const serviceId of servicesByPhysical.get(phys) ?? []) {
      out.push(serviceId);
    }
  }
  return out;
}

export function buildTopology(inputs: TopologyInputs): BuiltTopology {
  const stationNameById = new Map<string, string>();
  const outsideByStation = new Map<string, string>();
  for (const row of inputs.stations) {
    const id = (row.UniqueId ?? "").trim();
    if (!id) continue;
    stationNameById.set(id, (row.Name ?? id).trim());
    const outside = (row.OutsideStationUniqueId ?? "").trim();
    if (outside) outsideByStation.set(id, outside);
  }

  const { adjacency, freeAdjacency, lifts: liftsRaw } = buildAdjacency(inputs);

  const platformsRaw = new Map<
    string,
    { stationId: string; friendlyName: string; direction: string }
  >();
  for (const row of inputs.platforms) {
    const id = (row.UniqueId ?? "").trim();
    if (!id) continue;
    platformsRaw.set(id, {
      stationId: (row.StationUniqueId ?? "").trim(),
      friendlyName: (row.FriendlyName ?? id).trim(),
      direction: (row.CardinalDirection ?? "").trim(),
    });
  }

  const platforms: BuiltTopology["platforms"] = [];
  const platformLiftChains: BuiltTopology["platformLiftChains"] = [];
  const seenPlatformKeys = new Set<string>();
  const servicesByPhysical = new Map<string, string[]>();

  for (const row of inputs.platformServices) {
    const platformId = (row.PlatformUniqueId ?? "").trim();
    const lineId = normalizeLineId(row.Line ?? "");
    if (!platformId || !lineId) continue;
    const meta = platformsRaw.get(platformId);
    if (!meta) continue;

    const direction =
      (row.DirectionTowards ?? "").trim() || meta.direction || "service";
    const key = `${platformId}::${lineId}::${direction}`;
    if (seenPlatformKeys.has(key)) continue;
    seenPlatformKeys.add(key);

    const id = key;
    const label =
      meta.friendlyName || `${lineId} ${direction}`.replace(/-/g, " ");

    platforms.push({
      id,
      stationId: meta.stationId,
      lineId,
      direction,
      label,
    });
    const list = servicesByPhysical.get(platformId) ?? [];
    list.push(id);
    servicesByPhysical.set(platformId, list);

    const outside = outsideByStation.get(meta.stationId);
    const chain = outside
      ? findLiftChain(outside, platformId, adjacency)
      : null;
    // Persist platform → street (reverse of BFS street → platform order).
    const liftIds = chain ? [...chain].reverse() : [];
    platformLiftChains.push({
      platformId: id,
      liftIds,
      access: chain === null ? "none" : chain.length === 0 ? "level" : "lifts",
    });
  }

  const physicalPlatformIds = new Set(platformsRaw.keys());
  const lifts: BuiltTopology["lifts"] = liftsRaw.map((lift) => {
    const areas = Array.from(new Set([...lift.fromAreas, ...lift.toAreas]));
    return {
      ...lift,
      platformIds: platformsServedByLift(
        areas,
        freeAdjacency,
        physicalPlatformIds,
        servicesByPhysical,
      ),
    };
  });

  const interchangeChains = buildInterchangeChains(platforms, adjacency);

  return {
    platforms,
    lifts,
    platformLiftChains,
    interchangeChains,
    stationNameById,
    outsideByStation,
  };
}

function buildInterchangeChains(
  platforms: BuiltTopology["platforms"],
  adjacency: Map<string, AdjEdge[]>,
): InterchangeChain[] {
  const byStation = new Map<string, BuiltTopology["platforms"]>();
  for (const p of platforms) {
    if (p.lineId === "national-rail") continue;
    const list = byStation.get(p.stationId) ?? [];
    list.push(p);
    byStation.set(p.stationId, list);
  }

  const chains: InterchangeChain[] = [];
  for (const plats of byStation.values()) {
    if (plats.length < 2) continue;
    const physicalIds = new Set(plats.map((p) => physicalPlatformId(p.id)));
    const fromPhysical = new Map<string, Map<string, string[]>>();
    for (const phys of physicalIds) {
      fromPhysical.set(phys, findAllLiftChainsFrom(phys, adjacency));
    }

    for (const a of plats) {
      const physA = physicalPlatformId(a.id);
      const reached = fromPhysical.get(physA);
      if (!reached) continue;
      for (const b of plats) {
        if (a.id === b.id || a.lineId === b.lineId) continue;
        const physB = physicalPlatformId(b.id);
        const liftIds = physA === physB ? [] : reached.get(physB);
        if (liftIds === undefined) continue;
        chains.push({
          fromPlatformId: a.id,
          toPlatformId: b.id,
          liftIds,
          access: liftIds.length === 0 ? "level" : "lifts",
        });
      }
    }
  }
  return chains;
}
