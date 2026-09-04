import { describe, expect, it } from "vitest";
import lambertPars from "three/src/renderers/shaders/ShaderChunk/lights_lambert_pars_fragment.glsl.js";
import {
  BUILDING_COLOR_HIGH,
  BUILDING_COLOR_LOW,
  buildingColorForHeight,
  buildingGeometry,
  buildingsToGeometry,
  disposeSurfaceTile,
  featuresToFlatGeom,
  featuresToTileGeom,
  roadsToGeometry,
  hallPickGeometry,
  hallPrismEdges,
  hallsToBottomGeometry,
  ribbonGeometry,
  stairFlightBottomGeometry,
  stairFlightEdges,
  inclinedFlightEdges,
  stairFlightPickGeometry,
  wrapLambertFragment,
  type SurfaceTileGeom,
  type TileGeomFeatures,
} from "./building-geom";

function uniqueNormals(geom: { getAttribute: (name: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } | undefined }) {
  const attr = geom.getAttribute("normal");
  if (!attr) return [];
  const keys = new Set<string>();
  for (let i = 0; i < attr.count; i++) {
    keys.add(
      `${attr.getX(i).toFixed(3)},${attr.getY(i).toFixed(3)},${attr.getZ(i).toFixed(3)}`,
    );
  }
  return [...keys];
}

function parseHexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function allFaceNy(geom: {
  getAttribute: (name: string) => {
    getX: (i: number) => number;
    getY: (i: number) => number;
    getZ: (i: number) => number;
  };
  getIndex: () => { count: number; getX: (i: number) => number } | null;
}): number[] {
  const pos = geom.getAttribute("position");
  const idx = geom.getIndex();
  if (!idx) return [];
  const out: number[] = [];
  for (let t = 0; t < idx.count / 3; t++) {
    const i0 = idx.getX(t * 3);
    const i1 = idx.getX(t * 3 + 1);
    const i2 = idx.getX(t * 3 + 2);
    const e1x = pos.getX(i1) - pos.getX(i0);
    const e1z = pos.getZ(i1) - pos.getZ(i0);
    const e2x = pos.getX(i2) - pos.getX(i0);
    const e2z = pos.getZ(i2) - pos.getZ(i0);
    out.push(e1z * e2x - e1x * e2z);
  }
  return out;
}

function near(
  p: { x: number; z: number },
  x: number,
  z: number,
  eps = 1e-5,
): boolean {
  return Math.hypot(p.x - x, p.z - z) < eps;
}

describe("buildingGeometry normals", () => {
  it("keeps distinct roof and wall normals after extrusion", () => {
    const geom = buildingGeometry(
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      12,
    );
    const normals = uniqueNormals(geom);
    expect(normals.length).toBeGreaterThan(2);
    expect(normals.some((n) => n.startsWith("0.000,1.000,"))).toBe(true);
    geom.dispose();
  });

  it("lifts the prism so min_height is the base and height is the roof", () => {
    const geom = buildingGeometry(
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      135,
      100,
    );
    const pos = geom.getAttribute("position")!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeCloseTo(100, 5);
    expect(maxY).toBeCloseTo(135, 5);
    geom.dispose();
  });

  it("preserves those normals when merging a tile batch", () => {
    const merged = buildingsToGeometry([
      {
        height: 10,
        ring: [
          [0, 0],
          [6, 0],
          [6, 4],
          [0, 4],
        ],
      },
      {
        height: 16,
        ring: [
          [12, 0],
          [20, 0],
          [20, 8],
          [12, 8],
        ],
      },
    ]);
    expect(merged).not.toBeNull();
    expect(uniqueNormals(merged!).length).toBeGreaterThan(2);
    expect(merged!.getAttribute("color")).toBeTruthy();
    expect(merged!.getAttribute("color")!.count).toBe(
      merged!.getAttribute("position")!.count,
    );
    merged!.dispose();
  });
});

