import { describe, expect, it } from "vitest";
import type { OverpassResponse } from "./entrances";
import {
  isNationalRailPlatform,
  longAxisBearingDeg,
  matchOsmNationalRailPlacements,
  osmPlatformsQuery,
  parseOsmPlatforms,
  parsePlatformRef,
} from "./osm-platforms";

describe("isNationalRailPlatform", () => {
  it("keeps National Rail and Network Rail tags", () => {
    expect(
      isNationalRailPlatform({
        railway: "platform",
        network: "National Rail",
        ref: "1",
      }),
    ).toBe(true);
    expect(
      isNationalRailPlatform({
        railway: "platform",
        operator: "Network Rail",
      }),
    ).toBe(true);
    expect(
      isNationalRailPlatform({
        public_transport: "platform",
        train: "yes",
      }),
    ).toBe(true);
  });

  it("drops Underground, Overground, DLR, and Elizabeth", () => {
    expect(
      isNationalRailPlatform({
        railway: "platform",
        network: "London Underground",
        ref: "1",
      }),
    ).toBe(false);
    expect(
      isNationalRailPlatform({
        railway: "platform",
        subway: "yes",
        ref: "1",
      }),
    ).toBe(false);
    expect(
      isNationalRailPlatform({
        railway: "platform",
        network: "London Overground",
        train: "yes",
      }),
    ).toBe(false);
    expect(
      isNationalRailPlatform({
        railway: "platform",
        network: "DLR",
        ref: "1",
      }),
    ).toBe(false);
    expect(
      isNationalRailPlatform({
        railway: "platform",
        network: "Elizabeth line",
        train: "yes",
      }),
    ).toBe(false);
  });
});

describe("parsePlatformRef", () => {
  it("reads single, island, and Platform N refs", () => {
    expect(parsePlatformRef("1")).toEqual([1]);
    expect(parsePlatformRef("1;2")).toEqual([1, 2]);
    expect(parsePlatformRef("Platform 4")).toEqual([4]);
    expect(parsePlatformRef(undefined)).toEqual([]);
  });
});

describe("longAxisBearingDeg", () => {
  it("is ~0° for a north–south rectangle", () => {
    const ring: [number, number][] = [
      [-2, -40],
      [2, -40],
      [2, 40],
      [-2, 40],
      [-2, -40],
    ];
    expect(longAxisBearingDeg(ring)).toBeCloseTo(0, 5);
  });
});

describe("osmPlatformsQuery", () => {
  it("asks for railway=platform ways and relations", () => {
    const q = osmPlatformsQuery({
      south: 51.4,
      west: -0.2,
      north: 51.6,
      east: 0,
    });
    expect(q).toMatch(/railway"="platform/);
    expect(q).toMatch(/public_transport"="platform/);
    expect(q).toMatch(/rel\["railway"="platform"\]/);
    expect(q).toMatch(/out geom/);
  });
});

function nsPlatformWay(
  id: number,
  tags: Record<string, string>,
  lat = 51.5,
  lon = -0.12,
): NonNullable<OverpassResponse["elements"]>[number] {
  const dLat = 40 / 111_320;
  const dLon = 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: "way",
    id,
    tags,
    geometry: [
      { lat: lat - dLat, lon: lon - dLon },
      { lat: lat - dLat, lon: lon + dLon },
      { lat: lat + dLat, lon: lon + dLon },
      { lat: lat + dLat, lon: lon - dLon },
      { lat: lat - dLat, lon: lon - dLon },
    ],
  };
}

describe("parseOsmPlatforms + match", () => {
  const station = { id: "HUBTEST", lat: 51.5, lon: -0.12 };

  it("matches Plat01 to ref=1 and skips London Underground", () => {
    const osm: OverpassResponse = {
      elements: [
        nsPlatformWay(10, {
          railway: "platform",
          network: "National Rail",
          ref: "1",
        }),
        nsPlatformWay(11, {
          railway: "platform",
          network: "London Underground",
          ref: "1",
        }),
      ],
    };
    const features = parseOsmPlatforms(osm);
    expect(features).toHaveLength(1);
    expect(features[0]!.osmWayId).toBe(10);
    expect(features[0]!.bearingDeg).toBeCloseTo(0, 0);

    const placements = matchOsmNationalRailPlacements(
      features,
      station,
      [
        {
          id: "HUBTEST-Plat01-EB-national-rail::national-rail::East",
          lineId: "national-rail",
          label: "Platform 1",
        },
        {
          id: "HUBTEST-Plat01-NB-northern::northern::North",
          lineId: "northern",
          label: "Platform 1 northbound",
        },
      ],
      8,
    );
    expect(placements).toHaveLength(1);
    expect(placements[0]!.platformNumbers).toEqual([1]);
    expect(placements[0]!.source).toBe("osm");
    expect(placements[0]!.osmWayId).toBe(10);
    expect(placements[0]!.depthM).toBe(0);
    expect(placements[0]!.eastM).toBeCloseTo(0, 0);
    expect(placements[0]!.northM).toBeCloseTo(0, 0);
  });

  it("uses FOI/typical depth for underground OSM platforms", () => {
    const osm: OverpassResponse = {
      elements: [
        nsPlatformWay(20, {
          railway: "platform",
          network: "National Rail",
          ref: "2",
          location: "underground",
        }),
      ],
    };
    const placements = matchOsmNationalRailPlacements(
      parseOsmPlatforms(osm),
      station,
      [
        {
          id: "HUBTEST-Plat02-EB-national-rail",
          lineId: "national-rail",
          label: "Platform 2",
        },
      ],
      8.5,
    );
    expect(placements[0]!.depthM).toBe(8.5);
  });
});
