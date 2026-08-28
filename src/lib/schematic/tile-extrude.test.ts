import { afterEach, describe, expect, it } from "vitest";
import vtpbf from "vt-pbf";
import { HUBKGX_ORIGIN } from "./geo";
import {
  disposeSurfaceTile,
  featuresToTileGeom,
  type SurfaceTileGeom,
} from "./building-geom";
import { lonLatToTile, surfaceFromMvt, tileKey } from "./pmtiles";
import {
  enqueueTileExtrude,
  promoteTileExtrude,
  resetTileExtrudeQueueForTests,
} from "./tile-extrude";

const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);

function polyRing() {
  return [
    [200, 200],
    [500, 200],
    [500, 500],
    [200, 500],
    [200, 200],
  ];
}

function linePath() {
  return [
    [100, 100],
    [800, 100],
  ];
}

function mvtBytes() {
  return new Uint8Array(
    vtpbf.fromGeojsonVt({
      landuse: {
        features: [
          {
            id: 1,
            type: 3,
            geometry: [polyRing()],
            tags: { kind: "park" },
          },
        ],
      },
      water: {
        features: [
          {
            id: 2,
            type: 3,
            geometry: [polyRing()],
            tags: { kind: "water" },
          },
          {
            id: 3,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "other", kind_detail: "canal" },
          },
        ],
      },
      roads: {
        features: [
          {
            id: 4,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "highway" },
          },
        ],
      },
      buildings: {
        features: [
          {
            id: 5,
            type: 3,
            geometry: [polyRing()],
            tags: { height: 22 },
          },
        ],
      },
    }),
  );
}

function layerFingerprint(geom: SurfaceTileGeom[keyof SurfaceTileGeom]) {
  if (!geom) return null;
  const pos = geom.getAttribute("position");
  const col = geom.getAttribute("color");
  return {
    count: pos?.count ?? 0,
    first: pos ? [pos.getX(0), pos.getY(0), pos.getZ(0)] : null,
    last: pos
      ? [
          pos.getX(pos.count - 1),
          pos.getY(pos.count - 1),
          pos.getZ(pos.count - 1),
        ]
      : null,
    colors: col?.count ?? 0,
  };
}

function tileFingerprint(geom: SurfaceTileGeom) {
  return {
    land: layerFingerprint(geom.land),
    water: layerFingerprint(geom.water),
    roads: layerFingerprint(geom.roads),
    buildings: layerFingerprint(geom.buildings),
  };
}

function phaseOf(geom: SurfaceTileGeom) {
  if (geom.buildings) return "buildings";
  if (geom.roads) return "roads";
  return "flat";
}

function extrude(
  opts: {
    key: string;
    priority?: "wanted" | "preload";
    accept?: () => boolean;
    onUpdate?: (geom: SurfaceTileGeom) => void;
    bytes?: Uint8Array;
  },
): Promise<SurfaceTileGeom | null> {
  return new Promise((resolve) => {
    enqueueTileExtrude({
      key: opts.key,
      tile,
      origin: HUBKGX_ORIGIN,
      bytes: opts.bytes ?? mvtBytes(),
      priority: opts.priority ?? "wanted",
      accept: opts.accept ?? (() => true),
      onUpdate: opts.onUpdate ?? (() => {}),
      resolve,
    });
  });
}

afterEach(() => {
  resetTileExtrudeQueueForTests();
});

describe("enqueueTileExtrude", () => {
  it("matches featuresToTileGeom once every layer is done", async () => {
    const bytes = mvtBytes();
    const sync = featuresToTileGeom(surfaceFromMvt(bytes, tile, HUBKGX_ORIGIN));
    const queued = await extrude({ key: tileKey(tile), bytes });
    expect(queued).not.toBeNull();
    expect(tileFingerprint(queued!)).toEqual(tileFingerprint(sync));
    disposeSurfaceTile(sync);
    disposeSurfaceTile(queued);
  });

  it("paints land then roads then buildings, and other tiles before prisms", async () => {
    const phases: string[] = [];
    const a = extrude({
      key: "a",
      onUpdate: (geom) => phases.push(`a:${phaseOf(geom)}`),
    });
    const b = extrude({
      key: "b",
      onUpdate: (geom) => phases.push(`b:${phaseOf(geom)}`),
    });
    await Promise.all([a, b]);
    expect(phases).toEqual([
      "a:flat",
      "b:flat",
      "a:roads",
      "b:roads",
      "a:buildings",
      "b:buildings",
    ]);
    disposeSurfaceTile(await a);
    disposeSurfaceTile(await b);
  });

  it("runs neighbourhood tiles before preload", async () => {
    const phases: string[] = [];
    const wanted = extrude({
      key: "w",
      onUpdate: (geom) => phases.push(`w:${phaseOf(geom)}`),
    });
    const preload = extrude({
      key: "p",
      priority: "preload",
      onUpdate: (geom) => phases.push(`p:${phaseOf(geom)}`),
    });
    await Promise.all([wanted, preload]);
    expect(phases[0]).toBe("w:flat");
    expect(phases.at(-1)).toBe("p:buildings");
    expect(phases.indexOf("w:buildings")).toBeLessThan(phases.indexOf("p:flat"));
    disposeSurfaceTile(await wanted);
    disposeSurfaceTile(await preload);
  });

  it("promotes a preload job ahead of later preload work", async () => {
    const phases: string[] = [];
    const wanted = extrude({
      key: "w",
      onUpdate: (geom) => phases.push(`w:${phaseOf(geom)}`),
    });
    const first = extrude({
      key: "p1",
      priority: "preload",
      onUpdate: (geom) => phases.push(`p1:${phaseOf(geom)}`),
    });
    promoteTileExtrude("p1");
    const later = extrude({
      key: "p2",
      priority: "preload",
      onUpdate: (geom) => phases.push(`p2:${phaseOf(geom)}`),
    });
    await Promise.all([wanted, first, later]);
    expect(phases.indexOf("p1:flat")).toBeLessThan(phases.indexOf("p2:flat"));
    expect(phases.indexOf("w:buildings")).toBeLessThan(phases.indexOf("p2:flat"));
    disposeSurfaceTile(await wanted);
    disposeSurfaceTile(await first);
    disposeSurfaceTile(await later);
  });

  it("drops a job that is no longer wanted before any geom exists", async () => {
    const updates: SurfaceTileGeom[] = [];
    const geom = await extrude({
      key: "drop",
      accept: () => false,
      onUpdate: (g) => updates.push(g),
    });
    expect(geom).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
