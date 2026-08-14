/**
 * 2:1 isometric projection for schematic station geometry.
 * Isolated from routing — do not import plan/status/topology.
 */

export type IsoPoint = { x: number; y: number };

export type IsoConfig = {
  originX: number;
  originY: number;
  tileW: number;
  tileH: number;
  levelH: number;
};

/** Classic 2:1 isometric (tileH = tileW / 2). */
export const DEFAULT_ISO: IsoConfig = {
  originX: 0,
  originY: 0,
  tileW: 56,
  tileH: 28,
  levelH: 36,
};

export function projectIso(
  x: number,
  y: number,
  level: number,
  cfg: IsoConfig = DEFAULT_ISO,
): IsoPoint {
  return {
    x: cfg.originX + (x - y) * (cfg.tileW / 2),
    y: cfg.originY + (x + y) * (cfg.tileH / 2) - level * cfg.levelH,
  };
}

export function dropIso(p: IsoPoint, dy: number): IsoPoint {
  return { x: p.x, y: p.y + dy };
}

/** Top-face corners of a plan-centred box, SW → SE → NE → NW. */
export function isoBoxTop(
  cx: number,
  cy: number,
  wx: number,
  wy: number,
  level: number,
  cfg: IsoConfig = DEFAULT_ISO,
): IsoPoint[] {
  const hw = wx / 2;
  const hd = wy / 2;
  return [
    projectIso(cx - hw, cy - hd, level, cfg),
    projectIso(cx + hw, cy - hd, level, cfg),
    projectIso(cx + hw, cy + hd, level, cfg),
    projectIso(cx - hw, cy + hd, level, cfg),
  ];
}

export function pointsToPath(points: IsoPoint[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(" ")} Z`;
}

/**
 * Painter's algorithm: back (small x+y) first, then deeper (more negative)
 * level so upper slabs occlude.
 */
export function paintOrderKey(x: number, y: number, level: number): number {
  return x + y + level * 0.001;
}

export function comparePaintOrder(
  a: { x: number; y: number; level: number },
  b: { x: number; y: number; level: number },
): number {
  const dy = a.x + a.y - (b.x + b.y);
  if (dy !== 0) return dy;
  return a.level - b.level;
}
