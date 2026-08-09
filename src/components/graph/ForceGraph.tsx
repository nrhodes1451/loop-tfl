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
const PLATFORM_ORBIT_FRAC = 1.22;
/** Lift ring — half the expanded radius. */
const LIFT_ORBIT_FRAC = 0.5;
const RADIUS_TWEEN_MS = 320;

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

type GraphNode = SimulationNodeDatum & {
  id: string;
  kind: "station" | "platform" | "lift";
  label: string;
  stationId: string;
  lineId?: string;
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
    } else if (n.kind === "lift") {
      // Pin lifts on the r/2 ring so collide/charge cannot shove them out.
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
          // Keep lifts on the r/2 ring: station↔lift ≈ r/2, platform↔lift ≈ gap.
          if (source?.kind === "station" || target?.kind === "station") {
            return liftR;
          }
          if (source?.kind === "platform" || target?.kind === "platform") {
            return platformLiftGap;
          }
          return 10;
        })
        .strength((l) => (l.kind === "line" ? 0 : 0.75)),
    )
    .force(
      "charge",
      forceManyBody().strength((d) => {
        const n = d as GraphNode;
        if (n.kind === "station") return 0;
        if (n.kind === "platform") return -40;
        return 0; // lifts are pinned on the r/2 ring
      }),
    )
    .force(
      "collide",
      forceCollide<GraphNode>()
        .radius((d) => {
          // Expanded stations must NOT collide at full disc radius — that
          // shoves nested platforms/lifts outside the circle.
          if (d.kind === "station") return 8;
          if (d.kind === "platform") return 8;
          return 5;
        })
        .strength(0.85),
    )
    .force(
      "x",
      forceX<GraphNode>()
        .x((d) => {
          if (d.kind === "station") return d.x ?? 0;
          return byId.get(d.parentId ?? "")?.x ?? 0;
        })
        .strength((d) => (d.kind === "platform" ? 0.09 : 0)),
    )
    .force(
      "y",
      forceY<GraphNode>()
        .y((d) => {
          if (d.kind === "station") return d.y ?? 0;
          return byId.get(d.parentId ?? "")?.y ?? 0;
        })
        .strength((d) => (d.kind === "platform" ? 0.09 : 0)),
    )
    .alpha(hasDetail ? 0.55 : 0)
    .alphaDecay(reducedMotion ? 0.25 : 0.06);

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
        const platforms = s.network.platforms.filter(
          (p) => p.stationId === stationId,
        );
        const parent = byId.get(stationId);
        const orbit = platformOrbit();
        const liftR = liftOrbit();
        platforms.forEach((p, i) => {
          const angle = (i / Math.max(platforms.length, 1)) * Math.PI * 2;
          const old = prev.get(p.id);
          const pn: GraphNode = {
            id: p.id,
            kind: "platform",
            label: p.label,
            stationId,
            lineId: p.lineId,
            parentId: stationId,
            x: old?.x ?? (parent?.x ?? 0) + Math.cos(angle) * orbit,
            y: old?.y ?? (parent?.y ?? 0) + Math.sin(angle) * orbit,
          };
          nodes.push(pn);
          byId.set(pn.id, pn);

          const chain = s.network.platformLiftChains.find(
            (c) => c.platformId === p.id,
          );
          const liftIds = chain?.liftIds ?? [];
          if (liftIds.length === 0) {
            links.push({
              source: p.id,
              target: stationId,
              kind: "ghost",
            });
            return;
          }

          let prevId = p.id;
          liftIds.forEach((lid, li) => {
            const lift = s.network.lifts.find((l) => l.id === lid);
            const nodeId = `${p.id}::${lid}`;
            // Place lifts on the r/2 ring; fan slightly if several share a ray.
            const fan =
              liftIds.length <= 1
                ? 0
                : ((li - (liftIds.length - 1) / 2) * 0.22) / liftIds.length;
            const a = angle + fan;
            const ln: GraphNode = {
              id: nodeId,
              kind: "lift",
              label: lift?.name ?? lid,
              stationId,
              parentId: stationId,
              x: (parent?.x ?? 0) + Math.cos(a) * liftR,
              y: (parent?.y ?? 0) + Math.sin(a) * liftR,
            };
            if (!byId.has(nodeId)) {
              nodes.push(ln);
              byId.set(nodeId, ln);
            }
            links.push({
              source: prevId,
              target: nodeId,
              kind: "lift",
              status: s.disruptions?.byLiftId[lid] ? "bad" : "ok",
            });
            prevId = nodeId;
          });
          links.push({
            source: prevId,
            target: stationId,
            kind: "lift",
            status: "ok",
          });
        });
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
      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        const r =
          n.kind === "station"
            ? (s.radiusNow.get(n.id) ??
                collapsedStationRadius(n.lineCount ?? 1)) /
                s.view.k +
              4
            : n.kind === "platform"
              ? 8 / s.view.k
              : 6 / s.view.k;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d <= r && d < bestD) {
          best = n;
          bestD = d;
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

      ctx.save();
      ctx.translate(s.view.tx, s.view.ty);
      ctx.scale(s.view.k, s.view.k);
      const inv = 1 / s.view.k;
      // Above zoom 1, grow screen-space stroke so lines don't look hairline.
      const strokeBoost = s.view.k <= 1 ? 1 : 1 + (s.view.k - 1) * 0.55;
      const lineStroke = 2.6 * strokeBoost * inv;
      const liftStroke = 1.6 * strokeBoost * inv;
      const ringStroke = 2 * strokeBoost * inv;
      const haloStroke = 2.6 * strokeBoost * inv;
      const labelSize = 11.5 * strokeBoost * inv;
      const platformLabelSize = 9.5 * strokeBoost * inv;
      const pairGap = Math.max(4.2, 2.6 * strokeBoost + 1.6) * inv;

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
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const stationMaskR = (n: GraphNode, r: number) =>
        r + 5 + Math.max(2.5 * inv, lineStroke * 0.55, ringStroke * 0.55);

      // Hide lines under every station first…
      for (const n of s.nodes) {
        if (n.kind !== "station" || n.x == null || n.y == null) continue;
        const r = visualStationRadius(n, now);
        ctx.beginPath();
        ctx.arc(n.x, n.y, stationMaskR(n, r), 0, Math.PI * 2);
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
          sx: number,
          sy: number,
          dirX: number,
          dirY: number,
          node: GraphNode,
        ) => {
          const r = visualStationRadius(node, now);
          const stubLen = Math.min(len * 0.5, stationMaskR(node, r) + 2 * inv);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + dirX * stubLen, sy + dirY * stubLen);
          ctx.stroke();
        };
        stubFrom(x1, y1, ux, uy, source);
        stubFrom(x2, y2, -ux, -uy, target);
        ctx.globalAlpha = 1;
      }

      const pendingLabels: GraphLabel[] = [];
      const nodesById = new Map(s.nodes.map((n) => [n.id, n]));
      const expandedSet = new Set(s.expanded);

      // Station discs (grown when expanded) under detail nodes.
      for (const n of s.nodes) {
        if (n.kind !== "station" || n.x == null || n.y == null) continue;
        const r = visualStationRadius(n, now);
        const agg = stationAggregateStatus(n.id, s.network, s.disruptions);
        const isExpanded = expandedSet.has(n.id);
        const isGrowing = r > collapsedStationRadius(n.lineCount ?? 1) + 0.5;
        const isSel =
          s.selected === n.id || isExpanded || isGrowing;

        // Halo
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
        if (agg === "none") {
          ctx.strokeStyle = colors.noInfra;
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([3.5 * strokeBoost * inv, 3 * strokeBoost * inv]);
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
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.white;
        ctx.fill();
        ctx.strokeStyle = isSel ? "#1a1d23" : colors.nodeStroke;
        ctx.lineWidth = ringStroke;
        ctx.stroke();

        const showLabel =
          isSel ||
          s.view.k > 1.2 ||
          ((n.lineCount ?? 0) >= 4 && s.view.k > 0.55);
        if (showLabel) {
          const font = `${isSel ? 700 : 600} ${labelSize}px Inter, system-ui, sans-serif`;
          ctx.font = font;
          const color = isSel ? "#1a1d23" : "#3d4450";
          if (isSel) {
            const tw = ctx.measureText(n.label).width;
            const th = labelSize;
            const gap = r + 8 * strokeBoost * inv;
            const ix = n.x + gap;
            const iy = n.y - (r + 10 * strokeBoost * inv);
            pendingLabels.push({
              text: n.label,
              color,
              font,
              nx: n.x,
              ny: n.y,
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
            ctx.fillText(n.label, n.x + r + 8 * strokeBoost * inv, n.y);
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
        ctx.setLineDash(l.status === "unknown" ? [4 * inv, 3 * inv] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y!);
        ctx.lineTo(target.x, target.y!);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      // Platforms and lifts inside the expanded disc.
      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        if (n.kind === "platform") {
          const st = platformStatus(n.id, s.network, s.disruptions);
          const r = 5.2;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = colors.white;
          ctx.fill();
          if (st === "none") {
            ctx.strokeStyle = colors.disrupted;
            ctx.setLineDash([3 * strokeBoost * inv, 2.5 * strokeBoost * inv]);
          } else if (st === "ok") {
            ctx.strokeStyle = lineColorForCanvas(n.lineId ?? "");
            ctx.setLineDash([]);
          } else {
            ctx.strokeStyle = statusColor(st);
            ctx.setLineDash([]);
          }
          ctx.lineWidth = ringStroke;
          ctx.stroke();
          ctx.setLineDash([]);
          if (s.view.k > 0.95) {
            const font = `600 ${platformLabelSize}px Inter, system-ui, sans-serif`;
            ctx.font = font;
            const tw = ctx.measureText(n.label).width;
            const th = platformLabelSize;
            const parent = nodesById.get(n.parentId ?? "");
            const pdx = n.x - (parent?.x ?? n.x - 1);
            const pdy = n.y - (parent?.y ?? n.y);
            const ang = Math.atan2(pdy, pdx);
            const align: "left" | "right" =
              Math.cos(ang) >= -0.2 ? "left" : "right";
            const gap = r + 7 * strokeBoost * inv;
            const ix = n.x + Math.cos(ang) * gap;
            const iy = n.y + Math.sin(ang) * gap;
            pendingLabels.push({
              text: n.label,
              color:
                st === "bad" || st === "none" ? colors.disrupted : "#5c626c",
              font,
              nx: n.x,
              ny: n.y,
              x: ix,
              y: iy,
              ix,
              iy,
              w: tw,
              h: th,
              align,
            });
          }
        } else if (n.kind === "lift") {
          const liftId = n.id.split("::").pop() ?? "";
          const bad = !!s.disruptions?.byLiftId[liftId];
          const unknown = !s.disruptions?.ok;
          const r = 3.4;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = unknown
            ? colors.unknown
            : bad
              ? colors.disrupted
              : colors.ok;
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
            l.align === "left" ? bx.left - 2 * inv : bx.right + 2 * inv;
          ctx.strokeStyle = "rgba(92,98,108,0.35)";
          ctx.lineWidth = 1 * inv;
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

      // Tooltip
      if (s.hover) {
        const n = s.hover;
        const sx = (n.x ?? 0) * s.view.k + s.view.tx;
        const sy = (n.y ?? 0) * s.view.k + s.view.ty;
        ctx.restore();
        ctx.save();
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
          const st = platformStatus(n.id, s.network, s.disruptions);
          line2 =
            st === "none"
              ? "Platform · no step-free route"
              : st === "bad"
                ? "Platform · disrupted"
                : "Platform · step-free";
        } else {
          line2 = s.disruptions?.byLiftId[n.id.split("::").pop() ?? ""]
            ? "Lift · disrupted"
            : "Lift · operational";
        }
        ctx.font = `600 12.5px Inter, system-ui, sans-serif`;
        const w1 = ctx.measureText(line1).width;
        ctx.font = `400 11.5px Inter, system-ui, sans-serif`;
        const w2 = ctx.measureText(line2).width;
        const tw = Math.max(w1, w2) + 20;
        const th = 46;
        let bx = sx + 14;
        let by = sy - th / 2;
        if (bx + tw > w - 8) bx = sx - tw - 14;
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
        ctx.restore();
        return;
      }

      ctx.restore();
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
      const platforms = network.platforms.filter((p) => p.stationId === stationId);
      const parent = byId.get(stationId);
      const orbit = platformOrbit();
      const liftR = liftOrbit();
      platforms.forEach((p, i) => {
        const angle = (i / Math.max(platforms.length, 1)) * Math.PI * 2;
        const old = prev.get(p.id);
        const pn: GraphNode = {
          id: p.id,
          kind: "platform",
          label: p.label,
          stationId,
          lineId: p.lineId,
          parentId: stationId,
          x: old?.x ?? (parent?.x ?? 0) + Math.cos(angle) * orbit,
          y: old?.y ?? (parent?.y ?? 0) + Math.sin(angle) * orbit,
        };
        nodes.push(pn);
        byId.set(pn.id, pn);
        const chain = network.platformLiftChains.find((c) => c.platformId === p.id);
        const liftIds = chain?.liftIds ?? [];
        if (liftIds.length === 0) {
          links.push({ source: p.id, target: stationId, kind: "ghost" });
          return;
        }
        let prevId = p.id;
        liftIds.forEach((lid, li) => {
          const lift = network.lifts.find((l) => l.id === lid);
          const nodeId = `${p.id}::${lid}`;
          const fan =
            liftIds.length <= 1
              ? 0
              : ((li - (liftIds.length - 1) / 2) * 0.22) / liftIds.length;
          const a = angle + fan;
          const ln: GraphNode = {
            id: nodeId,
            kind: "lift",
            label: lift?.name ?? lid,
            stationId,
            parentId: stationId,
            x: (parent?.x ?? 0) + Math.cos(a) * liftR,
            y: (parent?.y ?? 0) + Math.sin(a) * liftR,
          };
          if (!byId.has(nodeId)) {
            nodes.push(ln);
            byId.set(nodeId, ln);
          }
          links.push({
            source: prevId,
            target: nodeId,
            kind: "lift",
            status: disruptions?.byLiftId[lid] ? "bad" : "ok",
          });
          prevId = nodeId;
        });
        links.push({ source: prevId, target: stationId, kind: "lift", status: "ok" });
      });
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
