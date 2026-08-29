/**
 * Generate invented schematic JSON for every station in data/network.json.
 * Skips ids that already have a top-level override.
 *
 * Usage: npm run build-schematics
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FoiLayoutFile } from "../src/lib/schematic/foi-extract";
import { platformDepthM } from "../src/lib/schematic/foi-layout";
import {
  generateSchematic,
  type GeneratePlacementPlatform,
} from "../src/lib/schematic/generate";
import { normalizeSchematicLineId } from "../src/lib/schematic/levels";
import { buildLineNetwork } from "../src/lib/schematic/lines";
import {
  matchOsmNationalRailPlacements,
  osmPlatformsQuery,
  parseOsmPlatforms,
} from "../src/lib/schematic/osm-platforms";
import type {
  SchematicFoiMark,
  SchematicIndex,
  SchematicStation,
} from "../src/lib/schematic/types";
import type { NetworkData } from "../src/lib/types";
import {
  OVERPASS_ENDPOINTS,
  bakeEntrances,
  networkBbox,
  overpassQuery,
  type OverpassResponse,
} from "../src/lib/schematic/entrances";

const OVERPASS_TIMEOUT_MS = 200_000;

export async function buildSchematics(): Promise<{
  generated: number;
  skipped: number;
  stations: number;
  chains: number;
  entrances: number;
}> {
  const root = process.cwd();
  const schematicDir = path.join(root, "data", "schematic");
  const generatedDir = path.join(schematicDir, "generated");
  const networkPath = path.join(root, "data", "network.json");

  const network = JSON.parse(await readFile(networkPath, "utf8")) as NetworkData;

  let placementByStation = new Map<string, GeneratePlacementPlatform[]>();
  let marksByStation = new Map<string, SchematicFoiMark[]>();
  try {
    const layout = JSON.parse(
      await readFile(path.join(root, "data", "foi", "layout.json"), "utf8"),
    ) as FoiLayoutFile;
    placementByStation = new Map(
      layout.stations.map((s) => [
        s.stationId,
        (s.platforms ?? [])
          .filter((p) => normalizeSchematicLineId(p.lineId) !== "national-rail")
          .map((p) => ({
            lineId: p.lineId,
            platformNumbers: p.platformNumbers,
            eastM: p.eastM,
            northM: p.northM,
            bearingDeg: p.bearingDeg,
            confidence: p.confidence,
            caption: p.caption,
            end: p.end,
            a: p.a,
            b: p.b,
            grid: p.grid,
            residual: p.residual,
            flags: p.flags,
            ...(p.depthM != null ? { depthM: p.depthM } : {}),
          })),
      ]),
    );
    marksByStation = new Map(
      layout.stations.map((s) => [s.stationId, s.marks ?? []]),
    );
  } catch {
    /* layout.json is optional — generated stations then use line bands */
  }

  const overrideIds = new Set<string>();
  const top = await readdir(schematicDir);
  for (const name of top) {
    if (
      !name.endsWith(".json") ||
      name === "index.json" ||
      name === "lines.json" ||
      name === "entrances.json"
    ) {
      continue;
    }
    overrideIds.add(name.slice(0, -".json".length));
  }

  const platformsByStation = new Map<string, NetworkData["platforms"]>();
  for (const p of network.platforms) {
    const list = platformsByStation.get(p.stationId) ?? [];
    list.push(p);
    platformsByStation.set(p.stationId, list);
  }
  const liftsByStation = new Map<string, NetworkData["lifts"]>();
  for (const l of network.lifts) {
    const list = liftsByStation.get(l.stationId) ?? [];
    list.push(l);
    liftsByStation.set(l.stationId, list);
  }
  const chainByPlatform = new Map(
    network.platformLiftChains.map((c) => [c.platformId, c]),
  );
  const hopsByStation = new Map<string, NetworkData["interchangeChains"]>();
  const platformStation = new Map(
    network.platforms.map((p) => [p.id, p.stationId]),
  );
  for (const hop of network.interchangeChains) {
    const stationId = platformStation.get(hop.fromPlatformId);
    if (!stationId) continue;
    const list = hopsByStation.get(stationId) ?? [];
    list.push(hop);
    hopsByStation.set(stationId, list);
  }

  let osmFeatures: ReturnType<typeof parseOsmPlatforms> = [];
  const hasNationalRail = network.platforms.some(
    (p) => p.lineId === "national-rail",
  );
  if (hasNationalRail) {
    try {
      const osm = await fetchOverpass(
        osmPlatformsQuery(
          networkBbox(
            network.stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
          ),
        ),
      );
      osmFeatures = parseOsmPlatforms(osm);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`Skipped OSM National Rail platform bake (${reason})`);
    }
  }

  await mkdir(generatedDir, { recursive: true });
  const stale = await readdir(generatedDir);
  for (const name of stale) {
    if (name.endsWith(".json")) {
      await rm(path.join(generatedDir, name));
    }
  }

  let generated = 0;
  let skipped = 0;
  const schematics = new Map<string, SchematicStation>();
  for (const station of network.stations) {
    if (overrideIds.has(station.id)) {
      skipped += 1;
      const raw = await readFile(
        path.join(schematicDir, `${station.id}.json`),
        "utf8",
      );
      schematics.set(station.id, JSON.parse(raw) as SchematicStation);
      continue;
    }
    const platforms = platformsByStation.get(station.id) ?? [];
    const lifts = liftsByStation.get(station.id) ?? [];
    const platformLiftChains = platforms
      .map((p) => chainByPlatform.get(p.id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const osmPlacement = matchOsmNationalRailPlacements(
      osmFeatures,
      { id: station.id, lat: station.lat, lon: station.lon },
      platforms,
      platformDepthM(station.id, "national-rail"),
    );
    const schematic = generateSchematic({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      platforms,
      lifts,
      platformLiftChains,
      interchangeChains: hopsByStation.get(station.id) ?? [],
      placement: [
        ...(placementByStation.get(station.id) ?? []),
        ...osmPlacement,
      ],
      foiMarks: marksByStation.get(station.id),
    });
    await writeFile(
      path.join(generatedDir, `${station.id}.json`),
      JSON.stringify(schematic),
    );
    schematics.set(station.id, schematic);
    generated += 1;
  }

  const generatedAt = new Date().toISOString();
  const index: SchematicIndex = {
    generatedAt,
    stations: [...network.stations]
      .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
  await writeFile(
    path.join(schematicDir, "index.json"),
    JSON.stringify(index, null, 2),
  );

  const lines = buildLineNetwork({
    stations: network.stations,
    edges: network.edges,
    schematics,
    generatedAt,
  });
  await writeFile(
    path.join(schematicDir, "lines.json"),
    JSON.stringify(lines),
  );

  const entranceCount = await bakeEntranceOverlay(
    schematicDir,
    network.stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon })),
    generatedAt,
  );

  return {
    generated,
    skipped,
    stations: index.stations.length,
    chains: lines.chains.length,
    entrances: entranceCount,
  };
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "tubenet/0.1 (schematic entrance bake)",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastErr = new Error(`${url} ${res.status}`);
        continue;
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass request failed");
}

async function bakeEntranceOverlay(
  schematicDir: string,
  stations: { id: string; lat: number; lon: number }[],
  generatedAt: string,
): Promise<number> {
  const outPath = path.join(schematicDir, "entrances.json");
  try {
    const osm = await fetchOverpass(overpassQuery(networkBbox(stations)));
    const file = bakeEntrances(osm, stations, generatedAt);
    await writeFile(outPath, JSON.stringify(file));
    return Object.keys(file.stations).length;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Skipped entrance overlay bake (${reason})`);
    return 0;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function main() {
  if (!(await fileExists(path.join(process.cwd(), "data", "network.json")))) {
    throw new Error("data/network.json is missing. Run npm run refresh-network.");
  }
  const result = await buildSchematics();
  console.log(
    `Wrote ${result.generated} generated schematics, skipped ${result.skipped} override(s), index ${result.stations} stations, ${result.chains} line chains, ${result.entrances} entrance overlay(s)`,
  );
}

const isCli = process.argv[1]?.includes("build-schematics");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
