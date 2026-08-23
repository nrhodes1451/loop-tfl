/**
 * Real-world London Underground sizes for dollhouse meshes.
 * Isolated from routing — do not import plan/status/topology.
 * Depths from FOI are approximate; never used for access decisions.
 */

import {
  SCHEMATIC_LINE_LEVEL,
  normalizeSchematicLineId,
} from "./levels";

/** Keep in sync with `SCHEMATIC_METRES_PER_UNIT` in geo.ts. */
export const SCHEMATIC_UNIT_M = 4;

/** Deep-level running tunnel internal diameter (~3.56–3.81 m). */
export const DEEP_TUBE_DIAMETER_M = 3.7;
export const DEEP_TUBE_RADIUS_M = DEEP_TUBE_DIAMETER_M / 2;

/** Cut-and-cover sub-surface profile (Circle / District / H&C / Met). */
export const SUBSURFACE_TUBE_DIAMETER_M = 7.5;
export const SUBSURFACE_TUBE_RADIUS_M = SUBSURFACE_TUBE_DIAMETER_M / 2;

/** Typical 6–7 car train length. */
export const PLATFORM_LENGTH_M = 115;
/** Side-platform width, sits beside the running tunnel. */
export const PLATFORM_WIDTH_M = 3.5;

export const TYPICAL_SUBSURFACE_DEPTH_M = 8;
export const TYPICAL_DEEP_DEPTH_M = 20;
export const TYPICAL_NORTHERN_DEPTH_M = 25;

export const PLATFORM_THIN_U = PLATFORM_WIDTH_M / SCHEMATIC_UNIT_M;
export const PLATFORM_LONG_U = PLATFORM_LENGTH_M / SCHEMATIC_UNIT_M;

export function isSubsurfaceLine(lineId: string): boolean {
  const id = normalizeSchematicLineId(lineId);
  return (SCHEMATIC_LINE_LEVEL[id] ?? SCHEMATIC_LINE_LEVEL[lineId]) === -2;
}

export function tubeRadiusM(lineId: string): number {
  return isSubsurfaceLine(lineId)
    ? SUBSURFACE_TUBE_RADIUS_M
    : DEEP_TUBE_RADIUS_M;
}

/** Fallback when a station/line has no FOI metre row. */
export function typicalDepthM(lineId: string): number {
  const id = normalizeSchematicLineId(lineId);
  if (id === "northern") return TYPICAL_NORTHERN_DEPTH_M;
  if (isSubsurfaceLine(id)) return TYPICAL_SUBSURFACE_DEPTH_M;
  return TYPICAL_DEEP_DEPTH_M;
}

/**
 * Local schematic Y so that after `placeSchematic` the volume centre sits
 * `depthM` metres below the street top (world Y = −depthM).
 * `streetH` is the street slab height in schematic units (same as STREET_H).
 */
export function schematicLocalYForDepthM(
  depthM: number,
  streetH: number,
  unitM: number = SCHEMATIC_UNIT_M,
): number {
  return -depthM / unitM + streetH / 2;
}
