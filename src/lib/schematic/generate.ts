/**
 * Deterministic invented schematic layout from collapsed lift/platform chains.
 * Used by the build script and tests only — not by the 3D page.
 * Do not import plan/status/topology.
 */

import {
  SCHEMATIC_LINE_LEVEL,
  normalizeSchematicLineId,
} from "./levels";
import type {
  SchematicEdge,
  SchematicEdgeMode,
  SchematicNode,
  SchematicStation,
} from "./types";

export const GENERATED_DISCLAIMER =
  "Schematic — not to scale, not for wayfinding. Visualisation aid, not a blueprint.";

export type GeneratePlatform = {
  id: string;
  lineId: string;
  direction: string;
  label: string;
};

export type GenerateLift = {
  id: string;
  name: string;
  platformIds: string[];
};

export type GenerateStreetChain = {
  platformId: string;
  liftIds: string[];
  access?: "lifts" | "level" | "none";
};

export type GenerateInterchange = {
  fromPlatformId: string;
  toPlatformId: string;
  liftIds: string[];
  access: "lifts" | "level";
};

export type GenerateStationInput = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  platforms: GeneratePlatform[];
  lifts: GenerateLift[];
  platformLiftChains: GenerateStreetChain[];
  interchangeChains: GenerateInterchange[];
};

const PLATFORM_DX = 2;
const LINE_DY = 4.4;
const LEVEL_DX = 6.5;
const LIFT_OFFSET = 1.4;

export function physicalPlatformId(servicePlatformId: string): string {
  const i = servicePlatformId.indexOf("::");
  return i === -1 ? servicePlatformId : servicePlatformId.slice(0, i);
}

export function platformNodeId(physicalId: string): string {
  return `plat-${physicalId}`;
}

function liftNodeId(tflId: string, index: number, used: Set<string>): string {
  const m = tflId.match(/Lift-(\d+)$/i);
  const candidate = m ? `lift-${m[1]}` : `lift-${index + 1}`;
  if (!used.has(candidate)) return candidate;
  let n = index + 1;
  let id = `lift-${n}`;
  while (used.has(id)) {
    n += 1;
    id = `lift-${n}`;
  }
  return id;
}

function lineLevel(
  lineId: string,
  assigned: Map<string, number>,
  used: Set<number>,
): number {
  const known =
    SCHEMATIC_LINE_LEVEL[lineId] ??
    SCHEMATIC_LINE_LEVEL[normalizeSchematicLineId(lineId)];
  if (known != null) return known;
  const hit = assigned.get(lineId);
  if (hit != null) return hit;
  let d = -7;
  while (used.has(d)) d -= 1;
  assigned.set(lineId, d);
  used.add(d);
  return d;
}

function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function offsetToward(
  from: { x: number; y: number },
  toward: { x: number; y: number },
  dist: number,
): { x: number; y: number } {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: from.x + dist, y: from.y };
  return {
    x: from.x + (dx / len) * dist,
    y: from.y + (dy / len) * dist,
  };
}

