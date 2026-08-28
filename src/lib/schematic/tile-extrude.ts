/**
 * Main-thread queue: decode MVT and extrude tile layers across frames.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  buildingsToGeometry,
  emptyTileGeom,
  featuresToFlatGeom,
  roadsToGeometry,
  type SurfaceTileGeom,
} from "./building-geom";
import { surfaceFromMvt, type TileCoord, type TileSurface } from "./pmtiles";
import type { LatLon } from "./geo";

export const TILE_EXTRUDE_BUDGET_MS = 8;

export type TileExtrudePriority = "wanted" | "preload";

type JobStep = "decode" | "flat" | "roads" | "buildings";

export type TileExtrudeJob = {
  key: string;
  tile: TileCoord;
  origin: LatLon;
  bytes: Uint8Array;
  priority: TileExtrudePriority;
  accept: () => boolean;
  onUpdate: (geom: SurfaceTileGeom) => void;
  resolve: (geom: SurfaceTileGeom | null) => void;
};

type Running = TileExtrudeJob & {
  step: JobStep;
  features: TileSurface | null;
  geom: SurfaceTileGeom;
};

const wanted: Running[] = [];
const preload: Running[] = [];
let ticking = false;
let scheduled = false;
let pumpGen = 0;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function dropFrom(list: Running[], job: Running) {
  const i = list.indexOf(job);
  if (i >= 0) list.splice(i, 1);
}

function rotateToBack(job: Running) {
  const list = wanted.includes(job) ? wanted : preload;
  dropFrom(list, job);
  list.push(job);
}

function bumpPriority(job: Running) {
  if (job.priority === "wanted") return;
  job.priority = "wanted";
  dropFrom(preload, job);
  wanted.push(job);
}

function findJob(key: string): Running | undefined {
  return wanted.find((j) => j.key === key) ?? preload.find((j) => j.key === key);
}

function takeJob(): Running | undefined {
  return wanted[0] ?? preload[0];
}

function advance(job: Running) {
  if (job.step === "decode") {
    job.features = surfaceFromMvt(job.bytes, job.tile, job.origin);
    job.step = "flat";
    return;
  }
  const features = job.features!;
  if (job.step === "flat") {
    const flat = featuresToFlatGeom(features);
    job.geom.land = flat.land;
    job.geom.water = flat.water;
    job.onUpdate(job.geom);
    job.step = "roads";
    return;
  }
  if (job.step === "roads") {
    job.geom.roads = roadsToGeometry(features.roads);
    job.onUpdate(job.geom);
    job.step = "buildings";
    return;
  }
  job.geom.buildings = buildingsToGeometry(features.buildings);
  job.onUpdate(job.geom);
  dropFrom(wanted, job);
  dropFrom(preload, job);
  job.resolve(job.geom);
}

async function pump() {
  const gen = pumpGen;
  ticking = true;
  try {
    while (takeJob()) {
      if (gen !== pumpGen) return;
      const sliceStart = performance.now();
      while (performance.now() - sliceStart < TILE_EXTRUDE_BUDGET_MS) {
        const job = takeJob();
        if (!job) break;
        if (!job.accept()) {
          dropFrom(wanted, job);
          dropFrom(preload, job);
          job.resolve(
            job.geom.land ||
              job.geom.water ||
              job.geom.roads ||
              job.geom.buildings
              ? job.geom
              : null,
          );
          continue;
        }
        const before = job.step;
        advance(job);
        if (before === "buildings") continue;
        // Other neighbourhood tiles get land/roads before this tile's prisms.
        rotateToBack(job);
      }
      if (!takeJob()) break;
      await nextFrame();
    }
  } finally {
    if (gen === pumpGen) ticking = false;
  }
}

function kick() {
  if (ticking || scheduled) return;
  scheduled = true;
  const gen = pumpGen;
  queueMicrotask(() => {
    scheduled = false;
    if (gen !== pumpGen || ticking) return;
    void pump();
  });
}

/**
 * Decode + extrude `bytes` across animation frames. Same key coalesces;
 * a later wanted enqueue promotes a preload job.
 */
export function enqueueTileExtrude(job: TileExtrudeJob): void {
  const existing = findJob(job.key);
  if (existing) {
    if (job.priority === "wanted") bumpPriority(existing);
    return;
  }
  const running: Running = {
    ...job,
    step: "decode",
    features: null,
    geom: emptyTileGeom(),
  };
  if (job.priority === "wanted") wanted.push(running);
  else preload.push(running);
  kick();
}

/** If a preload job is already queued, run it with neighbourhood tiles. */
export function promoteTileExtrude(key: string) {
  const existing = findJob(key);
  if (existing) bumpPriority(existing);
}

export function resetTileExtrudeQueueForTests() {
  wanted.length = 0;
  preload.length = 0;
  pumpGen++;
  ticking = false;
  scheduled = false;
}
