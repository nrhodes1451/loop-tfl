import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NATIONAL_RAIL_RED } from "../tokens";
import { kgxStation } from "./kgx.fixture";
import { HUBKGX_ORIGIN } from "./geo";
import {
  STAIR_COLOR,
  STAIR_DROP_M,
  STAIR_RISERS,
  bakeEntrances,
  hallHeightM,
  hidesStreetCuboid,
  orientStairPath,
  overlayGeometries,
  overlayHallCentroid,
  overlayHallId,
  overlayHoverVolume,
  overlayStairId,
  overpassQuery,
  parseIncline,
  pickBuildingForEntrance,
  pickNearbyBuilding,
  ringAabbAreaM2,
  type EntranceBuilding,
  type OverpassResponse,
} from "./entrances";
import { stairsToLineSegments } from "./building-geom";
import { buildSceneGeometry } from "./scene";

/** ~20 m × 16 m hall around the KGX wheelchair entrance. */
const KGX_HALL: { lat: number; lon: number }[] = [
  { lat: 51.53035, lon: -0.12390 },
  { lat: 51.53035, lon: -0.12357 },
  { lat: 51.53050, lon: -0.12357 },
  { lat: 51.53050, lon: -0.12390 },
  { lat: 51.53035, lon: -0.12390 },
];

/** Roof canopy on the same doorway. */
const KGX_ROOF: { lat: number; lon: number }[] = [
  { lat: 51.53038, lon: -0.12385 },
  { lat: 51.53038, lon: -0.12362 },
  { lat: 51.53047, lon: -0.12362 },
  { lat: 51.53047, lon: -0.12385 },
  { lat: 51.53038, lon: -0.12385 },
];

/** ~120 m × 80 m concourse — large on purpose, still a valid hall. */
const HUGE_HALL: { lat: number; lon: number }[] = [
  { lat: 51.51500, lon: -0.1425 },
  { lat: 51.51500, lon: -0.1408 },
  { lat: 51.51572, lon: -0.1408 },
  { lat: 51.51572, lon: -0.1425 },
  { lat: 51.51500, lon: -0.1425 },
];

const OX_STEPS: { lat: number; lon: number }[] = [
  { lat: 51.51520, lon: -0.14190 },
  { lat: 51.51524, lon: -0.14190 },
  { lat: 51.51528, lon: -0.14186 },
];

const OX_ESCALATOR: { lat: number; lon: number }[] = [
  { lat: 51.51520, lon: -0.14190 },
  { lat: 51.51530, lon: -0.14180 },
];

const FIXTURE: OverpassResponse = {
  elements: [
    {
      type: "node",
      id: 911189370,
      lat: 51.5304091,
      lon: -0.1237367,
      tags: { railway: "subway_entrance", wheelchair: "yes" },
    },
    {
      type: "node",
      id: 1001,
      lat: 51.51520,
      lon: -0.14190,
      tags: {
        railway: "subway_entrance",
        name: "Exit 4, Oxford Street - West / Regent Street - North",
      },
    },
    {
      type: "node",
      id: 1002,
      lat: 51.51525,
      lon: -0.14170,
      tags: { railway: "subway_entrance", name: "Exit 5" },
    },
    {
      type: "way",
      id: 303377742,
      nodes: [1, 2, 911189370, 3],
      geometry: KGX_HALL,
      tags: {
        building: "train_station",
        name: "King's Cross St. Pancras Underground Station",
        height: "8",
      },
    },
    {
      type: "way",
      id: 971709482,
      nodes: [911189370, 10, 11],
      geometry: KGX_ROOF,
      tags: { building: "roof" },
    },
    {
      type: "way",
      id: 555,
      nodes: [1002, 20, 21],
      geometry: HUGE_HALL,
      tags: { building: "train_station", name: "Waterloo Underground concourse" },
    },
    {
      type: "way",
      id: 2001,
      nodes: [1001, 30, 31],
      geometry: OX_STEPS,
      tags: { highway: "steps", handrail: "yes" },
    },
    {
      type: "way",
      id: 2003,
      nodes: [1001, 40],
      geometry: OX_ESCALATOR,
      tags: { highway: "steps", conveying: "yes" },
    },
  ],
};

