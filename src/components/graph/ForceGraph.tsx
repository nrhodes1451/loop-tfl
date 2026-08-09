"use client";

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useRef } from "react";
import {
  platformStatus,
  stationAggregateStatus,
  statusColor,
} from "@/lib/status";
import { colors, lineColorForCanvas } from "@/lib/tokens";
import type { DisruptionPayload, NetworkData } from "@/lib/types";
import { clamp } from "@/lib/utils";

/** London-centred equirectangular projection into world units. */
const REF_LAT = 51.5074;
const DEG_SCALE = 14000;
const COS_REF = Math.cos((REF_LAT * Math.PI) / 180);

/** Expanded station disc — platforms/lifts nest inside. */
const EXPANDED_STATION_RADIUS = 52;
/** Platform ring on the circumference of the expanded disc. */
const PLATFORM_ORBIT_FRAC = 1.05;
/** Lift ring — half the expanded radius. */
const LIFT_ORBIT_FRAC = 0.5;
/** Street-level hub at the expanded station centre. */
const STREET_RADIUS = 6.5;
const RADIUS_TWEEN_MS = 320;

function streetNodeId(stationId: string) {
  return `${stationId}::street`;
}

type RadiusTween = { from: number; to: number; startMs: number };

function collapsedStationRadius(lineCount = 1) {
  return Math.min(13, 6 + lineCount * 1.4);
}

function expandedStationRadius() {
  return EXPANDED_STATION_RADIUS;
}

function platformOrbit() {
  return EXPANDED_STATION_RADIUS * PLATFORM_ORBIT_FRAC;
}

