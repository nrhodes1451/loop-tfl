import { describe, expect, it } from "vitest";
import kgxJson from "../../../data/schematic/HUBKGX.json";
import { HUBKGX_ORIGIN, schematicLevelWorldY } from "./geo";
import { platformWorldY } from "./foi-layout";
import { schematicLevelForLine } from "./levels";
import { tubeRadiusM } from "./lu-scale";
import {
  buildLineNetwork,
  type LineNetwork,
} from "./lines";
import {
  applyFanout,
  buildTubeMeshes,
  clipChainStations,
  disposeTubeMeshes,
  tubeAnchorKey,
  worldAnchors,
} from "./tubes";
import type { SchematicStation } from "./types";

const kgx = kgxJson as SchematicStation;

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
        A: { victoria: { dx: 2, dz: 0 } },
      },
    });
    const base = worldAnchors(network, HUBKGX_ORIGIN);
    const fanned = applyFanout(network, base, 4, 1);
    const v = fanned.get(tubeAnchorKey("A", "victoria"))!;
    const n = fanned.get(tubeAnchorKey("A", "northern"))!;
    const bv = base.get(tubeAnchorKey("A", "victoria"))!;
    const bn = base.get(tubeAnchorKey("A", "northern"))!;
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
    const meshes = buildTubeMeshes(
      network,
      HUBKGX_ORIGIN,
      network.stations.B!,
      "low",
      50_000,
    );
    expect(meshes.length).toBeGreaterThan(0);
    const victoria = meshes.find((m) => m.lineId === "victoria")!;
    const anchors = worldAnchors(network, HUBKGX_ORIGIN);
    const a = anchors.get(tubeAnchorKey("A", "victoria"))!;
    const c = anchors.get(tubeAnchorKey("C", "victoria"))!;
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
    const a = anchors.get(tubeAnchorKey("HUBKGX", "circle"))!;
    expect(a.y).toBeCloseTo(platformWorldY("HUBKGX", "circle"), 9);
    expect(a.y).toBeCloseTo(-7, 5);
  });
});
