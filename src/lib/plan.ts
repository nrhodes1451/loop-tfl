/**
 * Street-to-street step-free journey planner.
 * Phase 1: structural search. Phase 2: live lift check.
 */

import { lineColorForCanvas } from "./tokens";
import { normalizeLineId } from "./tfl/topology";
import type {
  DisruptionPayload,
  InterchangeChain,
  NetworkData,
  NetworkLift,
  NetworkLine,
  NetworkPlatform,
  NetworkRide,
  NetworkStation,
  PlatformLiftChain,
} from "./types";

export const STALE_MS = 15 * 60 * 1000;
const CHANGE_WEIGHT = 10_000;

export type LegKind =
  | "start"
  | "lift"
  | "ride"
  | "change"
  | "arrive"
  | "unreachable";
export type LegStatus = "ok" | "broken" | "unknown" | "none";

export type LegNodeType = "street" | "lift" | "line";

export type LegNode = {
  type: LegNodeType;
  lineId?: string;
  lineColor?: string;
};

export type Leg = {
  kind: LegKind;
  status: LegStatus;
  title: string;
  detail: string;
  stationId?: string;
  lineId?: string;
  lineColor?: string;
  stops?: number;
  liftIds: string[];
  fromNode: LegNode;
  toNode: LegNode;
  chip?: { label: string; tone: "ok" | "break" | "unknown" };
  footnote?: string;
};

export type PlanStatus = "ok" | "break" | "uncertain" | "none";

export type PathNode = {
  stationId: string;
  lineId: string;
  event:
    | { kind: "board"; platformId: string; liftIds: string[] }
    | { kind: "ride" }
    | {
        kind: "change";
        fromLineId: string;
        fromPlatformId: string;
        toPlatformId: string;
        liftIds: string[];
      };
};

export type StructuralPath = {
  fromId: string;
  toId: string;
  nodes: PathNode[];
  /** True when dest has no street access; path still rides there. */
  destUnreachable: boolean;
};

export type PlanResult = {
  status: PlanStatus;
  legs: Leg[];
  breakAt?: string;
  checkedAt?: string;
  liftsChecked: number;
  liftsTotal: number;
  alternative?: { stationId: string; name: string; distanceM: number };
};

export type NetworkIndex = {
  network: NetworkData;
  stationById: Map<string, NetworkStation>;
  lineById: Map<string, NetworkLine>;
  platformsByStationLine: Map<string, NetworkPlatform[]>;
  chainByPlatform: Map<string, PlatformLiftChain>;
  ridesFrom: Map<string, NetworkRide[]>;
  interchanges: Map<string, InterchangeChain[]>;
  liftById: Map<string, NetworkLift>;
};

function sl(stationId: string, lineId: string): string {
  return `${stationId}\0${lineId}`;
}

export function indexNetwork(network: NetworkData): NetworkIndex {
  const stationById = new Map(network.stations.map((s) => [s.id, s]));
  const lineById = new Map(network.lines.map((l) => [l.id, l]));
  for (const l of network.lines) {
    const norm = normalizeLineId(l.id);
    if (!lineById.has(norm)) lineById.set(norm, l);
  }

  const platformsByStationLine = new Map<string, NetworkPlatform[]>();
  for (const p of network.platforms) {
    if (p.lineId === "national-rail") continue;
    const key = sl(p.stationId, p.lineId);
    const list = platformsByStationLine.get(key) ?? [];
    list.push(p);
    platformsByStationLine.set(key, list);
  }

  const chainByPlatform = new Map(
    network.platformLiftChains.map((c) => [c.platformId, c]),
  );
  const liftById = new Map(network.lifts.map((l) => [l.id, l]));

  const ridesFrom = new Map<string, NetworkRide[]>();
  for (const r of network.rides) {
    const key = sl(r.from, r.lineId);
    const list = ridesFrom.get(key) ?? [];
    list.push(r);
    ridesFrom.set(key, list);
  }

  const interchanges = new Map<string, InterchangeChain[]>();
  const platformById = new Map(network.platforms.map((p) => [p.id, p]));
  for (const c of network.interchangeChains) {
    const from = platformById.get(c.fromPlatformId);
    const to = platformById.get(c.toPlatformId);
    if (!from || !to || from.stationId !== to.stationId) continue;
    const key = `${from.stationId}\0${from.lineId}\0${to.lineId}`;
    const list = interchanges.get(key) ?? [];
    list.push(c);
    interchanges.set(key, list);
  }

  return {
    network,
    stationById,
    lineById,
    platformsByStationLine,
    chainByPlatform,
    ridesFrom,
    interchanges,
    liftById,
  };
}

