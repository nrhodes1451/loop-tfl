import { describe, expect, it } from "vitest";
import { HUBKGX_ORIGIN, SURFACE_SIZE_M, aabbIntersects } from "./geo";
import {
  DEFAULT_BUILDING_HEIGHT_M,
  buildingsFromOverpass,
  clipRingToBox,
  parseBuildingHeight,
  ringAabb,
  type OverpassElement,
} from "./osm";

describe("parseBuildingHeight", () => {
  it("reads height, then levels, then the 10 m default", () => {
    expect(parseBuildingHeight({ height: "18.5" })).toBe(18.5);
    expect(parseBuildingHeight({ "building:levels": "4" })).toBe(12);
    expect(parseBuildingHeight({ building: "yes" })).toBe(
      DEFAULT_BUILDING_HEIGHT_M,
    );
    expect(parseBuildingHeight(undefined)).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });
});

describe("clipRingToBox", () => {
  it("keeps a ring entirely inside the box", () => {
    const ring: [number, number][] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const clipped = clipRingToBox(ring, 200);
    expect(clipped.length).toBe(4);
  });

  it("drops a ring entirely outside the box", () => {
    const ring: [number, number][] = [
      [300, 300],
      [310, 300],
      [310, 310],
      [300, 310],
    ];
    expect(clipRingToBox(ring, 200)).toEqual([]);
  });

  it("clips a ring that straddles the box edge", () => {
    const ring: [number, number][] = [
      [150, -10],
      [250, -10],
      [250, 10],
      [150, 10],
    ];
    const clipped = clipRingToBox(ring, 200);
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    const aabb = ringAabb(clipped);
    expect(aabb.maxX).toBeCloseTo(200, 6);
    expect(aabb.minX).toBeGreaterThanOrEqual(150 - 1e-6);
  });
});

describe("buildingsFromOverpass", () => {
  const elements: OverpassElement[] = [
    {
      type: "way",
      id: 1,
      tags: { building: "yes", height: "22" },
      geometry: [
        { lat: HUBKGX_ORIGIN.lat, lon: HUBKGX_ORIGIN.lon },
        { lat: HUBKGX_ORIGIN.lat + 0.00005, lon: HUBKGX_ORIGIN.lon },
        { lat: HUBKGX_ORIGIN.lat + 0.00005, lon: HUBKGX_ORIGIN.lon + 0.00008 },
        { lat: HUBKGX_ORIGIN.lat, lon: HUBKGX_ORIGIN.lon + 0.00008 },
        { lat: HUBKGX_ORIGIN.lat, lon: HUBKGX_ORIGIN.lon },
      ],
    },
    {
      type: "way",
      id: 2,
      tags: { building: "yes" },
      geometry: [
        { lat: 51.54, lon: -0.1 },
        { lat: 51.5401, lon: -0.1 },
        { lat: 51.5401, lon: -0.0999 },
        { lat: 51.54, lon: -0.0999 },
      ],
    },
    {
      type: "way",
      id: 3,
      tags: { highway: "service" },
      geometry: [
        { lat: HUBKGX_ORIGIN.lat, lon: HUBKGX_ORIGIN.lon },
        { lat: HUBKGX_ORIGIN.lat + 0.00002, lon: HUBKGX_ORIGIN.lon },
        { lat: HUBKGX_ORIGIN.lat + 0.00002, lon: HUBKGX_ORIGIN.lon + 0.00002 },
      ],
    },
  ];

  it("keeps in-box buildings, drops far ones, and skips non-buildings", () => {
    const buildings = buildingsFromOverpass(
      elements,
      HUBKGX_ORIGIN,
      SURFACE_SIZE_M,
    );
    expect(buildings.map((b) => b.id)).toEqual(["way/1"]);
    expect(buildings[0]!.height).toBe(22);
    expect(buildings[0]!.ring.length).toBeGreaterThanOrEqual(3);
    const aabb = ringAabb(buildings[0]!.ring);
    expect(aabbIntersects(aabb, { minX: -5, maxX: 20, minZ: -5, maxZ: 20 })).toBe(
      true,
    );
  });
});