const HUBKGX = { id: "HUBKGX", lat: 51.530663, lon: -0.123194 };
const OXC = { id: "940GZZLUOXC", lat: 51.5152, lon: -0.1419 };
const FAR = { id: "940GZZLUOAK", lat: 51.64773, lon: -0.13218 };

function hallAsBuilding(): EntranceBuilding {
  return {
    osmWayId: 303377742,
    name: "King's Cross St. Pancras Underground Station",
    height: 8,
    ring: KGX_HALL.slice(0, -1).map((p) => [p.lat, p.lon]),
  };
}

describe("ringAabbAreaM2", () => {
  it("measures the KGX pavilion as a small hall", () => {
    const area = ringAabbAreaM2(hallAsBuilding().ring);
    expect(area).toBeGreaterThan(50);
    expect(area).toBeLessThan(500);
  });

  it("picks the smallest hall centroid", () => {
    const hit = overlayHallCentroid({
      buildings: [hallAsBuilding()],
      stairs: [],
    });
    expect(hit).not.toBeNull();
    expect(hit!.lat).toBeCloseTo(51.530425, 4);
    expect(hit!.lon).toBeCloseTo(-0.123735, 4);
  });

  it("measures a Waterloo-scale concourse as many thousands of m²", () => {
    const ring = HUGE_HALL.slice(0, -1).map(
      (p) => [p.lat, p.lon] as [number, number],
    );
    expect(ringAabbAreaM2(ring)).toBeGreaterThan(2500);
  });
});