describe("buildingColorForHeight", () => {
  it("uses the pale endpoint at 10 m and the dense endpoint at 80 m", () => {
    const low = buildingColorForHeight(10);
    const high = buildingColorForHeight(80);
    const expectLow = parseHexRgb(BUILDING_COLOR_LOW);
    const expectHigh = parseHexRgb(BUILDING_COLOR_HIGH);
    expect(low[0]).toBeCloseTo(expectLow[0], 5);
    expect(low[1]).toBeCloseTo(expectLow[1], 5);
    expect(low[2]).toBeCloseTo(expectLow[2], 5);
    expect(high[0]).toBeCloseTo(expectHigh[0], 5);
    expect(high[1]).toBeCloseTo(expectHigh[1], 5);
    expect(high[2]).toBeCloseTo(expectHigh[2], 5);
  });
});

describe("ribbonGeometry", () => {
  it("emits a quad (4 vertices, 6 indices) for a two-point path", () => {
    const geom = ribbonGeometry(
      [
        [0, 0],
        [10, 0],
      ],
      8,
    );
    expect(geom).not.toBeNull();
    expect(geom!.getAttribute("position")!.count).toBe(4);
    expect(geom!.getIndex()!.count).toBe(6);
    geom!.dispose();
  });

  it("winds both triangles so the front face points +Y", () => {
    const geom = ribbonGeometry(
      [
        [0, 0],
        [10, 0],
      ],
      8,
    );
    expect(geom).not.toBeNull();
    expect(allFaceNy(geom!).every((ny) => ny > 0)).toBe(true);
    geom!.dispose();
  });

  it("miters a 90° corner so segments share the join", () => {
    const half = 4;
    const geom = ribbonGeometry(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      half * 2,
    );
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute("position")!;
    expect(pos.count).toBe(8);
    const endL = { x: pos.getX(2), z: pos.getZ(2) };
    const endR = { x: pos.getX(3), z: pos.getZ(3) };
    expect(pos.getX(4)).toBeCloseTo(endL.x, 5);
    expect(pos.getZ(4)).toBeCloseTo(endL.z, 5);
    expect(pos.getX(5)).toBeCloseTo(endR.x, 5);
    expect(pos.getZ(5)).toBeCloseTo(endR.z, 5);
    const verts = [...Array(pos.count)].map((_, i) => ({
      x: pos.getX(i),
      z: pos.getZ(i),
    }));
    expect(verts.some((p) => near(p, -10 - half, -half))).toBe(true);
    expect(verts.some((p) => near(p, -10 + half, half))).toBe(true);
    expect(allFaceNy(geom!).every((ny) => ny > 0)).toBe(true);
    geom!.dispose();
  });
});

describe("stairFlightEdges", () => {
  it("outlines 8 risers from street to -3.2 m along an east–west path", () => {
    const pts = stairFlightEdges(
      [
        [0, 0],
        [10, 0],
      ],
      2.5,
      8,
      3.2,
    );
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length % 2).toBe(0);
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
    }
    expect(maxY).toBeCloseTo(0, 5);
    expect(minY).toBeCloseTo(-3.2, 5);
    expect(maxX).toBeGreaterThan(-1);
    expect(minX).toBeLessThan(-9);
    const ys = new Set(pts.map((p) => p[1].toFixed(1)));
    expect(ys.has("0.0")).toBe(true);
    expect(ys.has("-0.4")).toBe(true);
    expect(ys.has("-3.2")).toBe(true);
  });
});

describe("inclinedFlightEdges", () => {
  it("builds a segmented cage that drops in Y along the run", () => {
    const pts = inclinedFlightEdges([0, 0, 0], [4, -5, 2], 1, 8);
    expect(pts.length).toBeGreaterThan(16);
    expect(pts.length % 2).toBe(0);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(0, 5);
    expect(Math.min(...ys)).toBeCloseTo(-5, 5);
  });
});

describe("hallPrismEdges", () => {
  it("outlines a prism from Y=0 to hall height", () => {
    const pts = hallPrismEdges(
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
        [0, 0],
      ],
      7,
    );
    expect(pts.length).toBe(24);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(7, 5);
    const ys = new Set(pts.map((p) => p[1].toFixed(1)));
    expect(ys.has("0.0")).toBe(true);
    expect(ys.has("7.0")).toBe(true);
  });
});

