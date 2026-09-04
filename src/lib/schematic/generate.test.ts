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
        depthM: 29.8,
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
    expect(n7.depthM).toBe(29.8);
    expect(n8.depthM).toBe(29.8);
    expect(placed.foiMarks).toHaveLength(2);
    expect(placed.foiMarks?.some((m) => m.confidence === "low" && !m.placed)).toBe(
      true,
    );
    expect(circle.x).toBeCloseTo(7.5);
    expect(circle.y).toBeCloseTo(0);
    expect(circle.bearingDeg).toBe(90);
    expect(n7.direction).toBe("North");
    expect(n8.direction).toBe("South");
  });

  it("fans northbound to the west under left-hand running (bearing 0)", () => {
    const out = generateSchematic({
      id: "HUBTEST",
      name: "Test",
      lat: 51.5,
      lon: -0.12,
      platforms: [
        {
          id: "HUBTEST-Plat01::victoria::South",
          lineId: "victoria",
          direction: "South",
          label: "Platform 1 southbound",
        },
        {
          id: "HUBTEST-Plat02::victoria::North",
          lineId: "victoria",
          direction: "North",
          label: "Platform 2 northbound",
        },
      ],
      lifts: [],
      platformLiftChains: [],
      interchangeChains: [],
      placement: [
        {
          lineId: "victoria",
          platformNumbers: [1, 2],
          eastM: 0,
          northM: 0,
          bearingDeg: 0,
        },
      ],
    });
    const south = out.nodes.find((n) => n.direction === "South")!;
    const north = out.nodes.find((n) => n.direction === "North")!;
    // schematic x = −east, so west is the larger x.
    expect(north.x).toBeGreaterThan(south.x);
  });

  it("without placement stays byte-identical to the band layout", () => {
    const a = generateSchematic(sample);
    const b = generateSchematic({ ...sample, placement: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("generateSchematic OSM National Rail placement", () => {
  const placed = generateSchematic({
    id: "HUBTEST",
    name: "Test",
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
        id: "HUBTEST-Plat04-EB-national-rail::national-rail::East",
        lineId: "national-rail",
        direction: "East",
        label: "Platform 4",
      },
    ],
    lifts: [],
    platformLiftChains: [],
    interchangeChains: [],
    placement: [
      {
        lineId: "victoria",
        platformNumbers: [1],
        eastM: 0,
        northM: 0,
        bearingDeg: 90,
      },
      {
        lineId: "national-rail",
        platformNumbers: [4],
        eastM: 40,
        northM: 20,
        bearingDeg: 0,
        source: "osm",
        osmWayId: 99,
        osmRef: "4",
        depthM: 0,
      },
    ],
  });

  it("places OSM NR at the geographic offset after hall compensation", () => {
    const victoria = placed.nodes.find((n) => n.lineId === "victoria")!;
    const nr = placed.nodes.find((n) => n.lineId === "national-rail")!;
    expect(victoria.x).toBeCloseTo(0);
    expect(victoria.y).toBeCloseTo(0);
    expect(nr.x).toBeCloseTo(-10);
    expect(nr.y).toBeCloseTo(5);
    expect(nr.bearingDeg).toBe(0);
    expect(nr.depthM).toBe(0);
    expect(nr.osm).toEqual({
      wayId: 99,
      eastM: 40,
      northM: 20,
      ref: "4",
    });
    expect(nr.foi).toBeUndefined();
  });

  it("does not let OSM NR pull the street centroid", () => {
    const street = placed.nodes.find((n) => n.id === "street")!;
    expect(street.x).toBeCloseTo(0);
    expect(street.y).toBeCloseTo(0);
  });

  it("leaves unmatched NR on an invented line band", () => {
    const out = generateSchematic({
      id: "HUBTEST",
      name: "Test",
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
          id: "HUBTEST-Plat09-EB-national-rail::national-rail::East",
          lineId: "national-rail",
          direction: "East",
          label: "Platform 9",
        },
      ],
      lifts: [],
      platformLiftChains: [],
      interchangeChains: [],
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
    const nr = out.nodes.find((n) => n.lineId === "national-rail")!;
    expect(nr.osm).toBeUndefined();
    expect(nr.bearingDeg).toBeUndefined();
    expect(nr.x).toBeGreaterThan(0);
    expect(nr.y).toBe(0);
  });

  it("does not stitch concourse walks to National Rail platforms", () => {
    const out = generateSchematic({
      id: "HUBTEST",
      name: "Test",
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
          id: "HUBTEST-Plat04-EB-national-rail::national-rail::East",
          lineId: "national-rail",
          direction: "East",
          label: "Platform 4",
        },
      ],
      lifts: [],
      platformLiftChains: [
        {
          platformId: "HUBTEST-Plat01-NB-victoria::victoria::North",
          liftIds: [],
          access: "level",
        },
        {
          platformId: "HUBTEST-Plat04-EB-national-rail::national-rail::East",
          liftIds: [],
          access: "level",
        },
      ],
      interchangeChains: [],
    });
    const nr = out.nodes.find((n) => n.lineId === "national-rail")!;
    const victoria = out.nodes.find((n) => n.lineId === "victoria")!;
    expect(
      out.edges.some((e) => e.from === nr.id || e.to === nr.id),
    ).toBe(false);
    expect(
      out.edges.some(
        (e) =>
          (e.from === "concourse" && e.to === victoria.id) ||
          (e.from === victoria.id && e.to === "concourse"),
      ),
    ).toBe(true);
  });

  it("emits an escalator edge on the FOI a/b span, not the platform centroid", () => {
    const out = generateSchematic({
      ...sample,
      placement: [
        {
          lineId: "victoria",
          platformNumbers: [1, 2],
          eastM: 0,
          northM: 0,
          bearingDeg: 90,
        },
      ],
      escalators: [
        {
          id: "HUBTEST-Esc-1",
          caption: "hall to Victoria",
          from: "ticket hall",
          to: "Victoria Line",
          eastTopM: 12,
          northTopM: 40,
          eastBotM: 24,
          northBotM: 8,
          topDepthM: 0,
          botDepthM: 16,
          placed: true,
        },
      ],
    });
    const edge = out.edges.find((e) => e.mode === "escalator");
    expect(edge).toEqual({
      from: "HUBTEST-Esc-1-top",
      to: "HUBTEST-Esc-1-bot",
      mode: "escalator",
    });
    const top = out.nodes.find((n) => n.id === "HUBTEST-Esc-1-top")!;
    const bot = out.nodes.find((n) => n.id === "HUBTEST-Esc-1-bot")!;
    expect(top.x).toBeCloseTo(-12 / 4);
    expect(top.y).toBeCloseTo(40 / 4);
    expect(bot.x).toBeCloseTo(-24 / 4);
    expect(bot.y).toBeCloseTo(8 / 4);
    const plat = out.nodes.find((n) => n.type === "platform")!;
    expect(top.x).not.toBeCloseTo(plat.x);
    expect(top.y).not.toBeCloseTo(plat.y);
  });
});

