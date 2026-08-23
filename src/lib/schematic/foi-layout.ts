/**
 * FOI layout.json lookup: platform depth in metres below street.
 * Isolated from routing — do not import plan/status/topology.
 * Metres are approximate (~2015 FOI), never used for access decisions.
 */

import layoutJson from "../../../data/foi/layout.json";
import type { FoiLayoutFile } from "./foi-extract";
import { normalizeSchematicLineId } from "./levels";
import { typicalDepthM } from "./lu-scale";

const file = layoutJson as FoiLayoutFile;

const depthsByStation = new Map<string, Map<string, number>>();
for (const st of file.stations) {
  const byLine = new Map<string, number>();
  for (const d of st.depths) {
    if (!d.lineId) continue;
    const id = normalizeSchematicLineId(d.lineId);
    if (!byLine.has(id)) byLine.set(id, d.metres);
  }
  depthsByStation.set(st.stationId, byLine);
}

/** FOI metre depth for a station+line, or null if that row is missing. */
export function foiDepthM(stationId: string, lineId: string): number | null {
  const byLine = depthsByStation.get(stationId);
  if (!byLine) return null;
  const id = normalizeSchematicLineId(lineId);
  const m = byLine.get(id);
  return m == null ? null : m;
}

/**
 * Metres below street for a platform: FOI when present, otherwise a
 * typical LU depth for that line family.
 */
export function platformDepthM(stationId: string | undefined, lineId: string): number {
  if (stationId) {
    const hit = foiDepthM(stationId, lineId);
    if (hit != null) return hit;
  }
  return typicalDepthM(lineId);
}

/** World Y of the platform/tube centre (street top = 0). */
export function platformWorldY(stationId: string | undefined, lineId: string): number {
  return -platformDepthM(stationId, lineId);
}
