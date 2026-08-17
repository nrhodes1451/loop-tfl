/**
 * Fetch OSM building footprints around TfL King's Cross and write
 * data/osm/hubkgx-buildings.json (ENU metres, already clipped).
 *
 * Usage: npm run fetch-osm-buildings
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HUBKGX_ORIGIN,
  SURFACE_SIZE_M,
} from "../src/lib/schematic/geo";
import {
  buildingsFromOverpass,
  overpassBbox,
  type OverpassResponse,
  type OsmSurface,
} from "../src/lib/schematic/osm";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

function overpassQuery(south: number, west: number, north: number, east: number): string {
  return `[out:json][timeout:60];
(
  way["building"](${south},${west},${north},${east});
);
out geom;`;
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/json",
      "User-Agent": "tubenet/0.1 (https://loop.penrose.tools; OSM buildings bake)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as OverpassResponse;
}

export async function fetchOsmBuildings(): Promise<OsmSurface> {
  const bbox = overpassBbox(HUBKGX_ORIGIN, SURFACE_SIZE_M);
  const query = overpassQuery(bbox.south, bbox.west, bbox.north, bbox.east);
  const json = await fetchOverpass(query);
  const buildings = buildingsFromOverpass(
    json.elements ?? [],
    HUBKGX_ORIGIN,
    SURFACE_SIZE_M,
  );
  return {
    stationId: "HUBKGX",
    origin: {
      lat: HUBKGX_ORIGIN.lat,
      lon: HUBKGX_ORIGIN.lon,
      source: HUBKGX_ORIGIN.source,
    },
    sizeM: SURFACE_SIZE_M,
    fetchedAt: new Date().toISOString(),
    attribution: "© OpenStreetMap contributors",
    buildings,
  };
}

async function main() {
  const surface = await fetchOsmBuildings();
  const outDir = path.join(process.cwd(), "data", "osm");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "hubkgx-buildings.json");
  await writeFile(outPath, `${JSON.stringify(surface)}\n`);
  console.log(
    `Wrote ${outPath}: ${surface.buildings.length} buildings in ${surface.sizeM} m box`,
  );
}

const isCli = process.argv[1]?.includes("fetch-osm-buildings");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
