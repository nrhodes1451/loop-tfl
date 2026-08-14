/**
 * Load illustrative schematic station JSON.
 * Isolated from routing — do not import or call from plan/status/network.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SchematicStation } from "./types";

const cache = new Map<string, { mtimeMs: number; data: SchematicStation }>();

export async function loadSchematic(
  stationId: string,
): Promise<SchematicStation> {
  const filePath = path.join(
    process.cwd(),
    "data",
    "schematic",
    `${stationId}.json`,
  );
  const { mtimeMs } = await stat(filePath);
  const hit = cache.get(stationId);
  if (hit && hit.mtimeMs === mtimeMs) return hit.data;
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as SchematicStation;
  cache.set(stationId, { mtimeMs, data });
  return data;
}

export function clearSchematicCache() {
  cache.clear();
}