function liftOrbit() {
  return EXPANDED_STATION_RADIUS * LIFT_ORBIT_FRAC;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

/** TfL physical platform id (before `::line::direction` service suffix). */
function physicalPlatformId(platformId: string) {
  return platformId.split("::")[0] ?? platformId;
}

function normalizeAngle(a: number) {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
}

function angleDiff(a: number, b: number) {
  return Math.abs(normalizeAngle(a - b));
}

function angleTo02Pi(a: number) {
  const n = normalizeAngle(a);
  return n < 0 ? n + Math.PI * 2 : n;
}

/** World-space cardinal targets (y = -lat, so north is -π/2). */
function cardinalTargetAngle(direction: string): number | null {
  const d = direction.trim().toLowerCase();
  if (d === "northbound") return -Math.PI / 2;
  if (d === "southbound") return Math.PI / 2;
  if (d === "eastbound") return 0;
  if (d === "westbound") return Math.PI;
  return null;
}

function findStationByDirectionName(
  direction: string,
  network: NetworkData,
) {
  const d = direction.trim().toLowerCase();
  if (!d || d === "service") return null;
  const exact = network.stations.find((s) => s.name.toLowerCase() === d);
  if (exact) return exact;
  const prefix = network.stations.find((s) => {
    const n = s.name.toLowerCase();
    return d.startsWith(n) || n.startsWith(d);
  });
  if (prefix) return prefix;
  const contained = network.stations
    .filter((s) => d.includes(s.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  return contained[0] ?? null;
}

function directionTargetAngle(
  direction: string,
  fromX: number,
  fromY: number,
  network: NetworkData,
): number | null {
  const cardinal = cardinalTargetAngle(direction);
  if (cardinal != null) return cardinal;
  const dest = findStationByDirectionName(direction, network);
  if (!dest) return null;
  const pos = projectLatLon(dest.lat, dest.lon);
  return Math.atan2(pos.y - fromY, pos.x - fromX);
}

function lineNeighborIds(
  stationId: string,
  lineIds: string[],
  network: NetworkData,
): string[] {
  const lineSet = new Set(lineIds);
  const out: string[] = [];
  for (const e of network.edges) {
    if (!lineSet.has(e.lineId)) continue;
    if (e.from === stationId) out.push(e.to);
    else if (e.to === stationId) out.push(e.from);
  }
  return [...new Set(out)];
}

function bearingToStation(
  fromX: number,
  fromY: number,
  stationId: string,
  network: NetworkData,
  byId: Map<string, GraphNode>,
): number | null {
  const node = byId.get(stationId);
  if (node?.x != null && node.y != null) {
    return Math.atan2(node.y - fromY, node.x - fromX);
  }
  const st = network.stations.find((s) => s.id === stationId);
  if (!st) return null;
  const pos = projectLatLon(st.lat, st.lon);
  return Math.atan2(pos.y - fromY, pos.x - fromX);
}

/** Fan platforms that share nearly the same angle so they don't stack. */
function fanCollidingAngles(
  angles: Map<string, number>,
  eps = 0.15,
  step = 0.2,
) {
  const ids = [...angles.keys()];
  const used = new Set<string>();
  for (const id of ids) {
    if (used.has(id)) continue;
    const base = angles.get(id)!;
    const cluster = ids.filter(
      (other) =>
        !used.has(other) && angleDiff(angles.get(other)!, base) <= eps,
    );
    cluster.forEach((cid) => used.add(cid));
    if (cluster.length <= 1) continue;
    cluster.forEach((cid, i) => {
      const offset = (i - (cluster.length - 1) / 2) * step;
      angles.set(cid, base + offset);
    });
  }
}

function packAnglesInGaps(
  unassigned: string[],
  taken: number[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (unassigned.length === 0) return result;
  if (taken.length === 0) {
    unassigned.forEach((id, i) => {
      result.set(id, (i / Math.max(unassigned.length, 1)) * Math.PI * 2);
    });
    return result;
  }
  const sorted = [...taken.map(angleTo02Pi)].sort((a, b) => a - b);
  let bestStart = 0;
  let bestSize = -1;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[(i + 1) % sorted.length]!;
    const size =
      i === sorted.length - 1 ? b + Math.PI * 2 - a : b - a;
    if (size > bestSize) {
      bestSize = size;
      bestStart = a;
    }
  }
  unassigned.forEach((id, i) => {
    const t = (i + 1) / (unassigned.length + 1);
    result.set(id, bestStart + bestSize * t);
  });
  return result;
}

/** Platforms on the outer ring; one node per lift, linked to every platform it serves. */
function appendExpandedStationDetail(
  stationId: string,
  network: NetworkData,
  disruptions: DisruptionPayload | null,
  nodes: GraphNode[],
  links: GraphLink[],
  byId: Map<string, GraphNode>,
  _prev: Map<string, GraphNode>,
) {
  const platforms = network.platforms.filter((p) => p.stationId === stationId);
  const parent = byId.get(stationId);
  const orbit = platformOrbit();
  const liftR = liftOrbit();
  const px = parent?.x ?? 0;
  const py = parent?.y ?? 0;

  const streetId = streetNodeId(stationId);
  const street: GraphNode = {
    id: streetId,
    kind: "street",
    label: "Street level",
    stationId,
    parentId: stationId,
    x: px,
    y: py,
  };
  nodes.push(street);
  byId.set(streetId, street);

  // Merge multi-line services on the same physical platform.
  const groups = new Map<string, typeof platforms>();
  for (const p of platforms) {
    const phys = physicalPlatformId(p.id);
    const list = groups.get(phys) ?? [];
    list.push(p);
    groups.set(phys, list);
  }
  const merged = [...groups.entries()];

  // Place platforms toward matching line stubs / cardinal destinations.
  const platformAngle = new Map<string, number>();
  const unresolved: string[] = [];

  for (const [physId, members] of merged) {
    const lineIds = [...new Set(members.map((m) => m.lineId))];
    const direction = members[0]?.direction ?? "";
    const target = directionTargetAngle(direction, px, py, network);
    const neighbors = lineNeighborIds(stationId, lineIds, network);

    let angle: number | null = null;
    if (neighbors.length === 1) {
      angle = bearingToStation(px, py, neighbors[0]!, network, byId);
    } else if (neighbors.length > 1) {
      const scored = neighbors
        .map((nid) => {
          const b = bearingToStation(px, py, nid, network, byId);
          if (b == null) return null;
          const score = target != null ? angleDiff(b, target) : 0;
          return { b, score };
        })
        .filter((x): x is { b: number; score: number } => x != null);
      if (target != null && scored.length > 0) {
        scored.sort((a, b) => a.score - b.score);
        angle = scored[0]!.b;
      }
      // Without a direction target and multiple neighbors, leave unresolved.
    } else if (target != null) {
      // No graph edge (e.g. national-rail) — sit on cardinal/destination bearing.
      angle = target;
    }

    if (angle != null) platformAngle.set(physId, angle);
    else unresolved.push(physId);
  }

  fanCollidingAngles(platformAngle);

  const packed = packAnglesInGaps(unresolved, [...platformAngle.values()]);
  for (const [id, ang] of packed) platformAngle.set(id, ang);

  for (const [physId, members] of merged) {
    const angle = platformAngle.get(physId) ?? 0;
    const lineIds = [...new Set(members.map((m) => m.lineId))];
    const first = members[0]!;
    const pn: GraphNode = {
      id: physId,
      kind: "platform",
      label: first.label,
      stationId,
      lineId: lineIds[0],
      lineIds,
      statusPlatformId: first.id,
      parentId: stationId,
      x: px + Math.cos(angle) * orbit,
      y: py + Math.sin(angle) * orbit,
    };
    nodes.push(pn);
    byId.set(pn.id, pn);
  }

  const liftPlatforms = new Map<string, string[]>();
  const chains: { platformId: string; liftIds: string[] }[] = [];
  for (const [physId, members] of merged) {
    const first = members[0]!;
    const chain = network.platformLiftChains.find(
      (c) => c.platformId === first.id,
    );
    const liftIds = chain?.liftIds ?? [];
    chains.push({ platformId: physId, liftIds });
    if (liftIds.length === 0) {
      links.push({ source: physId, target: streetId, kind: "ghost" });
      continue;
    }
    for (const lid of liftIds) {
      const list = liftPlatforms.get(lid) ?? [];
      if (!list.includes(physId)) list.push(physId);
      liftPlatforms.set(lid, list);
    }
  }

  for (const [lid, platformIds] of liftPlatforms) {
    const lift = network.lifts.find((l) => l.id === lid);
    // Circular mean of served platform angles (directional placement).
    let sinSum = 0;
    let cosSum = 0;
    for (const pid of platformIds) {
      const a = platformAngle.get(pid) ?? 0;
      sinSum += Math.sin(a);
      cosSum += Math.cos(a);
    }
    const angle = Math.atan2(sinSum, cosSum);
    if (byId.has(lid)) continue;
    const ln: GraphNode = {
      id: lid,
      kind: "lift",
      label: lift?.name ?? lid,
      stationId,
      parentId: stationId,
      x: px + Math.cos(angle) * liftR,
      y: py + Math.sin(angle) * liftR,
    };
    nodes.push(ln);
    byId.set(lid, ln);
  }

  const seenLinks = new Set<string>();
  const addLiftLink = (
    source: string,
    target: string,
    status: string,
  ) => {
    const key = `${source}|${target}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push({ source, target, kind: "lift", status });
  };

  for (const { platformId, liftIds } of chains) {
    if (liftIds.length === 0) continue;
    const first = liftIds[0]!;
    addLiftLink(
      platformId,
      first,
      disruptions?.byLiftId[first] ? "bad" : "ok",
    );
    for (let i = 0; i < liftIds.length - 1; i++) {
      const next = liftIds[i + 1]!;
      addLiftLink(
        liftIds[i]!,
        next,
        disruptions?.byLiftId[next] ? "bad" : "ok",
      );
    }
    addLiftLink(liftIds[liftIds.length - 1]!, streetId, "ok");
  }
}

type GraphNode = SimulationNodeDatum & {
  id: string;
  kind: "station" | "platform" | "lift" | "street";
  label: string;
  stationId: string;
  lineId?: string;
  /** Lines sharing this physical platform (concentric rings). */
  lineIds?: string[];
  /** Composite NetworkPlatform id for status/chain lookup. */
  statusPlatformId?: string;
  lineCount?: number;
  parentId?: string;
};

type GraphLink = SimulationLinkDatum<GraphNode> & {
  lineId?: string;
  kind: "line" | "lift" | "ghost";
  status?: string;
};

type GraphLabel = {
  text: string;
  color: string;
  font: string;
  nx: number;
  ny: number;
  x: number;
  y: number;
  ix: number;
  iy: number;
  w: number;
  h: number;
  align: "left" | "right";
};

function labelBounds(l: GraphLabel) {
  const left = l.align === "left" ? l.x : l.x - l.w;
  return {
    left,
    right: left + l.w,
    top: l.y - l.h / 2,
    bottom: l.y + l.h / 2,
  };
}

/** Soft spring to preferred spot + pairwise box repulsion. */
function resolveGraphLabels(labels: GraphLabel[], iterations = 18) {
  if (labels.length < 2) return;
  for (let iter = 0; iter < iterations; iter++) {
    for (const l of labels) {
      l.x += (l.ix - l.x) * 0.14;
      l.y += (l.iy - l.y) * 0.14;
    }
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const A = labelBounds(a);
        const B = labelBounds(b);
        const gap = 3;
        const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (ox <= 0 || oy <= 0) continue;
        if (oy <= ox) {
          const push = oy / 2 + gap * 0.5;
          if (a.y <= b.y) {
            a.y -= push;
            b.y += push;
          } else {
            a.y += push;
            b.y -= push;
          }
        } else {
          const push = ox / 2 + gap * 0.5;
          if (a.x <= b.x) {
            a.x -= push;
            b.x += push;
          } else {
            a.x += push;
            b.x -= push;
          }
        }
      }
    }
  }
}

function projectLatLon(lat: number, lon: number) {
  return {
    x: lon * DEG_SCALE * COS_REF,
    y: -lat * DEG_SCALE,
  };
}

function pinStationNode(n: GraphNode, lat: number, lon: number) {
  const pos = projectLatLon(lat, lon);
  n.x = pos.x;
  n.y = pos.y;
  n.fx = pos.x;
  n.fy = pos.y;
  n.vx = 0;
  n.vy = 0;
}

function createGeoSimulation(
  nodes: GraphNode[],
  links: GraphLink[],
  byId: Map<string, GraphNode>,
  reducedMotion: boolean,
) {
  for (const n of nodes) {
    if (n.kind === "station") {
      n.fx = n.x ?? null;
      n.fy = n.y ?? null;
      n.vx = 0;
      n.vy = 0;
    } else if (
      n.kind === "lift" ||
      n.kind === "platform" ||
      n.kind === "street"
    ) {
      // Pin platforms on the outer ring, lifts on r/2, street at centre.
      // Free platforms linked only to a lift can otherwise settle anywhere
      // around that lift — including inside the disc (seen at Tottenham Hale).
      n.fx = n.x ?? null;
      n.fy = n.y ?? null;
      n.vx = 0;
      n.vy = 0;
    } else {
      n.fx = null;
      n.fy = null;
    }
  }

  const hasDetail = nodes.some((n) => n.kind !== "station");
  const orbit = platformOrbit();
  const liftR = liftOrbit();
  const platformLiftGap = Math.max(orbit - liftR, 8);
  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          if (l.kind === "line") return 0;
          if (l.kind === "ghost") return orbit;
          const source =
            typeof l.source === "object"
              ? l.source
              : byId.get(String(l.source));
          const target =
            typeof l.target === "object"
              ? l.target
              : byId.get(String(l.target));
          // Keep lifts on the r/2 ring: street↔lift ≈ r/2, platform↔lift ≈ gap.
          if (
            source?.kind === "station" ||
            target?.kind === "station" ||
            source?.kind === "street" ||
            target?.kind === "street"
          ) {
            return liftR;
          }
          if (source?.kind === "platform" || target?.kind === "platform") {
            return platformLiftGap;
          }
          return 10;
        })
        .strength((l) => (l.kind === "line" ? 0 : 0.2)),
    )
    .force(
      "charge",
      forceManyBody().strength(0),
    )
    .force(
      "collide",
      forceCollide<GraphNode>()
        .radius((d) => {
          if (d.kind === "station") return 8;
          if (d.kind === "platform") return 8;
          if (d.kind === "street") return STREET_RADIUS + 1;
          return 5;
        })
        .strength(0.5),
    )
    .force(
      "x",
      forceX<GraphNode>()
        .x((d) => d.x ?? 0)
        .strength(0),
    )
    .force(
      "y",
      forceY<GraphNode>()
        .y((d) => d.y ?? 0)
        .strength(0),
    )
    .alpha(hasDetail ? 0.25 : 0)
    .alphaDecay(reducedMotion ? 0.25 : 0.12);

  if (reducedMotion || !hasDetail) {
    for (let i = 0; i < 80; i++) sim.tick();
    sim.stop();
  }
  return sim;
}

type Props = {
  network: NetworkData;
  disruptions: DisruptionPayload | null;
  selected: string | null;
  expanded: string[];
  onSelectStation: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  resetToken: number;
  reducedMotion: boolean;
};

export function ForceGraph({
  network,
  disruptions,
  selected,
  expanded,
  onSelectStation,
  onToggleExpand,
  resetToken,
  reducedMotion,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    nodes: [] as GraphNode[],
    links: [] as GraphLink[],
    sim: null as Simulation<GraphNode, GraphLink> | null,
    view: { k: 1, tx: 0, ty: 0 },
    userMoved: false,
    hover: null as GraphNode | null,
    pan: null as { x: number; y: number; tx: number; ty: number } | null,
    pointer: { x: 0, y: 0 },
    size: { w: 0, h: 0, dpr: 1 },
    network,
    disruptions,
    selected,
    expanded,
    reducedMotion,
    onSelectStation,
    onToggleExpand,
    /** Animated visual radius per station (survives collapse until tween ends). */
    radiusNow: new Map<string, number>(),
    radiusTweens: new Map<string, RadiusTween>(),
    nationalRailLogo: null as HTMLImageElement | null,
  });

  // Keep latest props in ref for rAF loop
  useEffect(() => {
    const s = stateRef.current;
    s.network = network;
    s.disruptions = disruptions;
    s.selected = selected;
    s.expanded = expanded;
    s.reducedMotion = reducedMotion;
    s.onSelectStation = onSelectStation;
    s.onToggleExpand = onToggleExpand;
  });

  useEffect(() => {
    const canvasEl = canvasRef.current;
    const wrapEl = wrapRef.current;
    if (!canvasEl || !wrapEl) return;
    const ctx2d = canvasEl.getContext("2d");
    if (!ctx2d) return;
    const canvas = canvasEl;
    const wrap = wrapEl;
    const ctx = ctx2d;
    const s = stateRef.current;

    const nrImg = new Image();
    nrImg.decoding = "async";
    nrImg.src = "/national-rail.svg";
    nrImg.onload = () => {
      s.nationalRailLogo = nrImg;
    };

    function buildGraph() {
      const nodes: GraphNode[] = [];
      const links: GraphLink[] = [];
      const byId = new Map<string, GraphNode>();
      const prev = new Map(s.nodes.map((n) => [n.id, n]));

      for (const st of s.network.stations) {
        const n: GraphNode = {
          id: st.id,
          kind: "station",
          label: st.name,
          stationId: st.id,
          lineCount: st.lineIds.length,
        };
        pinStationNode(n, st.lat, st.lon);
        nodes.push(n);
        byId.set(n.id, n);
      }

      for (const e of s.network.edges) {
        if (!byId.has(e.from) || !byId.has(e.to)) continue;
        links.push({
          source: e.from,
          target: e.to,
          lineId: e.lineId,
          kind: "line",
        });
      }

      for (const stationId of s.expanded) {
        appendExpandedStationDetail(
          stationId,
          s.network,
          s.disruptions,
          nodes,
          links,
          byId,
          prev,
        );
      }

      s.nodes = nodes;
      s.links = links;

      if (s.sim) s.sim.stop();
      s.sim = createGeoSimulation(
        nodes,
        links,
        byId,
        s.reducedMotion,
      );
    }

    function fitView() {
      const stations = s.nodes.filter((n) => n.kind === "station");
      if (stations.length === 0) return;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const n of stations) {
        if (n.x == null || n.y == null) continue;
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x);
        maxY = Math.max(maxY, n.y);
      }
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const { w, h } = s.size;
      const padX = clamp(w * 0.06, 24, 80);
      const padY = clamp(h * 0.08, 48, 100);
      const k = clamp(
        Math.min((w - padX * 2) / bw, (h - padY * 2) / bh),
        0.02,
        8,
      );
      s.view.k = k;
      s.view.tx = w / 2 - ((minX + maxX) / 2) * k;
      s.view.ty = h / 2 - ((minY + maxY) / 2) * k;
    }

    function resize() {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      s.size = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!s.userMoved) fitView();
    }

    function screenToWorld(sx: number, sy: number) {
      return {
        x: (sx - s.view.tx) / s.view.k,
        y: (sy - s.view.ty) / s.view.k,
      };
    }

    function syncRadiusTweens(now: number) {
      const expandedSet = new Set(s.expanded);
      for (const n of s.nodes) {
        if (n.kind !== "station") continue;
        const collapsed = collapsedStationRadius(n.lineCount ?? 1);
        const target = expandedSet.has(n.id)
          ? expandedStationRadius()
          : collapsed;
        const tween = s.radiusTweens.get(n.id);
        let current = s.radiusNow.get(n.id);
        if (current == null) {
          current = collapsed;
          s.radiusNow.set(n.id, current);
        }

        if (tween) {
          if (tween.to !== target) {
            const t = Math.min(1, (now - tween.startMs) / RADIUS_TWEEN_MS);
            const visual =
              tween.from + (tween.to - tween.from) * easeOutCubic(t);
            if (s.reducedMotion) {
              s.radiusTweens.delete(n.id);
              s.radiusNow.set(n.id, target);
            } else {
              s.radiusTweens.set(n.id, {
                from: visual,
                to: target,
                startMs: now,
              });
            }
          }
          continue;
        }

        if (Math.abs(current - target) < 0.05) {
          s.radiusNow.set(n.id, target);
          continue;
        }

        if (s.reducedMotion) {
          s.radiusNow.set(n.id, target);
        } else {
          s.radiusTweens.set(n.id, {
            from: current,
            to: target,
            startMs: now,
          });
        }
      }
    }

    function visualStationRadius(n: GraphNode, now: number) {
      const collapsed = collapsedStationRadius(n.lineCount ?? 1);
      const tween = s.radiusTweens.get(n.id);
      if (!tween) {
        return (
          s.radiusNow.get(n.id) ??
          (s.expanded.includes(n.id) ? expandedStationRadius() : collapsed)
        );
      }
      if (s.reducedMotion) {
        s.radiusTweens.delete(n.id);
        s.radiusNow.set(n.id, tween.to);
        return tween.to;
      }
      const t = Math.min(1, (now - tween.startMs) / RADIUS_TWEEN_MS);
      const r = tween.from + (tween.to - tween.from) * easeOutCubic(t);
      s.radiusNow.set(n.id, r);
      if (t >= 1) s.radiusTweens.delete(n.id);
      return r;
    }

    function hitTest(sx: number, sy: number): GraphNode | null {
      const { x, y } = screenToWorld(sx, sy);
      let best: GraphNode | null = null;
      let bestD = Infinity;
      let bestPri = -1; // prefer platform/lift over station
      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        let r: number;
        if (n.kind === "station") {
          r =
            (s.radiusNow.get(n.id) ??
              collapsedStationRadius(n.lineCount ?? 1)) + 4;
        } else if (n.kind === "platform") {
          const lineIds =
            n.lineIds && n.lineIds.length > 0
              ? n.lineIds
              : n.lineId
                ? [n.lineId]
                : [];
          const otherLineIds = lineIds.filter((id) => id !== "national-rail");
          const hasNationalRail = lineIds.includes("national-rail");
          const ringGap = 2.2;
          r =
            otherLineIds.length > 0
              ? 5.2 +
                (otherLineIds.length - 1) * ringGap +
                (hasNationalRail ? 1.5 : 0)
              : hasNationalRail
                ? 7
                : 5.2;
          r += 4; // padding so the visible disc is easy to hover
        } else if (n.kind === "street") {
          r = STREET_RADIUS + 4;
        } else {
          r = 7;
        }
        const d = Math.hypot(n.x - x, n.y - y);
        if (d > r) continue;
        const pri = n.kind === "station" ? 0 : 1;
        if (pri > bestPri || (pri === bestPri && d < bestD)) {
          best = n;
          bestD = d;
          bestPri = pri;
        }
      }
      return best;
    }

    function draw() {
      const now = performance.now();
      syncRadiusTweens(now);

      const { w, h, dpr } = s.size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = colors.canvas;
      ctx.fillRect(0, 0, w, h);

      // Draw in screen space (no ctx.scale) so arcs tessellate at device
      // resolution and stay round when zoomed in.
      const k = s.view.k;
      const tx = s.view.tx;
      const ty = s.view.ty;
      const sx = (x: number) => x * k + tx;
      const sy = (y: number) => y * k + ty;
      const sr = (r: number) => r * k;

      // Above zoom 1, grow screen-space stroke so lines don't look hairline.
      const strokeBoost = k <= 1 ? 1 : 1 + (k - 1) * 0.55;
      const lineStroke = 2.6 * strokeBoost;
      const liftStroke = 1.6 * strokeBoost;
      const ringStroke = 2 * strokeBoost;
      const haloStroke = 2.6 * strokeBoost;
      const labelSize = 11.5 * strokeBoost;
      const pairGap = Math.max(4.2, 2.6 * strokeBoost + 1.6) / k;
      const pad = (n: number) => n * strokeBoost;

      // Parallel line edge offsets
      const pairCount = new Map<string, number>();
      const pairIndex = new Map<GraphLink, number>();
      for (const l of s.links) {
        if (l.kind !== "line") continue;
        const a = typeof l.source === "object" ? l.source.id : String(l.source);
        const b = typeof l.target === "object" ? l.target.id : String(l.target);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const idx = pairCount.get(key) ?? 0;
        pairIndex.set(l, idx);
        pairCount.set(key, idx + 1);
      }

      // Line edges first (lift links drawn after station discs so they nest).
      for (const l of s.links) {
        if (l.kind !== "line") continue;
        const source = l.source as GraphNode;
        const target = l.target as GraphNode;
        if (source.x == null || target.x == null) continue;
        let x1 = source.x;
        let y1 = source.y!;
        let x2 = target.x;
        let y2 = target.y!;

        const a = source.id;
        const b = target.id;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const total = pairCount.get(key) ?? 1;
        const idx = pairIndex.get(l) ?? 0;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * (idx - (total - 1) / 2) * pairGap;
        const oy = (dx / len) * (idx - (total - 1) / 2) * pairGap;
        x1 += ox;
        y1 += oy;
        x2 += ox;
        y2 += oy;
        ctx.strokeStyle = lineColorForCanvas(l.lineId ?? "");
        ctx.globalAlpha = 0.88;
        ctx.lineWidth = lineStroke;
        ctx.lineCap = "round";
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Mask radius in world units (pad terms are screen → world).
      const stationMaskR = (n: GraphNode, r: number) =>
        r + 5 + Math.max(2.5, lineStroke * 0.55, ringStroke * 0.55) / k;

      // Hide lines under every station first…
      for (const n of s.nodes) {
        if (n.kind !== "station" || n.x == null || n.y == null) continue;
        const r = visualStationRadius(n, now);
        ctx.beginPath();
        ctx.arc(sx(n.x), sy(n.y), sr(stationMaskR(n, r)), 0, Math.PI * 2);
        ctx.fillStyle = colors.canvas;
        ctx.fill();
      }

      // …then restore stubs only for lines that actually stop here, so
      // pass-throughs stay behind while stopping lines meet the station.
      for (const l of s.links) {
        if (l.kind !== "line") continue;
        const source = l.source as GraphNode;
        const target = l.target as GraphNode;
        if (source.x == null || target.x == null) continue;
        let x1 = source.x;
        let y1 = source.y!;
        let x2 = target.x;
        let y2 = target.y!;
        const a = source.id;
        const b = target.id;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const total = pairCount.get(key) ?? 1;
        const idx = pairIndex.get(l) ?? 0;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * (idx - (total - 1) / 2) * pairGap;
        const oy = (dx / len) * (idx - (total - 1) / 2) * pairGap;
        x1 += ox;
        y1 += oy;
        x2 += ox;
        y2 += oy;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;

        ctx.strokeStyle = lineColorForCanvas(l.lineId ?? "");
        ctx.globalAlpha = 0.88;
        ctx.lineWidth = lineStroke;
        ctx.lineCap = "round";
        ctx.setLineDash([]);

        const stubFrom = (
          wx: number,
          wy: number,
          dirX: number,
          dirY: number,
          node: GraphNode,
        ) => {
          const r = visualStationRadius(node, now);
          const stubLen = Math.min(len * 0.5, stationMaskR(node, r) + 2 / k);
          ctx.beginPath();
          ctx.moveTo(sx(wx), sy(wy));
          ctx.lineTo(sx(wx + dirX * stubLen), sy(wy + dirY * stubLen));
          ctx.stroke();
        };
        stubFrom(x1, y1, ux, uy, source);
        stubFrom(x2, y2, -ux, -uy, target);
        ctx.globalAlpha = 1;
      }

      const pendingLabels: GraphLabel[] = [];
      const expandedSet = new Set(s.expanded);

      // Station discs (grown when expanded) under detail nodes.
      for (const n of s.nodes) {
        if (n.kind !== "station" || n.x == null || n.y == null) continue;
        const r = visualStationRadius(n, now);
        const nx = sx(n.x);
        const ny = sy(n.y);
        const rs = sr(r);
        const agg = stationAggregateStatus(n.id, s.network, s.disruptions);
        const isExpanded = expandedSet.has(n.id);
        const isGrowing = r > collapsedStationRadius(n.lineCount ?? 1) + 0.5;
        const isSel =
          s.selected === n.id || isExpanded || isGrowing;

        // Halo
        ctx.beginPath();
        ctx.arc(nx, ny, rs + 5 * k, 0, Math.PI * 2);
        if (agg === "none") {
          ctx.strokeStyle = colors.noInfra;
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([3.5 * strokeBoost, 3 * strokeBoost]);
          ctx.lineWidth = ringStroke;
        } else {
          ctx.strokeStyle = statusColor(agg);
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([]);
          ctx.lineWidth = agg === "bad" ? haloStroke : ringStroke;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(nx, ny, rs, 0, Math.PI * 2);
        ctx.fillStyle = colors.white;
        ctx.fill();
        ctx.strokeStyle = isSel ? "#1a1d23" : colors.nodeStroke;
        ctx.lineWidth = ringStroke;
        ctx.stroke();

        const showLabel =
          isSel ||
          k > 1.2 ||
          ((n.lineCount ?? 0) >= 4 && k > 0.55);
        if (showLabel) {
          const font = `${isSel ? 700 : 600} ${labelSize}px Inter, system-ui, sans-serif`;
          ctx.font = font;
          const color = isSel ? "#1a1d23" : "#3d4450";
          if (isSel) {
            const tw = ctx.measureText(n.label).width;
            const th = labelSize;
            const ix = nx + rs + pad(8);
            const iy = ny - (rs + pad(10));
            pendingLabels.push({
              text: n.label,
              color,
              font,
              nx,
              ny,
              x: ix,
              y: iy,
              ix,
              iy,
              w: tw,
              h: th,
              align: "left",
            });
          } else {
            ctx.fillStyle = color;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(n.label, nx + rs + pad(8), ny);
          }
        }
      }

      // Lift links on top of station discs.
      for (const l of s.links) {
        if (l.kind !== "lift") continue;
        const source = l.source as GraphNode;
        const target = l.target as GraphNode;
        if (source.x == null || target.x == null) continue;
        const st = l.status === "bad" ? colors.disrupted : colors.ok;
        ctx.strokeStyle = st;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = liftStroke;
        ctx.setLineDash(l.status === "unknown" ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(sx(source.x), sy(source.y!));
        ctx.lineTo(sx(target.x), sy(target.y!));
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      // Platforms and lifts inside the expanded disc.
      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        if (n.kind === "platform") {
          const statusId = n.statusPlatformId ?? n.id;
          const st = platformStatus(statusId, s.network, s.disruptions);
          const lineIds =
            n.lineIds && n.lineIds.length > 0
              ? n.lineIds
              : n.lineId
                ? [n.lineId]
                : [];
          const otherLineIds = lineIds.filter((id) => id !== "national-rail");
          const hasNationalRail = lineIds.includes("national-rail");
          const logo = s.nationalRailLogo;
          const logoReady = !!(logo && logo.complete && logo.naturalWidth > 0);

          const ringGap = 2.2;
          // Size: concentric rings for tube/etc lines; NR logo sits in/as the node.
          const r =
            otherLineIds.length > 0
              ? 5.2 +
                (otherLineIds.length - 1) * ringGap +
                (hasNationalRail ? 1.5 : 0)
              : hasNationalRail
                ? 7
                : 5.2;
          const nx = sx(n.x);
          const ny = sy(n.y);
          const rs = sr(r);

          ctx.beginPath();
          ctx.arc(nx, ny, rs, 0, Math.PI * 2);
          ctx.fillStyle = colors.white;
          ctx.fill();

          const strokeLines =
            otherLineIds.length > 0
              ? otherLineIds
              : hasNationalRail && !logoReady
                ? ["national-rail"]
                : !hasNationalRail
                  ? lineIds.length
                    ? lineIds
                    : [""]
                  : [];

          for (let i = 0; i < strokeLines.length; i++) {
            const ri = sr(r - i * ringGap);
            ctx.beginPath();
            ctx.arc(nx, ny, ri, 0, Math.PI * 2);
            if (st === "none") {
              ctx.strokeStyle = lineColorForCanvas(strokeLines[i] ?? "");
              ctx.setLineDash([3 * strokeBoost, 2.5 * strokeBoost]);
            } else if (st === "ok") {
              ctx.strokeStyle = lineColorForCanvas(strokeLines[i] ?? "");
              ctx.setLineDash([]);
            } else {
              ctx.strokeStyle =
                i === 0
                  ? statusColor(st)
                  : lineColorForCanvas(strokeLines[i] ?? "");
              ctx.setLineDash([]);
            }
            ctx.lineWidth = ringStroke;
            ctx.stroke();
          }
          ctx.setLineDash([]);

          if (hasNationalRail && logoReady && logo) {
            const logoW =
              otherLineIds.length > 0
                ? Math.max(6, r * 0.7) * k
                : r * 1.35 * k;
            const logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
            ctx.drawImage(
              logo,
              nx - logoW / 2,
              ny - logoH / 2,
              logoW,
              logoH,
            );
            // Status ring when NR-only (no coloured concentric strokes).
            if (otherLineIds.length === 0 && st !== "ok") {
              ctx.beginPath();
              ctx.arc(nx, ny, rs, 0, Math.PI * 2);
              if (st === "none") {
                ctx.strokeStyle = lineColorForCanvas("national-rail");
                ctx.setLineDash([3 * strokeBoost, 2.5 * strokeBoost]);
              } else {
                ctx.strokeStyle = statusColor(st);
                ctx.setLineDash([]);
              }
              ctx.lineWidth = ringStroke;
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        } else if (n.kind === "lift") {
          const bad = !!s.disruptions?.byLiftId[n.id];
          const unknown = !s.disruptions?.ok;
          const r = 3.4;
          ctx.beginPath();
          ctx.arc(sx(n.x), sy(n.y), sr(r), 0, Math.PI * 2);
          ctx.fillStyle = unknown
            ? colors.unknown
            : bad
              ? colors.disrupted
              : colors.ok;
          ctx.fill();
        } else if (n.kind === "street") {
          const r = STREET_RADIUS;
          const nx = sx(n.x);
          const ny = sy(n.y);
          const rs = sr(r);
          ctx.beginPath();
          ctx.arc(nx, ny, rs, 0, Math.PI * 2);
          ctx.fillStyle = colors.ok;
          ctx.fill();
          // White down arrow (entrance / exit).
          const shaftW = rs * 0.28;
          const shaftH = rs * 0.55;
          const headW = rs * 0.55;
          const headH = rs * 0.42;
          const top = ny - (shaftH + headH) / 2 + rs * 0.05;
          ctx.fillStyle = colors.white;
          ctx.beginPath();
          ctx.moveTo(nx - shaftW / 2, top);
          ctx.lineTo(nx + shaftW / 2, top);
          ctx.lineTo(nx + shaftW / 2, top + shaftH);
          ctx.lineTo(nx + headW / 2, top + shaftH);
          ctx.lineTo(nx, top + shaftH + headH);
          ctx.lineTo(nx - headW / 2, top + shaftH);
          ctx.lineTo(nx - shaftW / 2, top + shaftH);
          ctx.closePath();
          ctx.fill();
        }
      }

      resolveGraphLabels(pendingLabels);

      for (const l of pendingLabels) {
        const dx = l.x - l.nx;
        const dy = l.y - l.ny;
        if (Math.hypot(dx, dy) > 14) {
          const bx = labelBounds(l);
          const tipX =
            l.align === "left" ? bx.left - 2 : bx.right + 2;
          ctx.strokeStyle = "rgba(92,98,108,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(l.nx, l.ny);
          ctx.lineTo(tipX, l.y);
          ctx.stroke();
        }
        ctx.font = l.font;
        ctx.fillStyle = l.color;
        ctx.textAlign = l.align;
        ctx.textBaseline = "middle";
        ctx.fillText(l.text, l.x, l.y);
      }
      ctx.textAlign = "left";

      // Tooltip (already in screen space).
      if (s.hover) {
        const n = s.hover;
        const hx = sx(n.x ?? 0);
        const hy = sy(n.y ?? 0);
        const line1 = n.label;
        let line2 = "";
        if (n.kind === "station") {
          const st = s.network.stations.find((x) => x.id === n.id);
          const lines = (st?.lineIds ?? [])
            .map(
              (id) => s.network.lines.find((l) => l.id === id)?.name ?? id,
            )
            .join(" · ");
          const agg = stationAggregateStatus(
            n.id,
            s.network,
            s.disruptions,
          );
          const word =
            agg === "ok"
              ? "step-free"
              : agg === "bad"
                ? "disrupted"
                : agg === "none"
                  ? "no step-free route"
                  : "no live data";
          line2 = `${word}${lines ? ` · ${lines}` : ""}`;
        } else if (n.kind === "platform") {
          const statusId = n.statusPlatformId ?? n.id;
          const st = platformStatus(statusId, s.network, s.disruptions);
          const word =
            st === "none"
              ? "no step-free route"
              : st === "bad"
                ? "disrupted"
                : st === "unknown"
                  ? "no live data"
                  : "step-free";
          const lineNames = (n.lineIds ?? (n.lineId ? [n.lineId] : []))
            .map(
              (id) => s.network.lines.find((l) => l.id === id)?.name ?? id,
            )
            .join(" · ");
          line2 = `Platform · ${word}${lineNames ? ` · ${lineNames}` : ""}`;
        } else if (n.kind === "street") {
          line2 = "Entrance / exit";
        } else {
          line2 = s.disruptions?.byLiftId[n.id]
            ? "Lift · disrupted"
            : "Lift · operational";
        }
        ctx.font = `600 12.5px Inter, system-ui, sans-serif`;
        const w1 = ctx.measureText(line1).width;
        ctx.font = `400 11.5px Inter, system-ui, sans-serif`;
        const w2 = ctx.measureText(line2).width;
        const tw = Math.max(w1, w2) + 20;
        const th = 46;
        let bx = hx + 14;
        let by = hy - th / 2;
        if (bx + tw > w - 8) bx = hx - tw - 14;
        if (by < 8) by = 8;
        if (by + th > h - 8) by = h - th - 8;
        ctx.fillStyle = "rgba(20,23,29,0.95)";
        ctx.strokeStyle = "#2b3138";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, th, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.textPrimary;
        ctx.font = `600 12.5px Inter, system-ui, sans-serif`;
        ctx.fillText(line1, bx + 10, by + 18);
        ctx.fillStyle = "#8b929c";
        ctx.font = `400 11.5px Inter, system-ui, sans-serif`;
        ctx.fillText(line2, bx + 10, by + 34);
      }
    }

    let raf = 0;
    function loop() {
      draw();
      raf = requestAnimationFrame(loop);
    }

    buildGraph();
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    const fitTimer = window.setTimeout(() => {
      if (!s.userMoved) fitView();
    }, 50);
    raf = requestAnimationFrame(loop);

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      s.pan = {
        x: sx,
        y: sy,
        tx: s.view.tx,
        ty: s.view.ty,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      s.pointer = { x: sx, y: sy };

      if (s.pan) {
        s.userMoved = true;
        s.view.tx = s.pan.tx + (sx - s.pan.x);
        s.view.ty = s.pan.ty + (sy - s.pan.y);
        return;
      }
      s.hover = hitTest(sx, sy);
      canvas.style.cursor = s.hover ? "pointer" : "grab";
    };

    const onPointerUp = (e: PointerEvent) => {
      s.pan = null;
      canvas.style.cursor = s.hover ? "pointer" : "grab";
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) {
        s.onSelectStation(null);
        return;
      }
      if (hit.kind === "station") {
        s.onSelectStation(hit.id);
        s.onToggleExpand(hit.id);
        s.sim?.alpha(0.9).restart();
      } else {
        s.onSelectStation(hit.stationId);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.userMoved = true;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wx = (sx - s.view.tx) / s.view.k;
      const wy = (sy - s.view.ty) / s.view.k;
      const next = clamp(s.view.k * Math.exp(-e.deltaY * 0.0016), 0.05, 12);
      s.view.k = next;
      s.view.tx = sx - wx * next;
      s.view.ty = sy - wy * next;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fitTimer);
      ro.disconnect();
      s.sim?.stop();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset view
  useEffect(() => {
    const s = stateRef.current;
    s.userMoved = false;
    const stations = s.nodes.filter((n) => n.kind === "station");
    if (stations.length === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of stations) {
      if (n.x == null || n.y == null) continue;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const { w, h } = s.size;
    if (!w || !h) return;
    const padX = clamp(w * 0.06, 24, 80);
    const padY = clamp(h * 0.08, 48, 100);
    const k = clamp(
      Math.min((w - padX * 2) / bw, (h - padY * 2) / bh),
      0.02,
      8,
    );
    s.view.k = k;
    s.view.tx = w / 2 - ((minX + maxX) / 2) * k;
    s.view.ty = h / 2 - ((minY + maxY) / 2) * k;
  }, [resetToken]);

  // Rebuild graph when expanded set changes — second effect with full rebuild logic duplicated lightly
  useEffect(() => {
    const s = stateRef.current;
    if (!canvasRef.current) return;

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const byId = new Map<string, GraphNode>();
    const prev = new Map(s.nodes.map((n) => [n.id, n]));

    for (const st of network.stations) {
      const n: GraphNode = {
        id: st.id,
        kind: "station",
        label: st.name,
        stationId: st.id,
        lineCount: st.lineIds.length,
      };
      pinStationNode(n, st.lat, st.lon);
      nodes.push(n);
      byId.set(n.id, n);
    }
    for (const e of network.edges) {
      if (!byId.has(e.from) || !byId.has(e.to)) continue;
      links.push({
        source: e.from,
        target: e.to,
        lineId: e.lineId,
        kind: "line",
      });
    }
    for (const stationId of expanded) {
      appendExpandedStationDetail(
        stationId,
        network,
        disruptions,
        nodes,
        links,
        byId,
        prev,
      );
    }

    s.nodes = nodes;
    s.links = links;
    s.sim?.stop();
    s.sim = createGeoSimulation(nodes, links, byId, reducedMotion);
  }, [expanded, network, disruptions, reducedMotion]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab"
        aria-label="Step-free network graph"
      />
    </div>
  );
}
