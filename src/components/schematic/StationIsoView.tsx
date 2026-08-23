"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  comparePaintOrder,
  DEFAULT_ISO,
  dropIso,
  isoBoxTop,
  pointsToPath,
  projectIso,
  type IsoPoint,
} from "@/lib/schematic/iso";
import type {
  SchematicNode,
  SchematicStation,
} from "@/lib/schematic/types";
import { hoverDepthLabel } from "@/lib/schematic/foi-layout";
import { LINE_COLORS } from "@/lib/tokens";
import { platformPlanSize } from "@/lib/schematic/scene";

type ViewBox = { x: number; y: number; w: number; h: number };

const ISO = DEFAULT_ISO;

const SUBSURFACE_STRIPES = [
  LINE_COLORS.circle,
  LINE_COLORS["hammersmith-city"],
  LINE_COLORS.metropolitan,
] as const;

type Footprint = { wx: number; wy: number; h: number };

function footprint(node: SchematicNode, nodes: SchematicNode[]): Footprint {
  switch (node.type) {
    case "platform":
      return { ...platformPlanSize(node, nodes), h: 11 };
    case "concourse":
      return { wx: 2.05, wy: 1.55, h: 14 };
    case "street":
      return { wx: 1.95, wy: 1.45, h: 8 };
    case "lift":
    case "shaft":
      return { wx: 0.4, wy: 0.4, h: 9 };
  }
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(hex: string, toward: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  return hexOf(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function platformFill(node: SchematicNode): string {
  if (node.lineId === "northern") return "#1c1c1c";
  if (node.lineId) return LINE_COLORS[node.lineId] ?? "#A0A5A9";
  return "#c5c9d0";
}

function slabFill(node: SchematicNode): string {
  if (node.type === "platform") return platformFill(node);
  if (node.type === "street") return "#eceef1";
  if (node.type === "concourse") return "#d5d9e0";
  return "#c8ccd3";
}

function shortLabel(node: SchematicNode): string {
  if (node.type === "platform") {
    const n = node.id.replace("plat-", "");
    const dir = node.label.includes("westbound")
      ? "WB"
      : node.label.includes("eastbound")
        ? "EB"
        : node.label.includes("northbound")
          ? "NB"
          : node.label.includes("southbound")
            ? "SB"
            : "";
    return `${n} ${dir}`.trim();
  }
  if (node.type === "lift") return node.label;
  if (node.type === "street") return "Street";
  const halls: Record<string, string> = {
    wth: "West TH",
    nth: "Northern TH",
    tth: "Tube TH",
    npe: "NPE",
    npn: "NPN",
  };
  return halls[node.id] ?? node.label;
}

function centroid(points: IsoPoint[]): IsoPoint {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

function computeViewBox(station: SchematicStation): ViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (p: IsoPoint) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const node of station.nodes) {
    const fp = footprint(node, station.nodes);
    const top = isoBoxTop(node.x, node.y, fp.wx, fp.wy, node.level, ISO);
    for (const p of top) {
      include(p);
      include(dropIso(p, fp.h));
    }
  }
  const pad = 80;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function liftNeighborhood(
  station: SchematicStation,
  liftId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const node of station.nodes) {
    if (node.liftId === liftId) ids.add(node.id);
  }
  for (const edge of station.edges) {
    if (edge.liftId === liftId) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
  }
  return ids;
}

function clientToViewBox(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  vb: ViewBox,
): IsoPoint {
  return {
    x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
    y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
  };
}

type SlabProps = {
  node: SchematicNode;
  nodes: SchematicNode[];
  dimmed: boolean;
  highlighted: boolean;
  hovered: boolean;
  onEnter: (id: string) => void;
  onLeave: (id: string) => void;
  onClick: (node: SchematicNode) => void;
};

function IsoSlab({
  node,
  nodes,
  dimmed,
  highlighted,
  hovered,
  onEnter,
  onLeave,
  onClick,
}: SlabProps) {
  const fp = footprint(node, nodes);
  const top = isoBoxTop(node.x, node.y, fp.wx, fp.wy, node.level, ISO);
  const bot = top.map((p) => dropIso(p, fp.h));
  const south = [top[0]!, top[1]!, bot[1]!, bot[0]!];
  const east = [top[1]!, top[2]!, bot[2]!, bot[1]!];
  const fill = slabFill(node);
  const sideL = mix(fill, "#000000", 0.28);
  const sideR = mix(fill, "#000000", 0.16);
  const stroke = highlighted || hovered ? "#14171c" : mix(fill, "#000000", 0.42);
  const label = shortLabel(node);
  const c = centroid(top);
  const textFill = luminance(fill) > 0.55 ? "#14171c" : "#ffffff";
  const stripe =
    node.type === "platform" && node.lineId === "circle";

  return (
    <g
      opacity={dimmed ? 0.28 : 1}
      style={{ cursor: node.type === "lift" ? "pointer" : "default" }}
      onPointerEnter={() => onEnter(node.id)}
      onPointerLeave={() => onLeave(node.id)}
      onPointerDown={(e) => {
        e.stopPropagation();
        onClick(node);
      }}
    >
      <path d={pointsToPath(south)} fill={sideL} stroke={stroke} strokeWidth={0.8} />
      <path d={pointsToPath(east)} fill={sideR} stroke={stroke} strokeWidth={0.8} />
      {stripe ? (
        SUBSURFACE_STRIPES.map((color, i) => {
          const t0 = i / 3;
          const t1 = (i + 1) / 3;
          const sw = top[0]!;
          const se = top[1]!;
          const ne = top[2]!;
          const nw = top[3]!;
          const lerp = (a: IsoPoint, b: IsoPoint, t: number): IsoPoint => ({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
          });
          const band = [
            lerp(sw, nw, t0),
            lerp(se, ne, t0),
            lerp(se, ne, t1),
            lerp(sw, nw, t1),
          ];
          return (
            <path
              key={color}
              d={pointsToPath(band)}
              fill={color}
              stroke={stroke}
              strokeWidth={0.6}
            />
          );
        })
      ) : (
        <path
          d={pointsToPath(top)}
          fill={fill}
          stroke={stroke}
          strokeWidth={highlighted || hovered ? 1.6 : 0.9}
        />
      )}
      <text
        x={c.x}
        y={c.y + 3}
        textAnchor="middle"
        fill={stripe ? "#14171c" : textFill}
        fontSize={9}
        fontFamily="var(--font-ibm-plex-mono), ui-monospace, monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

type ExtraCabin = {
  id: string;
  liftId: string;
  label: string;
  x: number;
  y: number;
  level: number;
};

export function StationIsoView({ station }: { station: SchematicStation }) {
  const initialVb = useMemo(() => computeViewBox(station), [station]);
  const [vb, setVb] = useState<ViewBox>(initialVb);
  const vbRef = useRef(vb);
  const [panning, setPanning] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedLiftId, setSelectedLiftId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    vbRef.current = vb;
  }, [vb]);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef({
    active: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });

  const byId = useMemo(() => {
    const m = new Map<string, SchematicNode>();
    for (const n of station.nodes) m.set(n.id, n);
    return m;
  }, [station.nodes]);

  const highlighted = useMemo(
    () => (selectedLiftId ? liftNeighborhood(station, selectedLiftId) : null),
    [station, selectedLiftId],
  );

  const slabs = useMemo(() => {
    const extra: ExtraCabin[] = [];
    for (const node of station.nodes) {
      if (node.type !== "lift" || !node.liftId) continue;
      const levels = new Set<number>([node.level]);
      for (const edge of station.edges) {
        if (edge.liftId !== node.liftId) continue;
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (a) levels.add(a.level);
        if (b) levels.add(b.level);
      }
      for (const level of levels) {
        if (level === node.level) continue;
        extra.push({
          id: `${node.id}::cabin::${level}`,
          liftId: node.liftId,
          x: node.x,
          y: node.y,
          level,
          label: node.label,
        });
      }
    }

    const items: Array<{
      key: string;
      x: number;
      y: number;
      level: number;
      node: SchematicNode;
    }> = station.nodes.map((node) => ({
      key: node.id,
      x: node.x,
      y: node.y,
      level: node.level,
      node,
    }));

    for (const cabin of extra) {
      items.push({
        key: cabin.id,
        x: cabin.x,
        y: cabin.y,
        level: cabin.level,
        node: {
          id: cabin.id,
          type: "lift",
          label: cabin.label,
          level: cabin.level,
          x: cabin.x,
          y: cabin.y,
          liftId: cabin.liftId,
        },
      });
    }

    items.sort((a, b) => comparePaintOrder(a, b));
    return items;
  }, [station, byId]);

  const hoverNodes = useMemo(() => {
    const m = new Map(byId);
    for (const item of slabs) {
      if (!m.has(item.node.id)) m.set(item.node.id, item.node);
    }
    return m;
  }, [byId, slabs]);

  const hovered = hoveredId ? hoverNodes.get(hoveredId) : undefined;

  const shafts = useMemo(() => {
    const out: Array<{
      liftId: string;
      x: number;
      y: number;
      topLevel: number;
      botLevel: number;
    }> = [];
    for (const node of station.nodes) {
      if (node.type !== "lift" || !node.liftId) continue;
      let top = node.level;
      let bot = node.level;
      for (const edge of station.edges) {
        if (edge.liftId !== node.liftId) continue;
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (a) {
          top = Math.max(top, a.level);
          bot = Math.min(bot, a.level);
        }
        if (b) {
          top = Math.max(top, b.level);
          bot = Math.min(bot, b.level);
        }
      }
      out.push({
        liftId: node.liftId,
        x: node.x,
        y: node.y,
        topLevel: top,
        botLevel: bot,
      });
    }
    return out;
  }, [station, byId]);

  const landings = useMemo(() => {
    const lines: Array<{
      liftId: string;
      a: IsoPoint;
      b: IsoPoint;
    }> = [];
    for (const edge of station.edges) {
      if (edge.mode !== "lift" || !edge.liftId) continue;
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const lift =
        from.type === "lift"
          ? from
          : to.type === "lift"
            ? to
            : station.nodes.find((n) => n.liftId === edge.liftId);
      if (!lift) continue;
      const other = from.id === lift.id ? to : from;
      if (other.x === lift.x && other.y === lift.y) continue;
      lines.push({
        liftId: edge.liftId,
        a: projectIso(lift.x, lift.y, other.level, ISO),
        b: projectIso(other.x, other.y, other.level, ISO),
      });
    }
    return lines;
  }, [station, byId]);

  const corridors = useMemo(() => {
    return station.edges
      .filter((e) => e.mode === "level")
      .flatMap((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return [];
        return [
          {
            a: projectIso(from.x, from.y, from.level, ISO),
            b: projectIso(to.x, to.y, to.level, ISO),
          },
        ];
      });
  }, [station.edges, byId]);

  const resetView = useCallback(() => {
    setVb(initialVb);
  }, [initialVb]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const current = vbRef.current;
      const rect = el.getBoundingClientRect();
      const cursorPt = clientToViewBox(e.clientX, e.clientY, rect, current);
      const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
      const nextW = Math.min(4200, Math.max(220, current.w * factor));
      const scale = nextW / current.w;
      const nextH = current.h * scale;
      setVb({
        x: cursorPt.x - (cursorPt.x - current.x) * scale,
        y: cursorPt.y - (cursorPt.y - current.y) * scale,
        w: nextW,
        h: nextH,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      active: true,
      moved: false,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const wrap = wrapRef.current;
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    }
    if (!drag.current.active) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.lastX) / rect.width) * vb.w;
    const dy = ((e.clientY - drag.current.lastY) / rect.height) * vb.h;
    if (Math.abs(e.clientX - drag.current.lastX) > 3 || Math.abs(e.clientY - drag.current.lastY) > 3) {
      drag.current.moved = true;
    }
    drag.current.lastX = e.clientX;
    drag.current.lastY = e.clientY;
    setVb((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const wasClick = drag.current.active && !drag.current.moved;
    drag.current.active = false;
    setPanning(false);
    if (wasClick && e.target === e.currentTarget) {
      setSelectedLiftId(null);
    }
  };

  const onNodeClick = (node: SchematicNode) => {
    if (drag.current.moved) return;
    if (node.liftId) {
      setSelectedLiftId((id) => (id === node.liftId ? null : node.liftId!));
      return;
    }
    setSelectedLiftId(null);
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-full w-full touch-none"
        style={{
          background: "#f7f8f9",
          cursor: panning ? "grabbing" : "grab",
        }}
        role="img"
        aria-label={`${station.name} schematic isometric station view. Not to scale, not for wayfinding.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          drag.current.active = false;
          setPanning(false);
          setHoveredId(null);
          setCursor(null);
        }}
      >
        {shafts.map((shaft) => {
          const top = projectIso(shaft.x, shaft.y, shaft.topLevel, ISO);
          const bot = projectIso(shaft.x, shaft.y, shaft.botLevel, ISO);
          const on = shaft.liftId === selectedLiftId;
          return (
            <line
              key={shaft.liftId}
              x1={top.x}
              y1={top.y}
              x2={bot.x}
              y2={bot.y}
              stroke={on ? "#14171c" : "#9aa1ab"}
              strokeWidth={on ? 5 : 3}
              strokeLinecap="round"
              opacity={highlighted && !on ? 0.28 : 1}
            />
          );
        })}

        {corridors.map((c, i) => (
          <line
            key={`c-${i}`}
            x1={c.a.x}
            y1={c.a.y}
            x2={c.b.x}
            y2={c.b.y}
            stroke="#b7bdc6"
            strokeWidth={5}
            strokeLinecap="round"
            opacity={highlighted ? 0.28 : 1}
          />
        ))}

        {landings.map((c, i) => {
          const on = c.liftId === selectedLiftId;
          return (
            <line
              key={`l-${i}`}
              x1={c.a.x}
              y1={c.a.y}
              x2={c.b.x}
              y2={c.b.y}
              stroke={on ? "#14171c" : "#8b929c"}
              strokeWidth={on ? 3.5 : 2.2}
              strokeLinecap="round"
              opacity={highlighted && !on ? 0.28 : 1}
            />
          );
        })}

        {slabs.map((item) => {
          const dimmed = highlighted ? !highlighted.has(item.node.id) && item.node.liftId !== selectedLiftId : false;
          const isHi =
            !!item.node.liftId && item.node.liftId === selectedLiftId;
          return (
            <IsoSlab
              key={item.key}
              node={item.node}
              nodes={station.nodes}
              dimmed={dimmed}
              highlighted={isHi}
              hovered={hoveredId === item.node.id}
              onEnter={setHoveredId}
              onLeave={(id) =>
                setHoveredId((cur) => (cur === id ? null : cur))
              }
              onClick={onNodeClick}
            />
          );
        })}
      </svg>

      <button
        type="button"
        onClick={resetView}
        className="absolute top-3 right-3 z-10 cursor-pointer rounded-[7px] border px-[13px] py-2 text-[12.5px] font-medium"
        style={{
          color: "#2a2f37",
          background: "rgba(255,255,255,0.92)",
          borderColor: "#cfd3d9",
        }}
      >
        Reset view
      </button>

      {hovered && cursor ? (
        <div
          className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg border px-2.5 py-1.5 text-[12px] shadow-sm"
          style={{
            left: cursor.x + 14,
            top: cursor.y + 14,
            background: "rgba(255,255,255,0.96)",
            borderColor: "#d8dce2",
            color: "#14171c",
          }}
        >
          <div className="font-medium">{hovered.label}</div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-[10.5px]"
            style={{ color: "#6c727c" }}
          >
            {[
              hovered.type,
              hoverDepthLabel(station.stationId, hovered, station.nodes),
              hovered.liftId,
              hovered.lineId,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
