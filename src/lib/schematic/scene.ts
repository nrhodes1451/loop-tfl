/**
 * Procedural 3D schematic geometry. Isolated from routing —
 * do not import plan/status/topology.
 */

import type {
  SchematicEdge,
  SchematicEdgeMode,
  SchematicNode,
  SchematicNodeType,
} from "./types";

export type Vec3 = [number, number, number];

export type StationTopology = {
  nodes: SchematicNode[];
  edges: SchematicEdge[];
};

export type SceneQuality = "high" | "low";

export const LEVEL_SPACING = 2.8;
export const SCENE_BACKGROUND = "#050608";

export type VolumeKind = "box" | "cylinder";

export type SceneVolume = {
  id: string;
  kind: VolumeKind;
  type: SchematicNodeType;
  level: number;
  position: Vec3;
  /** Box: [width X, height Y, depth Z]. Cylinder: [radius, height, 0]. */
  size: Vec3;
  faceColor: string;
  edgeColor: string;
  opacity: number;
  radialSegments: number;
  label: string;
  liftId?: string;
  lineId?: string;
  /** Derived shafts are too thin to pick reliably through slabs. */
  pickable: boolean;
};

export type PolylineRole = "connection" | "outline";

export type ScenePolyline = {
  id: string;
  role: PolylineRole;
  mode: SchematicEdgeMode | "shaft" | "landing" | "wire";
  points: Vec3[];
  /** When true, `points` are start/end pairs for LineSegments2. */
  segments: boolean;
  color: string;
  lineWidth: number;
  liftId?: string;
  volumeId?: string;
};

export type SceneBounds = {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  radius: number;
};

export type CameraFrame = {
  target: Vec3;
  position: Vec3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  far: number;
};

export type SceneGeometry = {
  volumes: SceneVolume[];
  polylines: ScenePolyline[];
  bounds: SceneBounds;
  minLevel: number;
  maxLevel: number;
};

const COOL_TO_WARM: Vec3[] = [
  [94, 232, 255],
  [74, 168, 255],
  [107, 124, 255],
  [196, 92, 255],
  [255, 90, 154],
  [255, 122, 58],
  [255, 193, 74],
];

type Footprint = { wx: number; wy: number; h: number };

function footprint(node: SchematicNode): Footprint {
  switch (node.type) {
    case "platform":
      if (node.lineId === "circle") return { wx: 3.15, wy: 0.64, h: 0.4 };
      return { wx: 0.56, wy: 2.85, h: 0.4 };
    case "concourse":
      return { wx: 2.05, wy: 1.55, h: 0.48 };
    case "street":
      return { wx: 1.95, wy: 1.45, h: 0.3 };
    case "lift":
      return { wx: 0.44, wy: 0.44, h: 0.5 };
    case "shaft":
      return { wx: 0.24, wy: 0.24, h: LEVEL_SPACING };
  }
}

