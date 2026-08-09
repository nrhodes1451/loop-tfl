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
const PLATFORM_ORBIT = 36;

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
    } else {
      n.fx = null;
      n.fy = null;
    }
  }

  const hasDetail = nodes.some((n) => n.kind !== "station");
  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          if (l.kind === "line") return 0;
          if (l.kind === "ghost") return PLATFORM_ORBIT;
          return 24;
        })
        .strength((l) => (l.kind === "line" ? 0 : 0.65)),
    )
    .force(
      "charge",
      forceManyBody().strength((d) =>
        (d as GraphNode).kind === "station" ? 0 : -28,
      ),
    )
    .force(
      "collide",
      forceCollide<GraphNode>().radius((d) =>
        d.kind === "station" ? 12 : d.kind === "platform" ? 8 : 5,
      ),
    )
    .force(
      "x",
      forceX<GraphNode>()
        .x((d) => {
          if (d.kind === "station") return d.x ?? 0;
          return byId.get(d.parentId ?? "")?.x ?? 0;
        })
        .strength((d) => (d.kind === "station" ? 0 : 0.15)),
    )
    .force(
      "y",
      forceY<GraphNode>()
        .y((d) => {
          if (d.kind === "station") return d.y ?? 0;
          return byId.get(d.parentId ?? "")?.y ?? 0;
        })
        .strength((d) => (d.kind === "station" ? 0 : 0.15)),
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
            x:
              old?.x ??
              (parent?.x ?? 0) + Math.cos(angle) * PLATFORM_ORBIT,
            y:
              old?.y ??
              (parent?.y ?? 0) + Math.sin(angle) * PLATFORM_ORBIT,
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
            const t = (li + 1) / (liftIds.length + 1);
            const oldL = prev.get(nodeId);
            const ln: GraphNode = {
              id: nodeId,
              kind: "lift",
              label: lift?.name ?? lid,
              stationId,
              parentId: stationId,
              x:
                oldL?.x ??
                (pn.x ?? 0) * (1 - t) + (parent?.x ?? 0) * t,
              y:
                oldL?.y ??
                (pn.y ?? 0) * (1 - t) + (parent?.y ?? 0) * t,
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
      s.sim = createGeoSimulation(nodes, links, byId, s.reducedMotion);
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

    function hitTest(sx: number, sy: number): GraphNode | null {
      const { x, y } = screenToWorld(sx, sy);
      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        const r =
          n.kind === "station"
            ? Math.min(13, 6 + (n.lineCount ?? 1) * 1.4) / s.view.k + 4
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

      for (const l of s.links) {
        if (l.kind === "ghost") continue;
        const source = l.source as GraphNode;
        const target = l.target as GraphNode;
        if (source.x == null || target.x == null) continue;
        let x1 = source.x;
        let y1 = source.y!;
        let x2 = target.x;
        let y2 = target.y!;

        if (l.kind === "line") {
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
        } else {
          const st = l.status === "bad" ? colors.disrupted : colors.ok;
          ctx.strokeStyle = st;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = liftStroke;
          ctx.setLineDash(
            l.status === "unknown" ? [4 * inv, 3 * inv] : [],
          );
        }

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      const stationRadius = (n: GraphNode) =>
        Math.min(13, 6 + (n.lineCount ?? 1) * 1.4);
      const stationMaskR = (n: GraphNode) =>
        stationRadius(n) + 5 + Math.max(2.5 * inv, lineStroke * 0.55, ringStroke * 0.55);

      // Hide lines under every station first…
      for (const n of s.nodes) {
        if (n.kind !== "station" || n.x == null || n.y == null) continue;
        ctx.beginPath();
        ctx.arc(n.x, n.y, stationMaskR(n), 0, Math.PI * 2);
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

        const stubFrom = (sx: number, sy: number, dirX: number, dirY: number, node: GraphNode) => {
          const stubLen = Math.min(len * 0.5, stationMaskR(node) + 2 * inv);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + dirX * stubLen, sy + dirY * stubLen);
          ctx.stroke();
        };
        stubFrom(x1, y1, ux, uy, source);
        stubFrom(x2, y2, -ux, -uy, target);
        ctx.globalAlpha = 1;
      }

      for (const n of s.nodes) {
        if (n.x == null || n.y == null) continue;
        if (n.kind === "station") {
          const r = stationRadius(n);
          const agg = stationAggregateStatus(
            n.id,
            s.network,
            s.disruptions,
          );
          const isSel =
            s.selected === n.id || s.expanded.includes(n.id);

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
          ctx.fillStyle = isSel ? "#1a1d23" : colors.white;
          ctx.fill();
          ctx.strokeStyle = isSel ? "#1a1d23" : colors.nodeStroke;
          ctx.lineWidth = ringStroke;
          ctx.stroke();

          const showLabel =
            isSel ||
            s.view.k > 1.2 ||
            ((n.lineCount ?? 0) >= 4 && s.view.k > 0.55);
          if (showLabel) {
            ctx.font = `${isSel ? 600 : 500} ${11.5 * inv}px Inter, system-ui, sans-serif`;
            ctx.fillStyle = isSel ? "#1a1d23" : "#3d4450";
            ctx.textBaseline = "middle";
            ctx.fillText(n.label, n.x + r + 8 * inv, n.y);
          }
        } else if (n.kind === "platform") {
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
            ctx.font = `500 ${9.5 * inv}px Inter, system-ui, sans-serif`;
            ctx.fillStyle =
              st === "bad" || st === "none" ? colors.disrupted : "#5c626c";
            ctx.textBaseline = "middle";
            ctx.fillText(n.label, n.x + r + 5 * inv, n.y);
          }
        } else {
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
          x: old?.x ?? (parent?.x ?? 0) + Math.cos(angle) * PLATFORM_ORBIT,
          y: old?.y ?? (parent?.y ?? 0) + Math.sin(angle) * PLATFORM_ORBIT,
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
          const t = (li + 1) / (liftIds.length + 1);
          const oldL = prev.get(nodeId);
          const ln: GraphNode = {
            id: nodeId,
            kind: "lift",
            label: lift?.name ?? lid,
            stationId,
            parentId: stationId,
            x:
              oldL?.x ??
              (pn.x ?? 0) * (1 - t) + (parent?.x ?? 0) * t,
            y:
              oldL?.y ??
              (pn.y ?? 0) * (1 - t) + (parent?.y ?? 0) * t,
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