describe("hallsToBottomGeometry", () => {
  it("puts a glass floor at Y=0", () => {
    const geom = hallsToBottomGeometry([
      {
        height: 7,
        ring: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
      },
    ]);
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute("position")!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(0, 5);
    geom!.dispose();
  });
});

describe("overlay pick volumes", () => {
  it("extrudes a hall prism for pointer hits", () => {
    const geom = hallPickGeometry(
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      7,
    );
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute("position")!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(maxY).toBeCloseTo(7, 5);
    geom!.dispose();
  });

  it("covers a stair flight from street to the drop", () => {
    const geom = stairFlightPickGeometry(
      [
        [0, 0],
        [10, 0],
      ],
      2.5,
      3.2,
    );
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute("position")!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(maxY).toBeCloseTo(0, 5);
    expect(minY).toBeCloseTo(-3.2, 5);
    geom!.dispose();
  });
});

describe("stairFlightBottomGeometry", () => {
  it("puts a floor slab at the stair drop", () => {
    const geom = stairFlightBottomGeometry(
      [
        [0, 0],
        [10, 0],
      ],
      2.5,
      8,
      3.2,
    );
    expect(geom).not.toBeNull();
    const pos = geom!.getAttribute("position")!;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeCloseTo(-3.2, 5);
    expect(maxY).toBeCloseTo(-3.2, 5);
    geom!.dispose();
  });
});

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

function sampleTileFeatures(): TileGeomFeatures {
  return {
    land: [
      {
        ring: [
          [0, 0],
          [30, 0],
          [30, 20],
          [0, 20],
        ],
      },
    ],
    water: [
      {
        ring: [
          [0, 0],
          [20, 0],
          [20, 12],
          [0, 12],
        ],
      },
    ],
    waterways: [
      {
        path: [
          [0, 0],
          [30, 0],
        ],
      },
    ],
    roads: [
      { path: [[0, 0], [40, 0]], kind: "highway" },
      { path: [[0, 0], [0, 40]], kind: "major_road" },
    ],
    buildings: [
      { ring: [[0, 0], [8, 0], [8, 8], [0, 8]], height: 12 },
      { ring: [[10, 0], [18, 0], [18, 6], [10, 6]], height: 40, minHeight: 4 },
    ],
  };
}

describe("featuresToTileGeom", () => {
  it("merges water polygons and canal ribbons into one water mesh", () => {
    const geom = featuresToTileGeom({
      land: [],
      water: [
        {
          ring: [
            [0, 0],
            [20, 0],
            [20, 12],
            [0, 12],
          ],
        },
      ],
      waterways: [
        {
          path: [
            [0, 0],
            [30, 0],
          ],
        },
      ],
      roads: [],
      buildings: [],
    });
    expect(geom.water).not.toBeNull();
    expect(geom.water!.getAttribute("position")!.count).toBeGreaterThan(6);
    disposeSurfaceTile(geom);
  });

  it("stepwise layers match the merged helper", () => {
    const features = sampleTileFeatures();
    const sync = featuresToTileGeom(features);
    const flat = featuresToFlatGeom(features);
    expect(flat.roads).toBeNull();
    expect(flat.buildings).toBeNull();
    const stepped: SurfaceTileGeom = {
      land: flat.land,
      water: flat.water,
      roads: roadsToGeometry(features.roads),
      buildings: buildingsToGeometry(features.buildings),
    };
    expect(tileFingerprint(stepped)).toEqual(tileFingerprint(sync));
    disposeSurfaceTile(sync);
    disposeSurfaceTile(stepped);
  });
});

describe("wrapLambertFragment", () => {
  it("rewrites Three.js Lambert N·L into half-Lambert wrap", () => {
    const out = wrapLambertFragment(lambertPars);
    expect(out).toContain(
      "float dotNL = saturate( 0.5 * dot( geometryNormal, directLight.direction ) + 0.5 );",
    );
    expect(out).not.toContain(
      "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );",
    );
  });
});