export function toWorld(x: number, y: number, level: number): Vec3 {
  return [x, level * LEVEL_SPACING, y];
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function mixRgb(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgbToHex(rgb: Vec3): string {
  const c = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

function hueAt(t: number): Vec3 {
  const u = clamp01(t) * (COOL_TO_WARM.length - 1);
  const i = Math.min(Math.floor(u), COOL_TO_WARM.length - 2);
  const f = u - i;
  return mixRgb(COOL_TO_WARM[i]!, COOL_TO_WARM[i + 1]!, f);
}

/** t = 0 at maxLevel (street), t = 1 at minLevel (deepest). */
export function levelT(level: number, minLevel: number, maxLevel: number): number {
  const span = maxLevel - minLevel;
  if (span === 0) return 0;
  return clamp01((maxLevel - level) / span);
}

function typeTint(rgb: Vec3, type: SchematicNodeType): Vec3 {
  switch (type) {
    case "lift":
    case "shaft":
      return mixRgb(rgb, [212, 246, 255], 0.42);
    case "concourse":
      return mixRgb(rgb, [255, 255, 255], 0.12);
    case "street":
      return mixRgb(rgb, [255, 255, 255], 0.22);
    default:
      return rgb;
  }
}

export function levelEdgeColor(
  level: number,
  minLevel: number,
  maxLevel: number,
  type: SchematicNodeType = "platform",
): string {
  return rgbToHex(typeTint(hueAt(levelT(level, minLevel, maxLevel)), type));
}

export function levelFaceColor(
  level: number,
  minLevel: number,
  maxLevel: number,
  type: SchematicNodeType = "platform",
): string {
  const edge = typeTint(hueAt(levelT(level, minLevel, maxLevel)), type);
  return rgbToHex(mixRgb(edge, [8, 10, 14], 0.62));
}

function nodeOpacity(type: SchematicNodeType): number {
  if (type === "lift" || type === "shaft") return 0.2;
  if (type === "platform") return 0.16;
  return 0.14;
}

function levelRange(nodes: SchematicNode[]): { minLevel: number; maxLevel: number } {
  let minLevel = Infinity;
  let maxLevel = -Infinity;
  for (const node of nodes) {
    minLevel = Math.min(minLevel, node.level);
    maxLevel = Math.max(maxLevel, node.level);
  }
  if (!Number.isFinite(minLevel)) {
    return { minLevel: 0, maxLevel: 0 };
  }
  return { minLevel, maxLevel };
}

function boxWire(position: Vec3, size: Vec3): Vec3[] {
  const [x, y, z] = position;
  const hw = size[0] / 2;
  const hh = size[1] / 2;
  const hd = size[2] / 2;
  const c: Vec3[] = [
    [x - hw, y - hh, z - hd],
    [x + hw, y - hh, z - hd],
    [x + hw, y - hh, z + hd],
    [x - hw, y - hh, z + hd],
    [x - hw, y + hh, z - hd],
    [x + hw, y + hh, z - hd],
    [x + hw, y + hh, z + hd],
    [x - hw, y + hh, z + hd],
  ];
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  return e.map((i) => c[i]!);
}

function cylinderWire(
  position: Vec3,
  radius: number,
  height: number,
  ring: number,
  stiles: number,
): Vec3[] {
  const [x, y, z] = position;
  const y0 = y - height / 2;
  const y1 = y + height / 2;
  const pts: Vec3[] = [];
  const ringPt = (i: number, yy: number): Vec3 => {
    const a = (i / ring) * Math.PI * 2;
    return [x + Math.cos(a) * radius, yy, z + Math.sin(a) * radius];
  };
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring;
    pts.push(ringPt(i, y0), ringPt(j, y0));
    pts.push(ringPt(i, y1), ringPt(j, y1));
  }
  for (let i = 0; i < stiles; i++) {
    const idx = Math.round((i / stiles) * ring) % ring;
    pts.push(ringPt(idx, y0), ringPt(idx, y1));
  }
  return pts;
}

function expandBounds(min: Vec3, max: Vec3, p: Vec3) {
  min[0] = Math.min(min[0], p[0]);
  min[1] = Math.min(min[1], p[1]);
  min[2] = Math.min(min[2], p[2]);
  max[0] = Math.max(max[0], p[0]);
  max[1] = Math.max(max[1], p[1]);
  max[2] = Math.max(max[2], p[2]);
}

function computeBounds(volumes: SceneVolume[], polylines: ScenePolyline[]): SceneBounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const vol of volumes) {
    if (vol.kind === "box") {
      expandBounds(min, max, [
        vol.position[0] - vol.size[0] / 2,
        vol.position[1] - vol.size[1] / 2,
        vol.position[2] - vol.size[2] / 2,
      ]);
      expandBounds(min, max, [
        vol.position[0] + vol.size[0] / 2,
        vol.position[1] + vol.size[1] / 2,
        vol.position[2] + vol.size[2] / 2,
      ]);
    } else {
      expandBounds(min, max, [
        vol.position[0] - vol.size[0],
        vol.position[1] - vol.size[1] / 2,
        vol.position[2] - vol.size[0],
      ]);
      expandBounds(min, max, [
        vol.position[0] + vol.size[0],
        vol.position[1] + vol.size[1] / 2,
        vol.position[2] + vol.size[0],
      ]);
    }
  }
  for (const line of polylines) {
    for (const p of line.points) expandBounds(min, max, p);
  }
  if (!Number.isFinite(min[0])) {
    return { min: [0, 0, 0], max: [1, 1, 1], center: [0, 0, 0], radius: 8 };
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  const radius = Math.max(2, Math.hypot(dx, dy, dz) / 2);
  return { min, max, center, radius };
}

export function cameraFrame(bounds: SceneBounds): CameraFrame {
  const { center, radius } = bounds;
  const dist = radius * 2.15;
  const position: Vec3 = [
    center[0] + dist * 0.62,
    center[1] + dist * 0.52,
    center[2] + dist * 0.78,
  ];
  return {
    target: center,
    position,
    minDistance: Math.max(4, radius * 0.7),
    maxDistance: radius * 5.5,
    minPolarAngle: 0.22,
    maxPolarAngle: 1.32,
    far: Math.max(80, radius * 20),
  };
}

function outlineOf(
  vol: SceneVolume,
  ring: number,
  stiles: number,
  lineWidth: number,
): ScenePolyline {
  const points =
    vol.kind === "box"
      ? boxWire(vol.position, vol.size)
      : cylinderWire(vol.position, vol.size[0], vol.size[1], ring, stiles);
  return {
    id: `wire::${vol.id}`,
    role: "outline",
    mode: "wire",
    points,
    segments: true,
    color: vol.edgeColor,
    lineWidth,
    volumeId: vol.id,
    liftId: vol.liftId,
  };
}

export type HoverHighlight = {
  volumeIds: Set<string>;
  polylineIds: Set<string>;
};

/** Lift hover selects the shaft + every cabin; other volumes highlight alone. */
export function hoverHighlight(
  hoveredVolumeId: string | null,
  geom: SceneGeometry,
): HoverHighlight {
  const volumeIds = new Set<string>();
  const polylineIds = new Set<string>();
  if (!hoveredVolumeId) return { volumeIds, polylineIds };
  const vol = geom.volumes.find((v) => v.id === hoveredVolumeId);
  if (!vol) return { volumeIds, polylineIds };

  if (vol.liftId) {
    for (const v of geom.volumes) {
      if (v.liftId === vol.liftId) volumeIds.add(v.id);
    }
    for (const p of geom.polylines) {
      if (p.liftId === vol.liftId) polylineIds.add(p.id);
      if (p.volumeId && volumeIds.has(p.volumeId)) polylineIds.add(p.id);
    }
    return { volumeIds, polylineIds };
  }

  volumeIds.add(vol.id);
  for (const p of geom.polylines) {
    if (p.volumeId === vol.id) polylineIds.add(p.id);
  }
  return { volumeIds, polylineIds };
}

type LiftSpan = {
  liftId: string;
  node: SchematicNode;
  x: number;
  y: number;
  topLevel: number;
  botLevel: number;
  levels: Set<number>;
};

function liftSpans(
  nodes: SchematicNode[],
  edges: SchematicEdge[],
  byId: Map<string, SchematicNode>,
): LiftSpan[] {
  const out: LiftSpan[] = [];
  for (const node of nodes) {
    if (node.type !== "lift" || !node.liftId) continue;
    const levels = new Set<number>([node.level]);
    let top = node.level;
    let bot = node.level;
    for (const edge of edges) {
      if (edge.liftId !== node.liftId) continue;
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (a) {
        levels.add(a.level);
        top = Math.max(top, a.level);
        bot = Math.min(bot, a.level);
      }
      if (b) {
        levels.add(b.level);
        top = Math.max(top, b.level);
        bot = Math.min(bot, b.level);
      }
    }
    out.push({
      liftId: node.liftId,
      node,
      x: node.x,
      y: node.y,
      topLevel: top,
      botLevel: bot,
      levels,
    });
  }
  return out;
}

function connectionWidth(mode: ScenePolyline["mode"], quality: SceneQuality): number {
  const fat = quality === "high";
  switch (mode) {
    case "level":
      return fat ? 2.4 : 1.8;
    case "shaft":
      return fat ? 1.8 : 1.3;
    case "landing":
      return fat ? 1.5 : 1.15;
    case "escalator":
      return fat ? 2.0 : 1.5;
    case "stairs":
      return fat ? 1.6 : 1.2;
    default:
      return fat ? 1.2 : 0.95;
  }
}

export function buildSceneGeometry(
  topology: StationTopology,
  opts: { quality?: SceneQuality } = {},
): SceneGeometry {
  const quality: SceneQuality = opts.quality ?? "high";
  const radialSegments = quality === "high" ? 16 : 8;
  const ring = quality === "high" ? 12 : 8;
  const stiles = quality === "high" ? 6 : 4;
  const outlineWidth = quality === "high" ? 1.15 : 0.95;

  const { nodes, edges } = topology;
  const { minLevel, maxLevel } = levelRange(nodes);
  const byId = new Map<string, SchematicNode>();
  for (const node of nodes) byId.set(node.id, node);

  const volumes: SceneVolume[] = [];
  const polylines: ScenePolyline[] = [];
  const spans = liftSpans(nodes, edges, byId);

  const colors = (level: number, type: SchematicNodeType) => ({
    faceColor: levelFaceColor(level, minLevel, maxLevel, type),
    edgeColor: levelEdgeColor(level, minLevel, maxLevel, type),
  });

  for (const node of nodes) {
    const fp = footprint(node);
    const position = toWorld(node.x, node.y, node.level);
    const tint = colors(node.level, node.type);
    if (node.type === "lift" || node.type === "shaft") {
      volumes.push({
        id: node.id,
        kind: "cylinder",
        type: node.type,
        level: node.level,
        position,
        size: [fp.wx / 2, fp.h, 0],
        ...tint,
        opacity: nodeOpacity(node.type),
        radialSegments,
        label: node.label,
        liftId: node.liftId,
        lineId: node.lineId,
        pickable: true,
      });
    } else {
      volumes.push({
        id: node.id,
        kind: "box",
        type: node.type,
        level: node.level,
        position,
        size: [fp.wx, fp.h, fp.wy],
        ...tint,
        opacity: nodeOpacity(node.type),
        radialSegments,
        label: node.label,
        liftId: node.liftId,
        lineId: node.lineId,
        pickable: true,
      });
    }
  }

  for (const span of spans) {
    for (const level of span.levels) {
      if (level === span.node.level) continue;
      const id = `${span.node.id}::cabin::${level}`;
      const fp = footprint(span.node);
      volumes.push({
        id,
        kind: "cylinder",
        type: "lift",
        level,
        position: toWorld(span.x, span.y, level),
        size: [fp.wx / 2, fp.h, 0],
        ...colors(level, "lift"),
        opacity: nodeOpacity("lift"),
        radialSegments,
        label: span.node.label,
        liftId: span.liftId,
        pickable: true,
      });
    }

    const cabinH = footprint(span.node).h;
    const height = Math.max(
      (span.topLevel - span.botLevel) * LEVEL_SPACING + cabinH,
      cabinH,
    );
    const midLevel = (span.topLevel + span.botLevel) / 2;
    const shaftId = `shaft::${span.liftId}`;
    volumes.push({
      id: shaftId,
      kind: "cylinder",
      type: "shaft",
      level: midLevel,
      position: toWorld(span.x, span.y, midLevel),
      size: [0.12, height, 0],
      ...colors(Math.round(midLevel), "shaft"),
      opacity: 0.12,
      radialSegments,
      label: span.node.label,
      liftId: span.liftId,
      pickable: false,
    });

    const top = toWorld(span.x, span.y, span.topLevel);
    const bot = toWorld(span.x, span.y, span.botLevel);
    polylines.push({
      id: `shaft-line::${span.liftId}`,
      role: "connection",
      mode: "shaft",
      points: [top, bot],
      segments: false,
      color: levelEdgeColor(midLevel, minLevel, maxLevel, "shaft"),
      lineWidth: connectionWidth("shaft", quality),
      liftId: span.liftId,
    });
  }

  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;

    if (edge.mode === "level") {
      polylines.push({
        id: `corridor::${edge.from}::${edge.to}`,
        role: "connection",
        mode: "level",
        points: [toWorld(from.x, from.y, from.level), toWorld(to.x, to.y, to.level)],
        segments: false,
        color: levelEdgeColor(from.level, minLevel, maxLevel, "platform"),
        lineWidth: connectionWidth("level", quality),
      });
      continue;
    }

    if (edge.mode === "stairs" || edge.mode === "escalator") {
      polylines.push({
        id: `${edge.mode}::${edge.from}::${edge.to}`,
        role: "connection",
        mode: edge.mode,
        points: [toWorld(from.x, from.y, from.level), toWorld(to.x, to.y, to.level)],
        segments: false,
        color: levelEdgeColor(
          (from.level + to.level) / 2,
          minLevel,
          maxLevel,
          "concourse",
        ),
        lineWidth: connectionWidth(edge.mode, quality),
      });
      continue;
    }

    if (edge.mode !== "lift" || !edge.liftId) continue;
    const lift =
      from.type === "lift"
        ? from
        : to.type === "lift"
          ? to
          : nodes.find((n) => n.liftId === edge.liftId);
    if (!lift) continue;
    const other = from.id === lift.id ? to : from;
    if (other.x === lift.x && other.y === lift.y) continue;
    polylines.push({
      id: `landing::${edge.liftId}::${edge.from}::${edge.to}`,
      role: "connection",
      mode: "landing",
      points: [
        toWorld(lift.x, lift.y, other.level),
        toWorld(other.x, other.y, other.level),
      ],
      segments: false,
      color: levelEdgeColor(other.level, minLevel, maxLevel, "lift"),
      lineWidth: connectionWidth("landing", quality),
      liftId: edge.liftId,
    });
  }

  for (const vol of volumes) {
    polylines.push(outlineOf(vol, ring, stiles, outlineWidth));
  }

  return {
    volumes,
    polylines,
    bounds: computeBounds(volumes, polylines),
    minLevel,
    maxLevel,
  };
}
