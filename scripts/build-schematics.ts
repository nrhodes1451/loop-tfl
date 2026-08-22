/**
 * Generate invented schematic JSON for every station in data/network.json.
 * Skips ids that already have a top-level override (e.g. HUBKGX.json).
 *
 * Usage: npm run build-schematics
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSchematic } from "../src/lib/schematic/generate";
import { buildLineNetwork } from "../src/lib/schematic/lines";
import type { SchematicIndex, SchematicStation } from "../src/lib/schematic/types";
import type { NetworkData } from "../src/lib/types";

export async function buildSchematics(): Promise<{
  generated: number;
  skipped: number;
  stations: number;
  chains: number;
}> {
  const root = process.cwd();
  const schematicDir = path.join(root, "data", "schematic");
  const generatedDir = path.join(schematicDir, "generated");
  const networkPath = path.join(root, "data", "network.json");

  const network = JSON.parse(await readFile(networkPath, "utf8")) as NetworkData;

  const overrideIds = new Set<string>();
  const top = await readdir(schematicDir);
  for (const name of top) {
    if (
      !name.endsWith(".json") ||
      name === "index.json" ||
      name === "lines.json"
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
    const schematic = generateSchematic({
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      platforms,
      lifts,
      platformLiftChains,
      interchangeChains: hopsByStation.get(station.id) ?? [],
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

  return {
    generated,
    skipped,
    stations: index.stations.length,
    chains: lines.chains.length,
  };
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
    `Wrote ${result.generated} generated schematics, skipped ${result.skipped} override(s), index ${result.stations} stations, ${result.chains} line chains`,
  );
}

const isCli = process.argv[1]?.includes("build-schematics");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
