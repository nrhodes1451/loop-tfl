import { describe, expect, it } from "vitest";
import {
  generateSchematic,
  physicalPlatformId,
  platformNodeId,
  type GenerateStationInput,
} from "./generate";

const sample: GenerateStationInput = {
  id: "HUBTEST",
  name: "Test Station",
  lat: 51.5,
  lon: -0.12,
  platforms: [
    {
      id: "HUBTEST-Plat01-NB-victoria::victoria::North",
      lineId: "victoria",
      direction: "North",
      label: "Platform 1 northbound",
    },
    {
      id: "HUBTEST-Plat02-SB-victoria::victoria::South",
      lineId: "victoria",
      direction: "South",
      label: "Platform 2 southbound",
    },
    {
      id: "HUBTEST-Plat03-WB-circle::circle::West",
      lineId: "circle",
      direction: "West",
      label: "Platform 3 westbound",
    },
    {
      id: "HUBTEST-Plat03-WB-circle::hammersmith-city::West",
      lineId: "hammersmith-city",
      direction: "West",
      label: "Platform 3 westbound",
    },
  ],
  lifts: [
    {
      id: "HUBTEST-Lift-1",
      name: "Lift 1",
      platformIds: [
        "HUBTEST-Plat01-NB-victoria::victoria::North",
        "HUBTEST-Plat02-SB-victoria::victoria::South",
      ],
    },
  ],
  platformLiftChains: [
    {
      platformId: "HUBTEST-Plat01-NB-victoria::victoria::North",
      liftIds: ["HUBTEST-Lift-1"],
      access: "lifts",
    },
    {
      platformId: "HUBTEST-Plat02-SB-victoria::victoria::South",
      liftIds: ["HUBTEST-Lift-1"],
      access: "lifts",
    },
    {
      platformId: "HUBTEST-Plat03-WB-circle::circle::West",
      liftIds: [],
      access: "level",
    },
  ],
  interchangeChains: [
    {
      fromPlatformId: "HUBTEST-Plat01-NB-victoria::victoria::North",
      toPlatformId: "HUBTEST-Plat03-WB-circle::circle::West",
      liftIds: [],
      access: "level",
    },
  ],
};

describe("physicalPlatformId", () => {
  it("strips the service suffix", () => {
    expect(
      physicalPlatformId("HUBTEST-Plat01-NB-victoria::victoria::North"),
    ).toBe("HUBTEST-Plat01-NB-victoria");
    expect(physicalPlatformId("HUBTEST-Plat01")).toBe("HUBTEST-Plat01");
  });
});

describe("generateSchematic", () => {
  const station = generateSchematic(sample);

  it("emits unique node ids and valid edge endpoints", () => {
    const ids = station.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const idSet = new Set(ids);
    for (const edge of station.edges) {
      expect(idSet.has(edge.from)).toBe(true);
      expect(idSet.has(edge.to)).toBe(true);
    }
  });

  it("merges multi-line physical platforms into one node", () => {
    const plats = station.nodes.filter((n) => n.type === "platform");
    expect(plats).toHaveLength(3);
    const merged = plats.find(
      (n) => n.id === platformNodeId("HUBTEST-Plat03-WB-circle"),
    );
    expect(merged?.lineId).toBe("circle");
  });

  it("places same-line platforms in parallel (shared Y, Δx = 2)", () => {
    const a = station.nodes.find(
      (n) => n.id === platformNodeId("HUBTEST-Plat01-NB-victoria"),
    )!;
    const b = station.nodes.find(
      (n) => n.id === platformNodeId("HUBTEST-Plat02-SB-victoria"),
    )!;
    expect(a.y).toBe(b.y);
    expect(Math.abs(a.x - b.x)).toBe(2);
  });

  it("offsets lifts away from platform centres", () => {
    const lift = station.nodes.find((n) => n.liftId === "HUBTEST-Lift-1")!;
    const plats = station.nodes.filter((n) => n.type === "platform");
    for (const p of plats) {
      expect(Math.hypot(lift.x - p.x, lift.y - p.y)).toBeGreaterThan(0.5);
    }
  });

  it("is bit-identical across runs", () => {
    expect(generateSchematic(sample)).toEqual(station);
    expect(JSON.stringify(generateSchematic(sample))).toBe(
      JSON.stringify(station),
    );
  });

  it("keeps an invented entrance without a fake OSM node id", () => {
    expect(station.entrance.source).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
    expect(station.entrance.source).not.toMatch(/\/node\/\d+/);
    expect(station.entrance.lat).toBe(51.5);
    expect(station.disclaimer.toLowerCase()).toMatch(/schematic/);
  });

  it("connects street to concourse and stitches lift chains", () => {
    expect(
      station.edges.some(
        (e) =>
          e.mode === "level" &&
          ((e.from === "street" && e.to === "concourse") ||
            (e.from === "concourse" && e.to === "street")),
      ),
    ).toBe(true);
    expect(station.edges.some((e) => e.liftId === "HUBTEST-Lift-1")).toBe(true);
  });
});
