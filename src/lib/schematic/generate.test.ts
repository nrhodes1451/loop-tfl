import { describe, expect, it } from "vitest";
import {
  generateSchematic,
  physicalPlatformId,
  platformNodeId,
  type GenerateStationInput,
} from "./generate";
import { platformPlanSize } from "./scene";

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

  it("gives every line the same plan Y so 115 m boxes share one long axis", () => {
    const plats = station.nodes.filter((n) => n.type === "platform");
    expect(new Set(plats.map((p) => p.y)).size).toBe(1);
  });

  it("keeps generated two-line platform AABBs from overlapping in plan", () => {
    const plats = station.nodes.filter((n) => n.type === "platform");
    const boxes = plats.map((p) => {
      const { wx, wy } = platformPlanSize(p, station.nodes);
      return {
        minX: p.x - wx / 2,
        maxX: p.x + wx / 2,
        minY: p.y - wy / 2,
        maxY: p.y + wy / 2,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.minX < b.maxX &&
          a.maxX > b.minX &&
          a.minY < b.maxY &&
          a.maxY > b.minY;
        expect(overlap, `${plats[i]!.id} vs ${plats[j]!.id}`).toBe(false);
      }
    }
  });
});

describe("generateSchematic FOI placement", () => {
  const placed = generateSchematic({
    id: "HUBKGX",
    name: "King's Cross",
    lat: 51.53,
    lon: -0.123,
    platforms: [
      {
        id: "HUBKGX-Plat07-NB-northern::northern::North",
        lineId: "northern",
        direction: "North",
        label: "Platform 7 northbound",
      },
      {
        id: "HUBKGX-Plat08-SB-northern::northern::South",
        lineId: "northern",
        direction: "South",
        label: "Platform 8 southbound",
      },
      {
        id: "HUBKGX-Plat01-WB-circle::circle::West",
        lineId: "circle",
        direction: "West",
        label: "Platform 1 westbound",
      },
    ],
    lifts: [],
    platformLiftChains: [],
    interchangeChains: [],
    placement: [
      {
        lineId: "northern",
        platformNumbers: [7, 8],
        eastM: 0,
        northM: 40,
        bearingDeg: 0,
        confidence: "high",
        caption: "NORTHERN LINE PLATFORMS 7 & 8",
        a: [0.4, 0.2],
        b: [0.4, 0.55],
        grid: "G4",
        flags: ["placement-residual"],
      },
      {
        lineId: "circle",
        platformNumbers: [1],
        eastM: -30,
        northM: 0,
        bearingDeg: 90,
      },
    ],
    foiMarks: [
      {
        file: "3d northern line stations Redacted.pdf",
        page: 1,
        caption: "NORTHERN LINE PLATFORMS 7 & 8",
        lineId: "northern",
        platformNumbers: [7, 8],
        end: "north",
        bearingDeg: 0,
        a: [0.4, 0.2],
        b: [0.4, 0.55],
        grid: "G4",
        confidence: "high",
        eastM: 0,
        northM: 40,
        residual: 0,
        placed: true,
      },
      {
        file: "3d bakerloo stations Redacted.pdf",
        page: 12,
        caption: "BAKERLOO LINE PLATFORMS",
        lineId: "bakerloo",
        platformNumbers: [],
        end: null,
        bearingDeg: 57,
        a: [0.35, 0.635],
        b: [0.409, 0.725],
        grid: "G7",
        confidence: "low",
        eastM: 10,
        northM: 12,
        residual: 0.4,
        placed: false,
      },
    ],
  });

  it("puts FOI platforms at west/north schematic coords and stores bearing", () => {
    const n7 = placed.nodes.find((n) => n.id.includes("Plat07"))!;
    const n8 = placed.nodes.find((n) => n.id.includes("Plat08"))!;
    const circle = placed.nodes.find((n) => n.lineId === "circle")!;
    expect(n7.y).toBeCloseTo(10);
    expect(n8.y).toBeCloseTo(10);
    expect(n7.bearingDeg).toBe(0);
    expect(n7.foi?.confidence).toBe("high");
    expect(n7.foi?.eastM).toBeDefined();
    expect(n7.foi?.caption).toBe("NORTHERN LINE PLATFORMS 7 & 8");
    expect(n7.foi?.a).toEqual([0.4, 0.2]);
    expect(n7.foi?.flags).toEqual(["placement-residual"]);
    expect(placed.foiMarks).toHaveLength(2);
    expect(placed.foiMarks?.some((m) => m.confidence === "low" && !m.placed)).toBe(
      true,
    );
    expect(circle.x).toBeCloseTo(7.5);
    expect(circle.y).toBeCloseTo(0);
    expect(circle.bearingDeg).toBe(90);
  });

  it("without placement stays byte-identical to the band layout", () => {
    const a = generateSchematic(sample);
    const b = generateSchematic({ ...sample, placement: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
