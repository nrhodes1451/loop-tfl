import { describe, expect, it } from "vitest";
import lambertPars from "three/src/renderers/shaders/ShaderChunk/lights_lambert_pars_fragment.glsl.js";
import {
  BUILDING_COLOR_HIGH,
  BUILDING_COLOR_LOW,
  buildingColorForHeight,
  buildingGeometry,
  buildingsToGeometry,
  disposeSurfaceTile,
  featuresToTileGeom,
  hallPrismEdges,
  hallsToBottomGeometry,
  ribbonGeometry,
  stairFlightBottomGeometry,
  stairFlightEdges,
  wrapLambertFragment,
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
    const pos = geom!.getAttribute("position")!;
    const idx = geom!.getIndex()!;
    expect(idx.count).toBe(6);
    for (let t = 0; t < 2; t++) {
      const i0 = idx.getX(t * 3);
      const i1 = idx.getX(t * 3 + 1);
      const i2 = idx.getX(t * 3 + 2);
      const ax = pos.getX(i0);
      const ay = pos.getY(i0);
      const az = pos.getZ(i0);
      const e1x = pos.getX(i1) - ax;
      const e1y = pos.getY(i1) - ay;
      const e1z = pos.getZ(i1) - az;
      const e2x = pos.getX(i2) - ax;
      const e2y = pos.getY(i2) - ay;
      const e2z = pos.getZ(i2) - az;
      const ny = e1z * e2x - e1x * e2z;
      expect(ny).toBeGreaterThan(0);
    }
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
