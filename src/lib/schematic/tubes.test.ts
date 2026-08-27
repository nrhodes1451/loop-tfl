import { describe, expect, it } from "vitest";
import { CatmullRomCurve3, Vector3 } from "three";
import { kgxStation } from "./kgx.fixture";
import { HUBKGX_ORIGIN, schematicLevelWorldY } from "./geo";
import { platformWorldY } from "./foi-layout";
import { schematicLevelForLine } from "./levels";
import {
  DEEP_TUBE_DIAMETER_M,
  PLATFORM_LENGTH_M,
  PLATFORM_WIDTH_M,
  tubeRadiusM,
} from "./lu-scale";
import {
  buildLineNetwork,
  type LineNetwork,
} from "./lines";
import {
  TUBE_MIN_RADIUS_M,
  TUBE_SEGMENT_M,
  alignTrackPair,
  applyFanout,
  buildTubeMeshes,
  clipChainStations,
  disposeTubeMeshes,
  trackControlPoints,
  tubeAnchorKey,
  worldAnchors,
} from "./tubes";

const kgx = kgxStation;

function toyNetwork(overrides?: Partial<LineNetwork>): LineNetwork {
  return {
    generatedAt: "test",
    stations: {
      A: { lat: 51.53, lon: -0.12 },
      B: { lat: 51.54, lon: -0.12 },
      C: { lat: 51.55, lon: -0.12 },
      D: { lat: 51.53, lon: -0.13 },
    },
    anchors: {},
    angles: {
      A: { victoria: 0 },
      B: { victoria: 0 },
    },
    foi: {},
    chains: [
      {
        id: "victoria::0",
        lineId: "victoria",
        level: schematicLevelForLine("victoria"),
        stationIds: ["A", "B", "C"],
      },
    ],
    ...overrides,
  };
}

describe("worldAnchors", () => {
  it("places Y at the FOI / typical platform centre", () => {
    const network = toyNetwork();
    const anchors = worldAnchors(network, HUBKGX_ORIGIN);
    const a = anchors.get(tubeAnchorKey("A", "victoria"))!;
    expect(a.y).toBeCloseTo(platformWorldY("A", "victoria"), 9);
    expect(a.y).toBeCloseTo(-20, 9);
    expect(a.y).not.toBeCloseTo(
      schematicLevelWorldY(schematicLevelForLine("victoria")),
      0,
    );
  });
});

describe("applyFanout", () => {
  it("offsets coincident anchors symmetrically and leaves distinct ones", () => {
    const network = toyNetwork({
      chains: [
        {
          id: "victoria::0",
          lineId: "victoria",
          level: -4,
          stationIds: ["A", "B"],
        },
        {
          id: "northern::0",
          lineId: "northern",
          level: -6,
          stationIds: ["A", "D"],
        },
      ],
      anchors: {
        A: {
          victoria: [
            { dx: 2, dz: 0 },
            { dx: 4, dz: 0 },
          ],
        },
      },
    });
    const base = worldAnchors(network, HUBKGX_ORIGIN);
    const fanned = applyFanout(network, base, 4, 1);
    const v = fanned.get(tubeAnchorKey("A", "victoria", 0))!;
    const n = fanned.get(tubeAnchorKey("A", "northern", 0))!;
    const bv = base.get(tubeAnchorKey("A", "victoria", 0))!;
    const bn = base.get(tubeAnchorKey("A", "northern", 0))!;
    // Distinct platform offset → not coincident, unmoved.
    expect(v.x).toBeCloseTo(bv.x, 8);
    expect(v.z).toBeCloseTo(bv.z, 8);
    expect(n.x).toBeCloseTo(bn.x, 8);

    const coincident = toyNetwork({
      chains: [
        {
          id: "circle::0",
          lineId: "circle",
          level: -2,
          stationIds: ["A", "B"],
        },
        {
          id: "hammersmith-city::0",
          lineId: "hammersmith-city",
          level: -2,
          stationIds: ["A", "B"],
        },
      ],
      angles: { A: { circle: 0, "hammersmith-city": 0 } },
    });
    const cBase = worldAnchors(coincident, HUBKGX_ORIGIN);
    const cFan = applyFanout(coincident, cBase, 4, 1);
    const c = cFan.get(tubeAnchorKey("A", "circle"))!;
    const h = cFan.get(tubeAnchorKey("A", "hammersmith-city"))!;
    const midX = (c.x + h.x) / 2;
    const midZ = (c.z + h.z) / 2;
    const orig = cBase.get(tubeAnchorKey("A", "circle"))!;
    expect(midX).toBeCloseTo(orig.x, 6);
    expect(midZ).toBeCloseTo(orig.z, 6);
    expect(Math.hypot(c.x - h.x, c.z - h.z)).toBeCloseTo(
      2 * tubeRadiusM("circle"),
      5,
    );
  });
});