export function lineName(index: NetworkIndex, lineId: string): string {
  return index.lineById.get(lineId)?.name ?? lineId.replace(/-/g, " ");
}

export function lineColor(index: NetworkIndex, lineId: string): string {
  const row = index.lineById.get(lineId);
  return row?.color ?? lineColorForCanvas(lineId);
}

export function stationName(index: NetworkIndex, id: string): string {
  return index.stationById.get(id)?.name ?? id;
}

type AccessiblePlat = {
  platform: NetworkPlatform;
  liftIds: string[];
};

function accessiblePlatforms(
  index: NetworkIndex,
  stationId: string,
  lineId: string,
  direction: "board" | "alight",
): AccessiblePlat[] {
  const plats = index.platformsByStationLine.get(sl(stationId, lineId)) ?? [];
  const out: AccessiblePlat[] = [];
  for (const platform of plats) {
    const chain = index.chainByPlatform.get(platform.id);
    if (chain?.access !== "level" && chain?.access !== "lifts") continue;
    const liftIds =
      chain.access === "lifts"
        ? direction === "board"
          ? [...chain.liftIds].reverse()
          : [...chain.liftIds]
        : [];
    out.push({ platform, liftIds });
  }
  out.sort((a, b) => a.liftIds.length - b.liftIds.length);
  return out;
}

function bestInterchange(
  index: NetworkIndex,
  stationId: string,
  fromLine: string,
  toLine: string,
): InterchangeChain | null {
  const list = index.interchanges.get(`${stationId}\0${fromLine}\0${toLine}`);
  if (!list?.length) return null;
  let best = list[0]!;
  for (const c of list) {
    if (c.liftIds.length < best.liftIds.length) best = c;
  }
  return best;
}

function hasAlight(index: NetworkIndex, stationId: string, lineId: string): boolean {
  return accessiblePlatforms(index, stationId, lineId, "alight").length > 0;
}

type HeapItem = {
  cost: number;
  stationId: string;
  lineId: string;
  boardPlatformId: string;
  boardLiftIds: string[];
  prev: HeapItem | null;
  via: "start" | "ride" | "change";
  change?: {
    fromLineId: string;
    fromPlatformId: string;
    toPlatformId: string;
    liftIds: string[];
  };
};

function heapPush(heap: HeapItem[], item: HeapItem) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p]!.cost <= heap[i]!.cost) break;
    [heap[p], heap[i]] = [heap[i]!, heap[p]!];
    i = p;
  }
}

function heapPop(heap: HeapItem[]): HeapItem | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    const r = l + 1;
    let m = i;
    if (l < heap.length && heap[l]!.cost < heap[m]!.cost) m = l;
    if (r < heap.length && heap[r]!.cost < heap[m]!.cost) m = r;
    if (m === i) break;
    [heap[i], heap[m]] = [heap[m]!, heap[i]!];
    i = m;
  }
  return top;
}