describe("pickBuildingForEntrance", () => {
  it("picks the smallest hall when several share the doorway", () => {
    const larger: EntranceBuilding = {
      osmWayId: 99,
      name: "bigger kiosk",
      ring: [
        [51.53030, -0.12400],
        [51.53030, -0.12340],
        [51.53055, -0.12340],
        [51.53055, -0.12400],
      ],
    };
    const byNode = new Map<number, EntranceBuilding[]>([
      [911189370, [larger, hallAsBuilding()]],
    ]);
    const picked = pickBuildingForEntrance(911189370, byNode);
    expect(picked?.osmWayId).toBe(303377742);
    expect(picked?.name).toMatch(/King's Cross/);
  });

  it("keeps a vast concourse when it is the only building on the node", () => {
    const byNode = new Map<number, EntranceBuilding[]>([
      [
        1002,
        [
          {
            osmWayId: 555,
            name: "Waterloo Underground concourse",
            ring: HUGE_HALL.slice(0, -1).map((p) => [p.lat, p.lon]),
          },
        ],
      ],
    ]);
    const picked = pickBuildingForEntrance(1002, byNode);
    expect(picked?.osmWayId).toBe(555);
    expect(picked?.name).toMatch(/Waterloo/);
  });
});

describe("bakeEntrances", () => {
  const file = bakeEntrances(FIXTURE, [HUBKGX, OXC, FAR], "2026-01-01T00:00:00.000Z");

  it("joins the KGX wheelchair entrance to the pavilion, not the roof", () => {
    const row = file.stations.HUBKGX;
    expect(row).toBeTruthy();
    expect(row!.buildings).toHaveLength(1);
    expect(row!.buildings[0]!.osmWayId).toBe(303377742);
    expect(row!.buildings[0]!.height).toBe(8);
    expect(row!.buildings[0]!.ring.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps Oxford Circus stairs, skips the escalator, and keeps a large hall", () => {
    const row = file.stations["940GZZLUOXC"];
    expect(row).toBeTruthy();
    expect(row!.buildings.map((b) => b.osmWayId)).toEqual([555]);
    expect(row!.stairs.map((s) => s.osmWayId)).toEqual([2001]);
    expect(row!.stairs[0]!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("does not attach geometry to a station more than 200 m away", () => {
    expect(file.stations["940GZZLUOAK"]).toBeUndefined();
  });

  it("attaches a hall near an entrance that does not share a vertex", () => {
    const entrance = {
      type: "node" as const,
      id: 555001,
      lat: 51.53222,
      lon: -0.1058,
      tags: { railway: "subway_entrance" },
    };
    const ring = [
      { lat: 51.53202, lon: -0.10588 },
      { lat: 51.53202, lon: -0.10572 },
      { lat: 51.53212, lon: -0.10572 },
      { lat: 51.53212, lon: -0.10588 },
      { lat: 51.53202, lon: -0.10588 },
    ];
    const osm: OverpassResponse = {
      elements: [
        entrance,
        {
          type: "way",
          id: 777001,
          nodes: [555010, 555011, 555012, 555013],
          geometry: ring,
          tags: { building: "yes", name: "Angel ticket hall" },
        },
      ],
    };
    const angel = {
      id: "940GZZLUAGL",
      lat: 51.531788,
      lon: -0.105919,
    };
    const baked = bakeEntrances(osm, [angel], "2026-01-01T00:00:00.000Z");
    const row = baked.stations["940GZZLUAGL"];
    expect(row).toBeTruthy();
    expect(row!.buildings).toHaveLength(1);
    expect(row!.buildings[0]!.osmWayId).toBe(777001);
    expect(pickNearbyBuilding(entrance, row!.buildings)?.osmWayId).toBe(777001);
  });

  it("hides the cuboid when a hall or stairs exist", () => {
    expect(hidesStreetCuboid(file.stations.HUBKGX)).toBe(true);
    expect(hidesStreetCuboid(file.stations["940GZZLUOXC"])).toBe(true);
    expect(hidesStreetCuboid(undefined)).toBe(false);
    expect(hidesStreetCuboid({ buildings: [], stairs: [] })).toBe(false);
  });

  it("builds a ticket-hall-style hover payload for OSM halls and stairs", () => {
    expect(
      overlayHoverVolume(file, "HUBKGX", overlayHallId(303377742)),
    ).toEqual({
      id: overlayHallId(303377742),
      label: "King's Cross St. Pancras Underground Station",
      type: "street",
      level: 0,
    });
    expect(
      overlayHoverVolume(file, "940GZZLUOXC", overlayStairId(2001)),
    ).toEqual({
      id: overlayStairId(2001),
      label: "Stairs",
      type: "stairs",
      level: 0,
    });
    expect(overlayHoverVolume(file, "HUBKGX", "street")).toBeNull();
  });

  it("converts rings into the ENU frame used by buildingGeometry", () => {
    const geoms = overlayGeometries(file, HUBKGX_ORIGIN, ["HUBKGX", "940GZZLUOXC"]);
    expect(geoms.halls).toHaveLength(2);
    const kgxHall = geoms.halls.find((h) => h.stationId === "HUBKGX");
    expect(kgxHall?.id).toBe(overlayHallId(303377742));
    expect(kgxHall?.label).toMatch(/King's Cross/);
    expect(kgxHall?.height).toBe(8);
    expect(kgxHall?.ring.length).toBeGreaterThanOrEqual(3);
    expect(geoms.halls.some((h) => h.stationId === "940GZZLUOXC")).toBe(true);
    expect(geoms.stairs).toHaveLength(1);
    expect(geoms.stairs[0]!.id).toBe(overlayStairId(2001));
    expect(geoms.stairs[0]!.label).toBe("Stairs");
    expect(geoms.stairs[0]!.widthM).toBe(2.5);
    expect(geoms.stairs[0]!.path.length).toBeGreaterThanOrEqual(2);
    const segs = stairsToLineSegments(geoms.stairs, STAIR_RISERS, STAIR_DROP_M);
    expect(segs.length).toBeGreaterThanOrEqual(4);
    expect(segs.length % 2).toBe(0);
  });
});

describe("scene geometry vs overlay", () => {
  it("keeps street boxes in schematic topology when overlay is present", () => {
    const station = kgxStation;
    const geom = buildSceneGeometry(
      { nodes: station.nodes, edges: station.edges },
      { stationId: station.stationId },
    );
    expect(geom.volumes.some((v) => v.type === "street")).toBe(true);
  });
});

describe("overpass query", () => {
  it("pulls entrance nodes and attached building/highway ways", () => {
    const q = overpassQuery({
      south: 51.4,
      west: -0.3,
      north: 51.6,
      east: 0.1,
    });
    expect(q).toMatch(/railway"="subway_entrance/);
    expect(q).toMatch(/railway"="train_station_entrance/);
    expect(q).toMatch(/way\(bn\.ent\)\["building"\]/);
    expect(q).toMatch(/way\(bn\.ent\)\["highway"\]/);
    expect(q).toMatch(/way\(around\.ent:40\)\["building"\]/);
    expect(q).toMatch(/way\(around\.ent:40\)\["highway"="steps"\]/);
  });
});

describe("stair orientation", () => {
  const a: [number, number] = [51.5152, -0.1419];
  const b: [number, number] = [51.5151, -0.1418];

  it("parses OSM incline relative to way direction", () => {
    expect(parseIncline("up")).toBe("up");
    expect(parseIncline("15%")).toBe("up");
    expect(parseIncline("down")).toBe("down");
    expect(parseIncline("-8%")).toBe("down");
    expect(parseIncline(undefined)).toBeNull();
    expect(parseIncline("0%")).toBeNull();
  });

  it("reverses when incline is up (first node is bottom)", () => {
    expect(orientStairPath([a, b], { incline: "up" })).toEqual([b, a]);
  });

  it("keeps order when incline is down (first node is top)", () => {
    expect(orientStairPath([a, b], { incline: "down" })).toEqual([a, b]);
  });

  it("reverses when the entrance is the last node and incline is absent", () => {
    expect(
      orientStairPath([a, b], {
        nodeIds: [10, 20],
        entranceNodeId: 20,
      }),
    ).toEqual([b, a]);
  });

  it("keeps order when the entrance is the first node and incline is absent", () => {
    expect(
      orientStairPath([a, b], {
        nodeIds: [10, 20],
        entranceNodeId: 10,
      }),
    ).toEqual([a, b]);
  });

  it("bakes incline=up so path[0] is the downhill end of the OSM way", () => {
    const osm: OverpassResponse = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 51.5,
          lon: -0.1,
          tags: { railway: "subway_entrance" },
        },
        {
          type: "way",
          id: 9,
          nodes: [1, 2],
          geometry: [
            { lat: 51.5, lon: -0.1 },
            { lat: 51.5001, lon: -0.1 },
          ],
          tags: { highway: "steps", incline: "up" },
        },
      ],
    };
    const file = bakeEntrances(osm, [{ id: "S", lat: 51.5, lon: -0.1 }]);
    const path = file.stations.S!.stairs[0]!.path;
    expect(path[0]![0]).toBeCloseTo(51.5001, 5);
    expect(file.stations.S!.stairs[0]!.incline).toBe("up");
  });
});

describe("overlay tokens", () => {
  it("uses National Rail red for stairs", () => {
    expect(STAIR_COLOR).toBe(NATIONAL_RAIL_RED);
    expect(STAIR_COLOR.toUpperCase()).toBe("#FF4200");
  });

  it("draws stairs as a dollhouse-style wireframe cage", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/schematic/EntranceOverlay.tsx"),
      "utf8",
    );
    expect(src).toContain("stairsToLineSegments");
    expect(src).toContain("hallPrismEdges");
    expect(src).toContain("onPointerOver");
    expect(src).toContain("VOLUME_BOTTOM_OPACITY");
    expect(src).toContain('schematicEdgeColor("street")');
    expect(src).toContain("depthWrite={false}");
    expect(src).toContain("const VOLUME_ORDER = 1");
    expect(src).toContain("const LINE_ORDER = 2");
    expect(src).not.toContain("SURFACE_ORDER");
    expect(src).not.toContain("STAIR_Y_M");
    expect(src).not.toContain("polygonOffset");
    expect(src).not.toContain("buildingGeometry");
    expect(src).not.toContain("wrapLambert");
  });

  it("clamps hall height to a short pavilion", () => {
    expect(hallHeightM(undefined)).toBe(7);
    expect(hallHeightM(8)).toBe(8);
    expect(hallHeightM(40)).toBe(16);
  });

  it("puts Stairs and Escalators swatches in the schematic depth key", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/schematic/SchematicPage.tsx"),
      "utf8",
    );
    expect(src).toMatch(/label:\s*"Stairs"/);
    expect(src).toContain("NATIONAL_RAIL_RED");
    expect(src).toMatch(/label:\s*"Escalators"/);
    expect(src).toContain("ESCALATOR_COLOR");
    expect(src).toContain('e.mode === "escalator"');
  });

  it("picks OSM cages through the same hover ids as ticket halls", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/schematic/StationScene3D.tsx"),
      "utf8",
    );
    expect(src).toContain("overlayHoverVolume");
    expect(src).toContain("polylineTouchesVolumeIds");
    expect(src).toContain("streetVolumeIds");
  });
});
