/**
 * Fetch TfL line sequences + station topology zip and write data/network.json
 *
 * Usage: npm run refresh-network
 * Optional: TFL_APP_KEY=... npm run refresh-network
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import {
  buildNetworkFromSources,
  MODES,
  routeSequenceFromStopPoints,
} from "../src/lib/tfl/build-network";
import {
  tflFetch,
  tflUrl,
  type TflLine,
  type TflRouteSequence,
} from "../src/lib/tfl/client";
import type { CsvRow, TopologyInputs } from "../src/lib/tfl/topology";

function parseCsv(buf: Buffer): CsvRow[] {
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];
}

function findCsv(zip: AdmZip, name: string): Buffer {
  const entries = zip.getEntries();
  const hit = entries.find(
    (e) =>
      e.entryName.toLowerCase().endsWith(`/${name.toLowerCase()}`) ||
      e.entryName.toLowerCase() === name.toLowerCase(),
  );
  if (!hit) {
    const names = entries.map((e) => e.entryName).join(", ");
    throw new Error(`Missing ${name} in zip. Found: ${names}`);
  }
  return hit.getData();
}

async function fetchLines(): Promise<TflLine[]> {
  const all: TflLine[] = [];
  const seen = new Set<string>();
  for (const mode of MODES) {
    const lines = await tflFetch<TflLine[]>(`/Line/Mode/${mode}`);
    for (const line of lines) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      all.push(line);
    }
  }
  return all;
}

type TflStopPointRaw = {
  id: string;
  commonName: string;
  lat: number;
  lon: number;
  stationNaptan?: string;
  parentId?: string;
  topMostParentId?: string;
};

async function fetchSequences(lines: TflLine[]): Promise<TflRouteSequence[]> {
  const out: TflRouteSequence[] = [];
  for (const line of lines) {
    try {
      const seq = await tflFetch<TflRouteSequence>(
        `/Line/${line.id}/Route/Sequence/all`,
      );
      const hasStops = (seq.stopPointSequences ?? []).some(
        (b) => (b.stopPoint?.length ?? 0) > 0,
      );
      if (hasStops) {
        out.push(seq);
        process.stdout.write(`  sequence ${line.id}\n`);
      } else {
        // TfL sometimes returns an empty Route/Sequence during part closures
        // (Bakerloo, Aug 2026). Fall back to StopPoints + nearest-neighbour order.
        const stops = await tflFetch<TflStopPointRaw[]>(
          `/Line/${line.id}/StopPoints`,
        );
        if (stops.length === 0) {
          console.warn(`  skip ${line.id}: empty sequence and no stop points`);
        } else {
          out.push(routeSequenceFromStopPoints(line, stops));
          process.stdout.write(
            `  sequence ${line.id} (stop-points fallback, ${stops.length} stops)\n`,
          );
        }
      }
    } catch (err) {
      console.warn(`  skip ${line.id}:`, (err as Error).message);
    }
    // Gentle pacing for public API
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

async function fetchTopology(): Promise<TopologyInputs> {
  const url = tflUrl(
    "https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip",
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Topology zip failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  return {
    stations: parseCsv(findCsv(zip, "Stations.csv")),
    platforms: parseCsv(findCsv(zip, "Platforms.csv")),
    platformServices: parseCsv(findCsv(zip, "PlatformServices.csv")),
    lifts: parseCsv(findCsv(zip, "Lifts.csv")),
    sameLevelPaths: parseCsv(findCsv(zip, "SameLevelPaths.csv")),
    rampRoutes: parseCsv(findCsv(zip, "RampRoutes.csv")),
  };
}

async function main() {
  console.log("Fetching lines…");
  const lines = await fetchLines();
  console.log(`  ${lines.length} lines`);

  console.log("Fetching route sequences…");
  const sequences = await fetchSequences(lines);

  console.log("Fetching station topology zip…");
  const topology = await fetchTopology();
  console.log(
    `  stations=${topology.stations.length} platforms=${topology.platforms.length} lifts=${topology.lifts.length}`,
  );

  const network = buildNetworkFromSources({ lines, sequences, topology });
  const outDir = path.join(process.cwd(), "data");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "network.json");
  await writeFile(outPath, JSON.stringify(network));
  console.log(
    `Wrote ${outPath}: ${network.stations.length} stations, ${network.edges.length} edges, ${network.platforms.length} platforms, ${network.lifts.length} lifts`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
