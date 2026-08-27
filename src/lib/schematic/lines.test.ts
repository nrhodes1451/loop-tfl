import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import kgxJson from "../../../data/schematic/HUBKGX.json";
import { platformWorldY } from "./foi-layout";
import {
  HUBKGX_ORIGIN,
  SCHEMATIC_METRES_PER_UNIT,
  latLonToWorld,
  placeSchematicAt,
  schematicLevelWorldY,
  schematicWorldOffset,
} from "./geo";
import { generateSchematic, type GenerateStationInput } from "./generate";
import { schematicLevelForLine } from "./levels";
import {
  buildLineNetwork,
  lineAnchor,
  lineAnchorWorld,
  platformAnchorOffset,
  stationLineAngle,
  streetCentroid,
  walkLineChains,
} from "./lines";
import { buildSceneGeometry } from "./scene";
import type { NetworkData } from "../types";
import type { SchematicStation } from "./types";

const kgx = kgxJson as SchematicStation;

const sampleInput: GenerateStationInput = {
  id: "HUBTEST",
  name: "Test Station",
  lat: 51.5,
  lon: -0.12,
  platforms: [
    {
      id: "HUBTEST-Plat01::victoria::North",
      lineId: "victoria",
      direction: "North",
      label: "P1",
    },
  ],
  lifts: [],
  platformLiftChains: [],
  interchangeChains: [],
};

