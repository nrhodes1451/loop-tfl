/**
 * King's Cross-style schematic depth conventions. Not survey depths.
 * Isolated from routing — do not import plan/status/topology.
 */

/** Normalised schematic line id → depth tier. 0 = street, negative = below. */
export const SCHEMATIC_LINE_LEVEL: Record<string, number> = {
  circle: -2,
  "hammersmith-city": -2,
  metropolitan: -2,
  district: -2,
  tram: -2,
  dlr: -2,
  "london-overground": -2,
  overground: -2,
  liberty: -2,
  lioness: -2,
  mildmay: -2,
  suffragette: -2,
  weaver: -2,
  windrush: -2,
  "national-rail": -2,
  "elizabeth-line": -3,
  elizabeth: -3,
  bakerloo: -4,
  central: -4,
  jubilee: -4,
  "waterloo-city": -4,
  victoria: -4,
  piccadilly: -5,
  northern: -6,
};

const LINE_ID_ALIASES: Record<string, string> = {
  elizabeth: "elizabeth-line",
  "hammersmith-and-city": "hammersmith-city",
  "waterloo-and-city": "waterloo-city",
  "tfl-rail": "elizabeth-line",
};

export function normalizeSchematicLineId(lineId: string): string {
  const s = lineId.trim().toLowerCase().replace(/\s+/g, "-");
  return LINE_ID_ALIASES[s] ?? s;
}

/**
 * Schematic depth tier for a line. Unknown ids fall back to −7 so tubes
 * still render; generated layouts assign unique deeper slots themselves.
 */
export function schematicLevelForLine(lineId: string): number {
  const id = normalizeSchematicLineId(lineId);
  const known = SCHEMATIC_LINE_LEVEL[id] ?? SCHEMATIC_LINE_LEVEL[lineId];
  return known ?? -7;
}