function search(
  index: NetworkIndex,
  fromId: string,
  toId: string,
  requireAlight: boolean,
  exclude: Set<string>,
): HeapItem | null {
  const heap: HeapItem[] = [];
  const best = new Map<string, number>();

  const originLines = new Set<string>();
  for (const p of index.network.platforms) {
    if (p.stationId === fromId && p.lineId !== "national-rail") {
      originLines.add(p.lineId);
    }
  }
  for (const r of index.network.rides) {
    if (r.from === fromId) originLines.add(r.lineId);
  }

  for (const lineId of originLines) {
    const boards = accessiblePlatforms(index, fromId, lineId, "board");
    if (boards.length === 0) continue;
    const b = boards[0]!;
    const item: HeapItem = {
      cost: 0,
      stationId: fromId,
      lineId,
      boardPlatformId: b.platform.id,
      boardLiftIds: b.liftIds,
      prev: null,
      via: "start",
    };
    heapPush(heap, item);
    best.set(sl(fromId, lineId), 0);
  }

  let found: HeapItem | null = null;

  while (heap.length > 0) {
    const cur = heapPop(heap)!;
    const key = sl(cur.stationId, cur.lineId);
    const seen = best.get(key);
    if (seen !== undefined && cur.cost > seen) continue;

    const atDest = cur.stationId === toId;
    const alightOk = !requireAlight || hasAlight(index, cur.stationId, cur.lineId);
    if (atDest && alightOk) {
      found = cur;
      break;
    }

    for (const ride of index.ridesFrom.get(key) ?? []) {
      if (exclude.has(ride.to) && ride.to !== toId) continue;
      const nextCost = cur.cost + 1;
      const nextKey = sl(ride.to, cur.lineId);
      const prevBest = best.get(nextKey);
      if (prevBest !== undefined && prevBest <= nextCost) continue;
      best.set(nextKey, nextCost);
      heapPush(heap, {
        cost: nextCost,
        stationId: ride.to,
        lineId: cur.lineId,
        boardPlatformId: cur.boardPlatformId,
        boardLiftIds: cur.boardLiftIds,
        prev: cur,
        via: "ride",
      });
    }

    if (atDest && requireAlight) {
      // Still allow a change at dest onto an alightable line.
    }

    const linesHere = new Set<string>();
    for (const p of index.network.platforms) {
      if (p.stationId === cur.stationId && p.lineId !== "national-rail") {
        linesHere.add(p.lineId);
      }
    }
    for (const toLine of linesHere) {
      if (toLine === cur.lineId) continue;
      const chain = bestInterchange(index, cur.stationId, cur.lineId, toLine);
      if (!chain) continue;
      const nextCost = cur.cost + CHANGE_WEIGHT;
      const nextKey = sl(cur.stationId, toLine);
      const prevBest = best.get(nextKey);
      if (prevBest !== undefined && prevBest <= nextCost) continue;
      best.set(nextKey, nextCost);
      heapPush(heap, {
        cost: nextCost,
        stationId: cur.stationId,
        lineId: toLine,
        boardPlatformId: cur.boardPlatformId,
        boardLiftIds: cur.boardLiftIds,
        prev: cur,
        via: "change",
        change: {
          fromLineId: cur.lineId,
          fromPlatformId: chain.fromPlatformId,
          toPlatformId: chain.toPlatformId,
          liftIds: chain.liftIds,
        },
      });
    }
  }

  return found;
}

function reconstruct(end: HeapItem): PathNode[] {
  const items: HeapItem[] = [];
  let cur: HeapItem | null = end;
  while (cur) {
    items.push(cur);
    cur = cur.prev;
  }
  items.reverse();
  const nodes: PathNode[] = [];
  for (const item of items) {
    if (item.via === "start") {
      nodes.push({
        stationId: item.stationId,
        lineId: item.lineId,
        event: {
          kind: "board",
          platformId: item.boardPlatformId,
          liftIds: item.boardLiftIds,
        },
      });
    } else if (item.via === "change" && item.change) {
      nodes.push({
        stationId: item.stationId,
        lineId: item.lineId,
        event: {
          kind: "change",
          fromLineId: item.change.fromLineId,
          fromPlatformId: item.change.fromPlatformId,
          toPlatformId: item.change.toPlatformId,
          liftIds: item.change.liftIds,
        },
      });
    } else {
      nodes.push({
        stationId: item.stationId,
        lineId: item.lineId,
        event: { kind: "ride" },
      });
    }
  }
  return nodes;
}