describe("walkLineChains", () => {
  it("walks a path from termini and splits at a junction", () => {
    const chains = walkLineChains([
      { from: "A", to: "B", lineId: "victoria" },
      { from: "B", to: "C", lineId: "victoria" },
      { from: "B", to: "D", lineId: "victoria" },
      { from: "X", to: "Y", lineId: "northern" },
    ]);
    const victoria = chains.filter((c) => c.lineId === "victoria");
    const northern = chains.filter((c) => c.lineId === "northern");
    expect(northern).toHaveLength(1);
    expect(northern[0]!.stationIds).toEqual(["X", "Y"]);
    expect(victoria).toHaveLength(3);
    const ids = victoria.map((c) => c.stationIds.join("-")).sort();
    expect(ids).toEqual(["A-B", "B-C", "B-D"].sort());
  });

  it("is deterministic across runs", () => {
    const edges = [
      { from: "C", to: "B", lineId: "circle" },
      { from: "A", to: "B", lineId: "circle" },
      { from: "B", to: "D", lineId: "circle" },
    ];
    expect(walkLineChains(edges)).toEqual(walkLineChains(edges));
  });

  it("marks a 2-regular cycle as closed", () => {
    const chains = walkLineChains([
      { from: "A", to: "B", lineId: "circle" },
      { from: "B", to: "C", lineId: "circle" },
      { from: "C", to: "A", lineId: "circle" },
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.closed).toBe(true);
    expect(chains[0]!.stationIds).toHaveLength(3);
  });
});

describe("platformAnchorOffset", () => {
  it("is the platform centroid minus the street centroid", () => {
    const offset = platformAnchorOffset(kgx.nodes, "circle");
    const street = streetCentroid(kgx.nodes);
    const plats = kgx.nodes.filter(
      (n) => n.type === "platform" && n.lineId === "circle",
    );
    const cx = plats.reduce((s, n) => s + n.x, 0) / plats.length;
    const cy = plats.reduce((s, n) => s + n.y, 0) / plats.length;
    expect(offset.dx).toBeCloseTo(cx - street.x, 8);
    expect(offset.dz).toBeCloseTo(cy - street.y, 8);
    expect(Math.hypot(offset.dx, offset.dz)).toBeGreaterThan(1);
  });

  it("falls back to zero when the line has no platform node", () => {
    expect(platformAnchorOffset(kgx.nodes, "hammersmith-city")).toEqual({
      dx: 0,
      dz: 0,
    });
  });
});

describe("stationLineAngle", () => {
  it("points a +Z-long slab along the neighbour direction at a terminus", () => {
    const world = (id: string) => {
      if (id === "A") return { x: 0, z: 0 };
      if (id === "B") return { x: 0, z: 100 };
      return { x: 0, z: 0 };
    };
    // Neighbour is +Z, so long axis already matches: atan2(0, 100) = 0.
    expect(stationLineAngle("A", ["B"], world)).toBeCloseTo(0, 8);
  });

  it("uses prev→next at a through-station", () => {
    const world = (id: string) => {
      if (id === "A") return { x: -50, z: 0 };
      if (id === "B") return { x: 0, z: 0 };
      if (id === "C") return { x: 50, z: 0 };
      return { x: 0, z: 0 };
    };
    // Tangent is +X (west). atan2(100, 0) = π/2.
    expect(stationLineAngle("B", ["A", "C"], world)).toBeCloseTo(Math.PI / 2, 8);
  });
});

describe("buildLineNetwork", () => {
  const schematic = generateSchematic(sampleInput);
  const network = buildLineNetwork({
    generatedAt: "test",
    stations: [
      { id: "HUBTEST", lat: 51.5, lon: -0.12 },
      { id: "NEXT", lat: 51.51, lon: -0.12 },
    ],
    edges: [{ from: "HUBTEST", to: "NEXT", lineId: "victoria" }],
    schematics: new Map([
      ["HUBTEST", schematic],
      [
        "NEXT",
        {
          ...schematic,
          stationId: "NEXT",
          nodes: schematic.nodes.map((n) =>
            n.type === "street" ? n : n.type === "platform" ? n : n,
          ),
        },
      ],
    ]),
  });

  it("records a victoria chain at the victoria tier", () => {
    expect(network.chains).toHaveLength(1);
    expect(network.chains[0]!.lineId).toBe("victoria");
    expect(network.chains[0]!.level).toBe(schematicLevelForLine("victoria"));
    expect(network.chains[0]!.stationIds).toEqual(["HUBTEST", "NEXT"]);
  });

  it("omits a zero offset when the platform sits on the street centroid", () => {
    expect(network.anchors.HUBTEST?.victoria).toBeUndefined();
  });

  it("stores a bearing at both stations", () => {
    expect(network.angles.HUBTEST?.victoria).toBeTypeOf("number");
    expect(network.angles.NEXT?.victoria).toBeTypeOf("number");
  });
});

describe("buildLineNetwork FOI bearing", () => {
  it("prefers FOI bearing over the geographic tangent (rotationY = -bearingDeg)", () => {
    const schematic = generateSchematic({
      ...sampleInput,
      platforms: [
        {
          id: "HUBTEST-Plat01::victoria::North",
          lineId: "victoria",
          direction: "North",
          label: "Platform 1 northbound",
        },
      ],
      placement: [
        {
          lineId: "victoria",
          platformNumbers: [1],
          eastM: 0,
          northM: 0,
          bearingDeg: 90,
        },
      ],
    });
    const network = buildLineNetwork({
      generatedAt: "test",
      stations: [
        { id: "HUBTEST", lat: 51.5, lon: -0.12 },
        { id: "NEXT", lat: 51.51, lon: -0.12 },
      ],
      edges: [{ from: "HUBTEST", to: "NEXT", lineId: "victoria" }],
      schematics: new Map([["HUBTEST", schematic]]),
    });
    // Neighbour is due north → geographic angle ≈ 0; FOI 90° east → −π/2.
    expect(network.angles.HUBTEST?.victoria).toBeCloseTo(-Math.PI / 2, 8);
  });
});

describe("buildLineNetwork from disk", () => {
  const raw = JSON.parse(
    readFileSync("data/network.json", "utf8"),
  ) as NetworkData;
  const schematics = new Map<string, SchematicStation>();
  schematics.set("HUBKGX", kgx);
  const network = buildLineNetwork({
    generatedAt: "test",
    stations: raw.stations,
    edges: raw.edges,
    schematics,
  });

  it("emits a chain for every edge endpoint that exists", () => {
    expect(network.chains.length).toBeGreaterThan(50);
    const covered = new Set<string>();
    for (const c of network.chains) {
      expect(c.level).toBe(schematicLevelForLine(c.lineId));
      for (let i = 0; i < c.stationIds.length - 1; i++) {
        const a = c.stationIds[i]!;
        const b = c.stationIds[i + 1]!;
        covered.add(`${c.lineId}:${a < b ? a : b}|${a < b ? b : a}`);
      }
      if (c.closed && c.stationIds.length > 1) {
        const a = c.stationIds[0]!;
        const b = c.stationIds[c.stationIds.length - 1]!;
        covered.add(`${c.lineId}:${a < b ? a : b}|${a < b ? b : a}`);
      }
    }
    const edgeKeys = new Set(
      raw.edges.map((e) => {
        const lineId =
          e.lineId === "elizabeth" ? "elizabeth-line" : e.lineId;
        const a = e.from < e.to ? e.from : e.to;
        const b = e.from < e.to ? e.to : e.from;
        return `${lineId}:${a}|${b}`;
      }),
    );
    expect(covered.size).toBe(edgeKeys.size);
    for (const k of edgeKeys) expect(covered.has(k)).toBe(true);
  });

  it("snaps HUBKGX Circle to its platform centroid in world space", () => {
    const offset = lineAnchor(network.anchors, "HUBKGX", "circle");
    const world = lineAnchorWorld(
      network.stations.HUBKGX!,
      offset,
      HUBKGX_ORIGIN,
    );
    const geom = buildSceneGeometry({
      nodes: kgx.nodes,
      edges: kgx.edges,
    });
    const placed = placeSchematicAt(
      geom,
      schematicWorldOffset("HUBKGX", kgx.entrance.lat, kgx.entrance.lon),
    );
    const plats = geom.volumes.filter((v) => v.lineId === "circle");
    let x = 0;
    let z = 0;
    for (const v of plats) {
      x += v.position[0] * placed.scale + placed.position[0];
      z += v.position[2] * placed.scale + placed.position[2];
    }
    x /= plats.length;
    z /= plats.length;
    expect(world.x).toBeCloseTo(x, 5);
    expect(world.z).toBeCloseTo(z, 5);
    const origin = latLonToWorld(
      HUBKGX_ORIGIN.lat,
      HUBKGX_ORIGIN.lon,
      HUBKGX_ORIGIN,
    );
    expect(Math.hypot(world.x - origin.x, world.z - origin.z)).toBeGreaterThan(
      10,
    );
  });
});

describe("placed HUBKGX platform Y", () => {
  it("follows FOI metres, not schematicLevelWorldY", () => {
    const geom = buildSceneGeometry(
      {
        nodes: kgx.nodes,
        edges: kgx.edges,
      },
      { stationId: "HUBKGX" },
    );
    const placed = placeSchematicAt(geom, { x: 0, z: 0 });
    const plat = geom.volumes.find((v) => v.type === "platform")!;
    const worldY = plat.position[1] * placed.scale + placed.position[1];
    expect(worldY).toBeCloseTo(platformWorldY("HUBKGX", plat.lineId!), 5);
    expect(schematicLevelWorldY(plat.level)).not.toBeCloseTo(worldY, 0);
    expect(placed.scale).toBe(SCHEMATIC_METRES_PER_UNIT);
  });
});