function snap(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function osmMapUrl(lat: number, lon: number): string {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=18/${la}/${lo}`;
}

export function generateSchematic(input: GenerateStationInput): SchematicStation {
  const unknownAssigned = new Map<string, number>();
  const usedLevels = new Set<number>(Object.values(SCHEMATIC_LINE_LEVEL));

  type PhysPlat = {
    physicalId: string;
    nodeId: string;
    lineId: string;
    label: string;
    serviceIds: string[];
  };

  const physicals = new Map<string, PhysPlat>();
  const sortedPlatforms = [...input.platforms].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const p of sortedPlatforms) {
    const physicalId = physicalPlatformId(p.id);
    const existing = physicals.get(physicalId);
    if (existing) {
      existing.serviceIds.push(p.id);
      continue;
    }
    physicals.set(physicalId, {
      physicalId,
      nodeId: platformNodeId(physicalId),
      lineId: p.lineId,
      label: p.label,
      serviceIds: [p.id],
    });
  }

  const serviceToNode = new Map<string, string>();
  for (const phys of physicals.values()) {
    for (const sid of phys.serviceIds) serviceToNode.set(sid, phys.nodeId);
  }

  const byLine = new Map<string, PhysPlat[]>();
  for (const phys of physicals.values()) {
    const list = byLine.get(phys.lineId) ?? [];
    list.push(phys);
    byLine.set(phys.lineId, list);
  }
  for (const list of byLine.values()) {
    list.sort((a, b) => a.physicalId.localeCompare(b.physicalId));
  }

  const lineIdsAlpha = [...byLine.keys()].sort((a, b) => a.localeCompare(b));
  for (const id of lineIdsAlpha) {
    lineLevel(id, unknownAssigned, usedLevels);
  }
  const lineIds = [...lineIdsAlpha].sort((a, b) => {
    const da = lineLevel(a, unknownAssigned, usedLevels);
    const db = lineLevel(b, unknownAssigned, usedLevels);
    if (da !== db) return db - da;
    return a.localeCompare(b);
  });

  const nodes: SchematicNode[] = [];
  const platformPos = new Map<string, { x: number; y: number; level: number }>();
  const levelSlot = new Map<number, number>();
  let lineIndex = 0;

  for (const lineId of lineIds) {
    const level = lineLevel(lineId, unknownAssigned, usedLevels);
    const slot = levelSlot.get(level) ?? 0;
    levelSlot.set(level, slot + 1);
    const x0 = slot * LEVEL_DX;
    const yLine = snap(lineIndex * LINE_DY);
    lineIndex += 1;
    const plats = byLine.get(lineId) ?? [];
    for (let i = 0; i < plats.length; i++) {
      const phys = plats[i]!;
      const x = snap(x0 + i * PLATFORM_DX);
      platformPos.set(phys.nodeId, { x, y: yLine, level });
      nodes.push({
        id: phys.nodeId,
        type: "platform",
        label: phys.label,
        level,
        x,
        y: yLine,
        lineId: phys.lineId,
      });
    }
  }

  const hallRaw = centroid([...platformPos.values()]);
  const hall = { x: snap(hallRaw.x), y: snap(hallRaw.y) };
  nodes.unshift(
    {
      id: "street",
      type: "street",
      label: "Street",
      level: 0,
      x: hall.x,
      y: hall.y,
    },
    {
      id: "concourse",
      type: "concourse",
      label: "Ticket hall",
      level: -1,
      x: hall.x,
      y: hall.y,
    },
  );

  const sortedLifts = [...input.lifts].sort((a, b) => a.id.localeCompare(b.id));
  const liftNodeByTfl = new Map<string, string>();
  const usedLiftIds = new Set<string>();
  for (let i = 0; i < sortedLifts.length; i++) {
    const lift = sortedLifts[i]!;
    const id = liftNodeId(lift.id, i, usedLiftIds);
    usedLiftIds.add(id);
    liftNodeByTfl.set(lift.id, id);

    const served: { x: number; y: number }[] = [];
    for (const sid of lift.platformIds) {
      const nodeId = serviceToNode.get(sid);
      const pos = nodeId ? platformPos.get(nodeId) : undefined;
      if (pos) served.push(pos);
    }
    const fromChains = input.platformLiftChains.filter((c) =>
      c.liftIds.includes(lift.id),
    );
    for (const c of fromChains) {
      const nodeId = serviceToNode.get(c.platformId);
      const pos = nodeId ? platformPos.get(nodeId) : undefined;
      if (pos) served.push(pos);
    }
    const avg = centroid(served.length ? served : [hall]);
    const posRaw = offsetToward(avg, hall, LIFT_OFFSET);
    const pos = { x: snap(posRaw.x), y: snap(posRaw.y) };
    nodes.push({
      id,
      type: "lift",
      label: lift.name,
      level: -1,
      x: pos.x,
      y: pos.y,
      liftId: lift.id,
    });
  }

  const edges: SchematicEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (
    from: string,
    to: string,
    mode: SchematicEdgeMode,
    liftId?: string,
  ) => {
    if (from === to) return;
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    const key = `${a}\0${b}\0${mode}\0${liftId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(liftId ? { from, to, mode, liftId } : { from, to, mode });
  };

  addEdge("street", "concourse", "level");

  const stitchLifts = (start: string, liftIds: string[], end: string) => {
    const mids = liftIds
      .map((tfl) => liftNodeByTfl.get(tfl))
      .filter((id): id is string => !!id);
    const path = [start, ...mids, end];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]!;
      const to = path[i + 1]!;
      const tfl =
        i < mids.length
          ? liftIds.find((id) => liftNodeByTfl.get(id) === to) ??
            liftIds.find((id) => liftNodeByTfl.get(id) === from)
          : liftIds.find((id) => liftNodeByTfl.get(id) === from);
      if (tfl) addEdge(from, to, "lift", tfl);
      else addEdge(from, to, "level");
    }
  };

  const streetChains = [...input.platformLiftChains].sort((a, b) =>
    a.platformId.localeCompare(b.platformId),
  );
  for (const chain of streetChains) {
    const plat = serviceToNode.get(chain.platformId);
    if (!plat) continue;
    const access = chain.access ?? "none";
    if (access === "lifts" && chain.liftIds.length > 0) {
      const towardStreet = [...chain.liftIds].reverse();
      stitchLifts("concourse", towardStreet, plat);
    } else if (access === "level") {
      addEdge("concourse", plat, "level");
    }
  }

  const interchanges = [...input.interchangeChains].sort((a, b) => {
    const ka = `${a.fromPlatformId}\0${a.toPlatformId}`;
    const kb = `${b.fromPlatformId}\0${b.toPlatformId}`;
    return ka.localeCompare(kb);
  });
  for (const hop of interchanges) {
    const from = serviceToNode.get(hop.fromPlatformId);
    const to = serviceToNode.get(hop.toPlatformId);
    if (!from || !to) continue;
    if (hop.access === "lifts" && hop.liftIds.length > 0) {
      stitchLifts(from, hop.liftIds, to);
    } else if (hop.access === "level") {
      addEdge(from, to, "level");
    }
  }

  return {
    stationId: input.id,
    name: input.name,
    disclaimer: GENERATED_DISCLAIMER,
    entrance: {
      lat: input.lat,
      lon: input.lon,
      source: osmMapUrl(input.lat, input.lon),
      label: "Station location (not a surveyed entrance)",
    },
    notes:
      "Generated schematic. Depth tiers are line conventions, not survey. Connectivity from platformLiftChains and interchangeChains.",
    nodes,
    edges,
  };
}