describe("generateSchematic Angel graph", () => {
  const angelInput: GenerateStationInput = {
    id: "940GZZLUAGL",
    name: "Angel",
    lat: 51.531788,
    lon: -0.105919,
    platforms: [
      {
        id: "940GZZLUAGL-Plat01-SB-northern::northern::South",
        lineId: "northern",
        direction: "South",
        label: "Platform 1 southbound",
      },
      {
        id: "940GZZLUAGL-Plat02-NB-northern::northern::North",
        lineId: "northern",
        direction: "North",
        label: "Platform 2 northbound",
      },
    ],
    lifts: [],
    platformLiftChains: [],
    interchangeChains: [],
    placement: [
      {
        lineId: "northern",
        platformNumbers: [1],
        eastM: 152.797,
        northM: -185.822,
        bearingDeg: 100,
        depthM: 27.4,
      },
      {
        lineId: "northern",
        platformNumbers: [2],
        eastM: 149.67,
        northM: -223.978,
        bearingDeg: 100,
        depthM: 27.4,
      },
    ],
    escalators: [
      {
        id: "940GZZLUAGL-Esc-4",
        caption: "surface ticket hall to link passage",
        from: "Surface ticket hall",
        to: "Link passage",
        eastTopM: 5.838,
        northTopM: -5.838,
        eastBotM: 7.134,
        northBotM: -97.955,
        topDepthM: 0,
        botDepthM: 27.39,
        riseM: 27.39,
        angleDeg: 30,
        placed: true,
      },
      {
        id: "940GZZLUAGL-Esc-1",
        caption: "link passage to Northern",
        from: "Link passage",
        to: "Northern Line",
        eastTopM: 54.548,
        northTopM: -120.6,
        eastBotM: 77.193,
        northBotM: -168.014,
        topDepthM: 19.4,
        botDepthM: 27.4,
        riseM: 8,
        angleDeg: 30,
        placed: true,
      },
    ],
  };
  const angel = generateSchematic(angelInput);

  it("keeps the ticket hall at the FOI origin, not the platform centroid", () => {
    const hall = angel.nodes.find((n) => n.id === "concourse")!;
    expect(hall.x).toBeCloseTo(0);
    expect(hall.y).toBeCloseTo(0);
    const plats = angel.nodes.filter((n) => n.type === "platform");
    const cx = plats.reduce((s, n) => s + n.x, 0) / plats.length;
    expect(hall.x).not.toBeCloseTo(cx);
  });

  it("plants entrance on the OSM hall without shifting schematic XY", () => {
    const hallLatLon = { lat: 51.532911, lon: -0.106401 };
    const planted = generateSchematic({ ...angelInput, hallLatLon });
    expect(planted.entrance.lat).toBe(hallLatLon.lat);
    expect(planted.entrance.lon).toBe(hallLatLon.lon);
    expect(planted.entrance.label).toMatch(/OSM ticket hall/);
    const hall = planted.nodes.find((n) => n.id === "concourse")!;
    expect(hall.x).toBeCloseTo(0);
    expect(hall.y).toBeCloseTo(0);
    const street = planted.nodes.find((n) => n.id === "street")!;
    expect(street.x).toBeCloseTo(0);
    expect(street.y).toBeCloseTo(0);
  });

  it("emits CULG-length cages, a 90° link corridor, and a walk", () => {
    const esc = angel.edges.filter((e) => e.mode === "escalator");
    expect(esc).toHaveLength(2);
    const e4Bot = angel.nodes.find((n) => n.id.endsWith("-Esc-4-bot"))!;
    const e1Top = angel.nodes.find((n) => n.id.endsWith("-Esc-1-top"))!;
    const northern = angel.nodes.find((n) => n.id.includes("northern-line"))!;
    const link = angel.nodes.find((n) => n.id.includes("link-corridor"))!;
    const hall = angel.nodes.find((n) => n.id === "concourse")!;
    expect(e4Bot.x).not.toBeCloseTo(e1Top.x);
    expect(e4Bot.y).not.toBeCloseTo(e1Top.y);
    expect(e4Bot.depthM).toBeCloseTo(27.39);
    expect(e1Top.depthM).toBeCloseTo(27.39);
    expect(northern.depthM).toBeCloseTo(35.39);
    expect(hall.planWx).toBe(1);
    expect(hall.planWy).toBeGreaterThan(1);
    expect(link.planWx).toBe(1);
    expect(link.planWy).toBeGreaterThan(1);
    expect(northern.planWx).toBe(1);
    expect(
      angel.edges.some(
        (e) =>
          e.mode === "level" &&
          ((e.from === e4Bot.id && e.to === e1Top.id) ||
            (e.from === e1Top.id && e.to === e4Bot.id)),
      ),
    ).toBe(true);
    expect(
      angel.edges.some(
        (e) =>
          e.mode === "level" &&
          (e.from === northern.id || e.to === northern.id) &&
          angel.nodes.some(
            (n) =>
              n.type === "platform" && (n.id === e.from || n.id === e.to),
          ),
      ),
    ).toBe(true);
    expect(angel.notes).toContain("depth-culg-over-foi");
  });

  it("sets Northern platform depthM to the CULG stack", () => {
    for (const n of angel.nodes.filter((p) => p.type === "platform")) {
      expect(n.depthM).toBeCloseTo(35.39);
    }
  });
});