describe("clipChainStations", () => {
  it("keeps a segment when only one endpoint is in range", () => {
    const network = toyNetwork();
    const focus = network.stations.A!;
    const runs = clipChainStations(
      ["A", "B", "C"],
      network,
      focus,
      50,
    );
    // A is in range; B is the neighbour of a visible station; C is not.
    expect(runs).toEqual([["A", "B"]]);
  });

  it("keeps the whole chain when the middle station is in range", () => {
    const network = toyNetwork();
    const runs = clipChainStations(
      ["A", "B", "C"],
      network,
      network.stations.B!,
      50,
    );
    expect(runs).toEqual([["A", "B", "C"]]);
  });
});

describe("buildTubeMeshes", () => {
  it("samples a centreline that starts and ends on the chain anchors", () => {
    const network = toyNetwork();
    const meshes = buildTubeMeshes(network, HUBKGX_ORIGIN, "low");
    expect(meshes.filter((m) => m.lineId === "victoria")).toHaveLength(2);
    const withDefaultRadius = buildTubeMeshes(
      network,
      HUBKGX_ORIGIN,
      network.stations.B!,
      "low",
    );
    expect(withDefaultRadius.filter((m) => m.lineId === "victoria")).toHaveLength(2);
    disposeTubeMeshes(withDefaultRadius);
    const victoria = meshes.find((m) => m.lineId === "victoria" && m.track === 0)!;
    const anchors = worldAnchors(network, HUBKGX_ORIGIN);
    const pts = trackControlPoints(
      network,
      "victoria",
      ["A", "B", "C"],
      0,
      anchors,
      false,
    );
    const a = pts[0]!;
    const c = pts[pts.length - 1]!;
    const first = victoria.centreline[0]!;
    const last = victoria.centreline[victoria.centreline.length - 1]!;
    expect(first[0]).toBeCloseTo(a.x, 5);
    expect(first[1]).toBeCloseTo(a.y, 5);
    expect(first[2]).toBeCloseTo(a.z, 5);
    expect(last[0]).toBeCloseTo(c.x, 5);
    expect(last[1]).toBeCloseTo(c.y, 5);
    expect(last[2]).toBeCloseTo(c.z, 5);
    disposeTubeMeshes(meshes);
  });

  it("keeps a single mesh for a cut-and-cover line", () => {
    const network = toyNetwork({
      chains: [
        {
          id: "circle::0",
          lineId: "circle",
          level: -2,
          stationIds: ["A", "B", "C"],
        },
      ],
      angles: { A: { circle: 0 }, B: { circle: 0 } },
    });
    const meshes = buildTubeMeshes(network, HUBKGX_ORIGIN, "low");
    expect(meshes.filter((m) => m.lineId === "circle")).toHaveLength(1);
    disposeTubeMeshes(meshes);
  });

  it("aims the local tangent at a FOI station along the platform bearing", () => {
    const network = toyNetwork({
      stations: {
        A: { lat: 51.53, lon: -0.13 },
        B: { lat: 51.53, lon: -0.12 },
        C: { lat: 51.53, lon: -0.11 },
      },
      angles: {
        A: { victoria: Math.PI / 2 },
        B: { victoria: 0 },
        C: { victoria: Math.PI / 2 },
      },
      foi: { B: { victoria: true } },
    });
    const anchors = worldAnchors(network, HUBKGX_ORIGIN);
    const pts = trackControlPoints(
      network,
      "victoria",
      ["A", "B", "C"],
      0,
      anchors,
      false,
    );
    const b = anchors.get(tubeAnchorKey("B", "victoria", 0))!;
    const station = pts.reduce(
      (best, p) => {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        return d < best.d ? { p, d } : best;
      },
      { p: pts[0]!, d: Infinity },
    ).p;
    const along = pts
      .map((p) => Math.hypot(p.x - station.x, p.z - station.z))
      .filter((s) => s > 1);
    const nearestEnd = along.reduce(
      (best, s) =>
        Math.abs(s - PLATFORM_LENGTH_M / 2) < Math.abs(best - PLATFORM_LENGTH_M / 2)
          ? s
          : best,
      along[0]!,
    );
    expect(nearestEnd).toBeCloseTo(PLATFORM_LENGTH_M / 2, 0);
    expect(along.every((s) => Math.abs(s - TUBE_SEGMENT_M) > 5 || s > 50)).toBe(
      true,
    );

    const curve = new CatmullRomCurve3(
      pts.map((p) => new Vector3(p.x, p.y, p.z)),
      false,
      "centripetal",
    );
    const tangentAt = (x: number, z: number) => {
      let bestT = 0.5;
      let bestD = Infinity;
      for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        const p = curve.getPointAt(t);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) {
          bestD = d;
          bestT = t;
        }
      }
      const tan = curve.getTangentAt(bestT);
      const heading = Math.atan2(tan.x, tan.z);
      const folded = Math.abs(heading);
      return Math.min(folded, Math.PI - folded);
    };
    expect(tangentAt(station.x, station.z)).toBeLessThan(0.35);
    const endZ = station.z + PLATFORM_LENGTH_M / 2;
    expect(tangentAt(station.x, endZ)).toBeLessThan(0.35);
    const beyond = PLATFORM_LENGTH_M / 2 + TUBE_SEGMENT_M;
    // 40 m past the end at R = 200 m → at most ~0.2 rad if the lead-in is working.
    expect(tangentAt(station.x, station.z + beyond)).toBeLessThan(
      (TUBE_SEGMENT_M / TUBE_MIN_RADIUS_M) * 1.5,
    );
  });
});

