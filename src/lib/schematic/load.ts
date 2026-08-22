/**
 * Load illustrative schematic station JSON.
 * Isolated from routing — do not import or call from plan/status/network.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  distanceM,
  NEIGHBOR_LOAD_RADIUS_M,
  type LatLon,
} from "./geo";
import type { LineNetwork } from "./lines";
import type { SchematicIndex, SchematicStation, SchematicStationRef } from "./types";

const stationCache = new Map<string, { mtimeMs: number; data: SchematicStation }>();
let indexCache: { mtimeMs: number; data: SchematicIndex } | null = null;
let linesCache: { mtimeMs: number; data: LineNetwork } | null = null;

export class SchematicNotFoundError extends Error {
  constructor(public stationId: string) {
    super(`No schematic for ${stationId}`);
    this.name = "SchematicNotFoundError";
  }
}

function assertSafeId(stationId: string) {
  if (!stationId || stationId.includes("/") || stationId.includes("\\") || stationId.includes("..")) {
    throw new SchematicNotFoundError(stationId);
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<{ mtimeMs: number; data: T } | null> {
  try {
    const { mtimeMs } = await stat(filePath);
    const raw = await readFile(filePath, "utf8");
    return { mtimeMs, data: JSON.parse(raw) as T };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function loadSchematic(
  stationId: string,
): Promise<SchematicStation> {
  assertSafeId(stationId);
  const overridePath = path.join(
    process.cwd(),
    "data",
    "schematic",
    `${stationId}.json`,
  );
  const generatedPath = path.join(
    process.cwd(),
    "data",
    "schematic",
    "generated",
    `${stationId}.json`,
  );

  const override = await readJsonIfExists<SchematicStation>(overridePath);
  const chosen = override ?? (await readJsonIfExists<SchematicStation>(generatedPath));
  if (!chosen) throw new SchematicNotFoundError(stationId);

  const hit = stationCache.get(stationId);
  if (hit && hit.mtimeMs === chosen.mtimeMs) return hit.data;
  stationCache.set(stationId, chosen);
  return chosen.data;
}

export async function listSchematicStations(): Promise<SchematicStationRef[]> {
  const filePath = path.join(process.cwd(), "data", "schematic", "index.json");
  const { mtimeMs } = await stat(filePath);
  if (indexCache && indexCache.mtimeMs === mtimeMs) return indexCache.data.stations;
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as SchematicIndex;
  indexCache = { mtimeMs, data };
  return data.stations;
}

export async function loadSchematicsNear(
  origin: LatLon,
  radiusM: number = NEIGHBOR_LOAD_RADIUS_M,
): Promise<SchematicStation[]> {
  const refs = await listSchematicStations();
  const hits = refs.filter(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lon) &&
      distanceM(s, origin) <= radiusM,
  );
  return Promise.all(hits.map((s) => loadSchematic(s.id)));
}

export async function loadLineNetwork(): Promise<LineNetwork> {
  const filePath = path.join(process.cwd(), "data", "schematic", "lines.json");
  const { mtimeMs } = await stat(filePath);
  if (linesCache && linesCache.mtimeMs === mtimeMs) return linesCache.data;
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as LineNetwork;
  linesCache = { mtimeMs, data };
  return data;
}

export function clearSchematicCache() {
  stationCache.clear();
  indexCache = null;
  linesCache = null;
}