export function findStructuralPath(
  index: NetworkIndex,
  fromId: string,
  toId: string,
  excludeStationIds: string[] = [],
): StructuralPath | null {
  if (fromId === toId) return null;
  const exclude = new Set(excludeStationIds);
  const sf = search(index, fromId, toId, true, exclude);
  if (sf) {
    return { fromId, toId, nodes: reconstruct(sf), destUnreachable: false };
  }
  const partial = search(index, fromId, toId, false, exclude);
  if (partial) {
    const alight = hasAlight(index, partial.stationId, partial.lineId);
    return {
      fromId,
      toId,
      nodes: reconstruct(partial),
      destUnreachable: !alight,
    };
  }
  return null;
}

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function stationHasStepFree(
  index: NetworkIndex,
  stationId: string,
): boolean {
  for (const p of index.network.platforms) {
    if (p.stationId !== stationId || p.lineId === "national-rail") continue;
    const chain = index.chainByPlatform.get(p.id);
    if (chain?.access === "level" || chain?.access === "lifts") return true;
  }
  return false;
}

export function nearestStepFree(
  index: NetworkIndex,
  destId: string,
): { stationId: string; name: string; distanceM: number } | null {
  const dest = index.stationById.get(destId);
  if (!dest) return null;
  let best: { stationId: string; name: string; distanceM: number } | null = null;
  for (const s of index.network.stations) {
    if (s.id === destId) continue;
    if (!stationHasStepFree(index, s.id)) continue;
    const distanceM = haversineMeters(dest, s);
    if (!best || distanceM < best.distanceM) {
      best = { stationId: s.id, name: s.name, distanceM };
    }
  }
  return best;
}

function liftLabel(index: NetworkIndex, ids: string[]): string {
  if (ids.length === 0) return "";
  return ids
    .map((id) => index.liftById.get(id)?.name ?? "Lift")
    .join(", then ");
}

function platformDirection(
  index: NetworkIndex,
  platformId: string,
): string {
  const p = index.network.platforms.find((x) => x.id === platformId);
  return p?.direction ? p.direction.replace(/-/g, " ") : "";
}

function throughCopy(index: NetworkIndex, stationIds: string[], stopCount: number): string {
  const names = stationIds.map((id) => stationName(index, id));
  const stops = `${stopCount} stop${stopCount === 1 ? "" : "s"}`;
  if (names.length === 0) {
    return `${stops}.`;
  }
  if (names.length === 1) return `${stops} through ${names[0]}.`;
  return `${stops} through ${names[0]} and ${names[1]}.`;
}

function lineNode(index: NetworkIndex, lineId: string): LegNode {
  return { type: "line", lineId, lineColor: lineColor(index, lineId) };
}

const STREET_NODE: LegNode = { type: "street" };
const LIFT_NODE: LegNode = { type: "lift" };

type LiftGroup = {
  stationId: string;
  liftIds: string[];
  role: "board" | "change" | "alight";
};

function liftGroups(index: NetworkIndex, path: StructuralPath): LiftGroup[] {
  const groups: LiftGroup[] = [];
  const first = path.nodes[0];
  if (first?.event.kind === "board") {
    groups.push({
      stationId: first.stationId,
      liftIds: first.event.liftIds,
      role: "board",
    });
  }
  for (const n of path.nodes) {
    if (n.event.kind === "change") {
      groups.push({
        stationId: n.stationId,
        liftIds: n.event.liftIds,
        role: "change",
      });
    }
  }
  const last = path.nodes[path.nodes.length - 1];
  if (last && !path.destUnreachable) {
    const alight = accessiblePlatforms(index, last.stationId, last.lineId, "alight")[0];
    groups.push({
      stationId: last.stationId,
      liftIds: alight?.liftIds ?? [],
      role: "alight",
    });
  }
  return groups;
}