describe("alignTrackPair", () => {
  it("puts track 1 on the right of the forward direction", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 10, y: 0, z: 0 };
    const [left, right] = alignTrackPair(a, b, { x: 0, z: 1 });
    // forward +Z, right is +X.
    expect(right.x).toBeGreaterThan(left.x);
  });
});

describe("worldAnchors deep-level pair", () => {
  it("invents two tracks a platform-width plus tunnel apart", () => {
    const anchors = worldAnchors(toyNetwork(), HUBKGX_ORIGIN);
    const a0 = anchors.get(tubeAnchorKey("A", "victoria", 0))!;
    const a1 = anchors.get(tubeAnchorKey("A", "victoria", 1))!;
    expect(Math.hypot(a1.x - a0.x, a1.z - a0.z)).toBeCloseTo(
      PLATFORM_WIDTH_M + DEEP_TUBE_DIAMETER_M,
      5,
    );
  });
});

describe("HUBKGX circle anchor Y", () => {
  it("matches the placed circle platform Y", () => {
    const withNeighbour = buildLineNetwork({
      generatedAt: "test",
      stations: [
        {
          id: "HUBKGX",
          lat: HUBKGX_ORIGIN.lat,
          lon: HUBKGX_ORIGIN.lon,
        },
        { id: "NEXT", lat: 51.54, lon: -0.12 },
      ],
      edges: [{ from: "HUBKGX", to: "NEXT", lineId: "circle" }],
      schematics: new Map([["HUBKGX", kgx]]),
    });
    const anchors = worldAnchors(withNeighbour, HUBKGX_ORIGIN);
    const a = anchors.get(tubeAnchorKey("HUBKGX", "circle", 0))!;
    expect(a.y).toBeCloseTo(platformWorldY("HUBKGX", "circle"), 9);
    expect(a.y).toBeCloseTo(-7, 5);
  });
});