function uniqueLiftIds(groups: LiftGroup[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const id of g.liftIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function feedStale(disruptions: DisruptionPayload | null, now: number): boolean {
  if (!disruptions?.ok) return true;
  const t = Date.parse(disruptions.updatedAt);
  if (Number.isNaN(t)) return true;
  return now - t > STALE_MS;
}

type GroupVerdict = "ok" | "broken" | "unknown" | "none";

function groupVerdicts(
  groups: LiftGroup[],
  disruptions: DisruptionPayload | null,
  now: number,
  destUnreachable: boolean,
): { verdicts: GroupVerdict[]; status: PlanStatus; breakAt?: string } {
  if (destUnreachable) {
    return {
      verdicts: groups.map(() => "ok" as const),
      status: "none",
    };
  }

  const stale = feedStale(disruptions, now);
  const verdicts: GroupVerdict[] = [];
  let breakAt: string | undefined;
  let anyUnknown = false;

  for (const g of groups) {
    if (g.liftIds.length === 0) {
      verdicts.push("ok");
      continue;
    }
    if (stale || !disruptions?.ok) {
      verdicts.push("unknown");
      anyUnknown = true;
      continue;
    }
    const hit = g.liftIds.find((id) => disruptions.byLiftId[id]);
    if (hit) {
      verdicts.push("broken");
      breakAt ??= g.stationId;
    } else {
      verdicts.push("ok");
    }
  }

  if (breakAt) return { verdicts, status: "break", breakAt };
  if (anyUnknown) return { verdicts, status: "uncertain" };
  return { verdicts, status: "ok" };
}

function chipFor(
  status: LegStatus,
  disruptions: DisruptionPayload | null,
): Leg["chip"] {
  if (status === "ok") {
    const t = disruptions?.ok
      ? new Date(disruptions.updatedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return {
      label: t ? `Lift in service · ${t}` : "Lift in service",
      tone: "ok",
    };
  }
  if (status === "broken") return { label: "Lift out of service", tone: "break" };
  if (status === "unknown") return { label: "Unknown · live status missing", tone: "unknown" };
  return undefined;
}

function disruptionMessage(
  disruptions: DisruptionPayload | null,
  liftIds: string[],
): string | undefined {
  if (!disruptions?.ok) return undefined;
  for (const id of liftIds) {
    const msg = disruptions.byLiftId[id];
    if (msg) return msg;
  }
  return undefined;
}

export function evaluatePath(
  index: NetworkIndex,
  path: StructuralPath,
  disruptions: DisruptionPayload | null,
  now: number = Date.now(),
): PlanResult {
  const groups = liftGroups(index, path);
  const allLifts = uniqueLiftIds(groups);
  const { verdicts, status, breakAt } = groupVerdicts(
    groups,
    disruptions,
    now,
    path.destUnreachable,
  );

  const groupStatus = new Map<string, GroupVerdict>();
  groups.forEach((g, i) => {
    groupStatus.set(`${g.role}:${g.stationId}`, verdicts[i] ?? "ok");
  });

  const legs: Leg[] = [];
  const first = path.nodes[0]!;
  const last = path.nodes[path.nodes.length - 1]!;
  const fromName = stationName(index, path.fromId);
  const toName = stationName(index, path.toId);

  let brokenSeen = false;
  const mark = (stationId: string, role: LiftGroup["role"]): LegStatus => {
    if (brokenSeen) return "broken";
    const v = groupStatus.get(`${role}:${stationId}`) ?? "ok";
    if (v === "broken") brokenSeen = true;
    if (path.destUnreachable && role === "alight") return "none";
    return v;
  };

  const boardEvent = first.event.kind === "board" ? first.event : null;
  const startLifts = boardEvent?.liftIds ?? [];
  const startDir = boardEvent ? platformDirection(index, boardEvent.platformId) : "";
  const startLine = lineName(index, first.lineId);
  const startLineNode = lineNode(index, first.lineId);

  legs.push({
    kind: "start",
    status: "ok",
    title: `Start · street level at ${fromName}`,
    detail:
      startLifts.length > 0
        ? ""
        : `Level or ramp to ${startLine}${startDir ? ` ${startDir}` : ""} platform.`,
    stationId: first.stationId,
    lineId: first.lineId,
    lineColor: startLineNode.lineColor,
    liftIds: [],
    fromNode: STREET_NODE,
    toNode: startLifts.length > 0 ? LIFT_NODE : startLineNode,
  });

  if (startLifts.length > 0) {
    const st = mark(first.stationId, "board");
    const isBreakHere = groupStatus.get(`board:${first.stationId}`) === "broken";
    const msg = isBreakHere ? disruptionMessage(disruptions, startLifts) : undefined;
    legs.push({
      kind: "lift",
      status: st,
      title: `${liftLabel(index, startLifts)} to ${startLine}${startDir ? ` ${startDir}` : ""} platform.`,
      detail: msg ?? "",
      stationId: first.stationId,
      lineId: first.lineId,
      lineColor: startLineNode.lineColor,
      liftIds: startLifts,
      fromNode: LIFT_NODE,
      toNode: startLineNode,
      chip: chipFor(st, disruptions),
    });
  }

  // Group ride / change segments
  type Seg =
    | { kind: "ride"; lineId: string; stations: string[] }
    | { kind: "change"; node: PathNode };

  const segs: Seg[] = [];
  let rideStations: string[] = [];
  let rideLine = first.lineId;
  for (let i = 1; i < path.nodes.length; i++) {
    const n = path.nodes[i]!;
    if (n.event.kind === "change") {
      if (rideStations.length) {
        segs.push({ kind: "ride", lineId: rideLine, stations: rideStations });
        rideStations = [];
      }
      segs.push({ kind: "change", node: n });
      rideLine = n.lineId;
    } else {
      rideStations.push(n.stationId);
    }
  }
  if (rideStations.length) {
    segs.push({ kind: "ride", lineId: rideLine, stations: rideStations });
  }

  for (const seg of segs) {
    if (seg.kind === "ride") {
      const destStation = seg.stations[seg.stations.length - 1]!;
      const through = seg.stations.slice(0, -1);
      const unreachable = brokenSeen;
      const rideNode = lineNode(index, seg.lineId);
      legs.push({
        kind: unreachable ? "unreachable" : "ride",
        status: unreachable ? "broken" : "ok",
        title: unreachable
          ? `Unreachable · ${lineName(index, seg.lineId)} to ${stationName(index, destStation)}`
          : `Take the ${lineName(index, seg.lineId)} to ${stationName(index, destStation)}`,
        detail: unreachable
          ? `${seg.stations.length} stop${seg.stations.length === 1 ? "" : "s"}. Blocked by the break above.`
          : throughCopy(index, through, seg.stations.length),
        stationId: destStation,
        lineId: seg.lineId,
        lineColor: rideNode.lineColor,
        stops: seg.stations.length,
        liftIds: [],
        fromNode: rideNode,
        toNode: rideNode,
      });
    } else {
      const n = seg.node;
      const ev = n.event;
      if (ev.kind !== "change") continue;
      const alreadyUnreachable = brokenSeen;
      const isBreakHere = groupStatus.get(`change:${n.stationId}`) === "broken";
      const toLine = lineName(index, n.lineId);
      const fromLineNode = lineNode(index, ev.fromLineId);
      const toLineNode = lineNode(index, n.lineId);
      const dir = platformDirection(index, ev.toPlatformId);
      const hasLifts = ev.liftIds.length > 0;

      legs.push({
        kind: alreadyUnreachable ? "unreachable" : "change",
        status: alreadyUnreachable ? "broken" : "ok",
        title: `Change at ${stationName(index, n.stationId)} · to ${toLine}`,
        detail: hasLifts ? "" : `Level interchange to ${toLine}${dir ? ` ${dir}` : ""} platform.`,
        stationId: n.stationId,
        lineId: n.lineId,
        lineColor: toLineNode.lineColor,
        liftIds: [],
        fromNode: fromLineNode,
        toNode: hasLifts ? LIFT_NODE : toLineNode,
      });

      if (hasLifts) {
        const st = mark(n.stationId, "change");
        const msg = isBreakHere ? disruptionMessage(disruptions, ev.liftIds) : undefined;
        legs.push({
          kind: alreadyUnreachable ? "unreachable" : "lift",
          status: st,
          title: isBreakHere
            ? `Change to ${toLine} · interchange lift out of service`
            : `${liftLabel(index, ev.liftIds)} to ${toLine}${dir ? ` ${dir}` : ""} platform.`,
          detail: isBreakHere
            ? msg
              ? `${stationName(index, n.stationId)}. ${msg}`
              : `${stationName(index, n.stationId)}. Interchange lift unavailable. No step-free alternative inside this station.`
            : "",
          stationId: n.stationId,
          lineId: n.lineId,
          lineColor: toLineNode.lineColor,
          liftIds: ev.liftIds,
          fromNode: LIFT_NODE,
          toNode: toLineNode,
          chip: alreadyUnreachable ? undefined : chipFor(isBreakHere ? "broken" : st, disruptions),
        });
      }
    }
  }

  const alightPlats = accessiblePlatforms(index, last.stationId, last.lineId, "alight");
  const alight = alightPlats[0];
  const arriveLifts = alight?.liftIds ?? [];
  const lastLineNode = lineNode(index, last.lineId);

  if (path.destUnreachable) {
    legs.push({
      kind: "arrive",
      status: "none",
      title: `${toName} · no street↔platform step-free access`,
      detail:
        "Lifts serve staff levels only, or there is no street↔platform step-free access. You would be able to board, but not to leave.",
      stationId: last.stationId,
      lineId: last.lineId,
      lineColor: lastLineNode.lineColor,
      liftIds: [],
      fromNode: lastLineNode,
      toNode: STREET_NODE,
    });
  } else {
    const alreadyUnreachable = brokenSeen;
    const isBreakHere = groupStatus.get(`alight:${last.stationId}`) === "broken";

    if (arriveLifts.length > 0) {
      const st = mark(last.stationId, "alight");
      const msg = isBreakHere ? disruptionMessage(disruptions, arriveLifts) : undefined;
      legs.push({
        kind: alreadyUnreachable ? "unreachable" : "lift",
        status: st,
        title: `${liftLabel(index, arriveLifts)} to street.`,
        detail: msg ?? "",
        stationId: last.stationId,
        lineId: last.lineId,
        lineColor: lastLineNode.lineColor,
        liftIds: arriveLifts,
        fromNode: lastLineNode,
        toNode: LIFT_NODE,
        chip: alreadyUnreachable ? undefined : chipFor(st, disruptions),
      });
    }

    const arriveUnreachable = alreadyUnreachable || isBreakHere;
    legs.push({
      kind: arriveUnreachable ? "unreachable" : "arrive",
      status: arriveUnreachable ? "broken" : "ok",
      title: arriveUnreachable
        ? `Not reached · street level at ${toName}`
        : `Arrive · street level at ${toName}`,
      detail: arriveLifts.length > 0 ? "" : "Level or ramp to street.",
      stationId: last.stationId,
      lineId: last.lineId,
      lineColor: lastLineNode.lineColor,
      liftIds: [],
      fromNode: arriveLifts.length > 0 ? LIFT_NODE : lastLineNode,
      toNode: STREET_NODE,
    });
  }

  const checkedAt = disruptions?.updatedAt;
  const stale = feedStale(disruptions, now);
  const liftsChecked = !stale && disruptions?.ok ? allLifts.length : 0;

  const result: PlanResult = {
    status,
    legs,
    breakAt,
    checkedAt,
    liftsChecked,
    liftsTotal: allLifts.length,
  };

  if (status === "none") {
    const alt = nearestStepFree(index, path.toId);
    if (alt) result.alternative = alt;
  }

  return result;
}

export function planJourney(
  index: NetworkIndex,
  fromId: string,
  toId: string,
  disruptions: DisruptionPayload | null,
  options: { excludeStationIds?: string[]; now?: number } = {},
): PlanResult {
  const path = findStructuralPath(
    index,
    fromId,
    toId,
    options.excludeStationIds ?? [],
  );
  if (!path) {
    const alt = nearestStepFree(index, toId);
    return {
      status: "none",
      legs: [],
      liftsChecked: 0,
      liftsTotal: 0,
      alternative: alt ?? undefined,
    };
  }
  return evaluatePath(index, path, disruptions, options.now ?? Date.now());
}

export function formatDistanceM(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export type DisruptedLift = {
  liftId: string;
  liftName: string;
  stationId?: string;
  stationName: string;
  message: string;
};

export type DisruptedStationGroup = {
  stationId?: string;
  stationName: string;
  lifts: DisruptedLift[];
};

function stationForDisruptedLift(
  index: NetworkIndex,
  disruptions: DisruptionPayload,
  liftId: string,
): { id?: string; name: string } {
  const lift = index.liftById.get(liftId);
  if (lift) {
    const station = index.stationById.get(lift.stationId);
    if (station) return { id: station.id, name: station.name };
  }
  for (const [stationId, ids] of Object.entries(disruptions.byStationId)) {
    if (!ids.includes(liftId)) continue;
    const station = index.stationById.get(stationId);
    if (station) return { id: station.id, name: station.name };
    return { id: stationId, name: "Unknown station" };
  }
  return { name: "Unknown station" };
}

export function listDisruptedLifts(
  index: NetworkIndex,
  disruptions: DisruptionPayload,
): DisruptedLift[] {
  const rows: DisruptedLift[] = [];
  for (const [liftId, message] of Object.entries(disruptions.byLiftId)) {
    const station = stationForDisruptedLift(index, disruptions, liftId);
    const lift = index.liftById.get(liftId);
    rows.push({
      liftId,
      liftName: lift?.name || "Lift",
      stationId: station.id,
      stationName: station.name,
      message: message.trim() || "Out of service.",
    });
  }
  rows.sort(
    (a, b) =>
      a.stationName.localeCompare(b.stationName) ||
      a.liftName.localeCompare(b.liftName) ||
      a.liftId.localeCompare(b.liftId),
  );
  return rows;
}

export function groupDisruptedLifts(
  lifts: DisruptedLift[],
): DisruptedStationGroup[] {
  const groups: DisruptedStationGroup[] = [];
  const byKey = new Map<string, DisruptedStationGroup>();
  for (const lift of lifts) {
    const key = lift.stationId ?? lift.stationName;
    let group = byKey.get(key);
    if (!group) {
      group = {
        stationId: lift.stationId,
        stationName: lift.stationName,
        lifts: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lifts.push(lift);
  }
  return groups;
}

export function disruptionStationSummary(
  index: NetworkIndex,
  disruptions: DisruptionPayload | null,
): { count: number; names: string[] } | { error: string } | null {
  if (!disruptions) return null;
  if (!disruptions.ok) {
    return { error: disruptions.error || "Live lift feed unavailable" };
  }
  const lifts = listDisruptedLifts(index, disruptions);
  if (lifts.length === 0) return { count: 0, names: [] };
  const names: string[] = [];
  const seen = new Set<string>();
  for (const lift of lifts) {
    if (seen.has(lift.stationName) || lift.stationName === "Unknown station") {
      continue;
    }
    seen.add(lift.stationName);
    names.push(lift.stationName);
  }
  return { count: lifts.length, names };
}
