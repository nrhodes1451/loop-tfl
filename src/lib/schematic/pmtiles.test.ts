import { describe, expect, it } from "vitest";
import vtpbf from "vt-pbf";
import { HUBKGX_ORIGIN } from "./geo";
import { ringAabb } from "./osm";
import {
  fogRange,
  landZoomForDistance,
  latToTileY,
  lonLatToTile,
  lonToTileX,
  tileKey,
  tilePointToLonLat,
  tileToLat,
  tileToLon,
  ringForDistance,
  surfaceFromMvt,
  tilesAround,
  zoomForDistance,
} from "./pmtiles";

function polyRing() {
  return [
    [200, 200],
    [500, 200],
    [500, 500],
    [200, 500],
    [200, 200],
  ];
}

function linePath() {
  return [
    [100, 100],
    [800, 100],
  ];
}

describe("slippy tiles", () => {
  it("maps King’s Cross into the expected z15 tile", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    expect(tile.z).toBe(15);
    expect(tile.x).toBe(lonToTileX(HUBKGX_ORIGIN.lon, 15));
    expect(tile.y).toBe(latToTileY(HUBKGX_ORIGIN.lat, 15));
    expect(tile.x).toBeGreaterThan(16000);
    expect(tile.y).toBeGreaterThan(10000);
  });

  it("round-trips tile corners through lon/lat", () => {
    const z = 15;
    const x = 16384;
    const y = 10894;
    const west = tileToLon(x, z);
    const east = tileToLon(x + 1, z);
    const north = tileToLat(y, z);
    const south = tileToLat(y + 1, z);
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
    const nw = tilePointToLonLat({ z, x, y }, 0, 0, 4096);
    expect(nw.lon).toBeCloseTo(west, 8);
    expect(nw.lat).toBeCloseTo(north, 8);
  });

  it("returns a 3×3 neighbourhood, wrapping x", () => {
    const around = tilesAround(0, 0, 4, 1);
    expect(around).toHaveLength(9);
    expect(around.map(tileKey).filter((k, i, a) => a.indexOf(k) === i)).toHaveLength(
      9,
    );
  });
});

describe("zoomForDistance", () => {
  it("picks z15 close in, z14/z13 mid, and drops 3D when far", () => {
    expect(zoomForDistance(120)).toBe(15);
    expect(zoomForDistance(3_000)).toBe(14);
    expect(zoomForDistance(8_000)).toBe(13);
    expect(zoomForDistance(20_000)).toBeNull();
  });
});

describe("landZoomForDistance", () => {
  it("tracks building zoom then continues to z12/z11", () => {
    expect(landZoomForDistance(120)).toBe(15);
    expect(landZoomForDistance(3_000)).toBe(14);
    expect(landZoomForDistance(8_000)).toBe(13);
    expect(landZoomForDistance(20_000)).toBe(12);
    expect(landZoomForDistance(23_000)).toBe(11);
    expect(landZoomForDistance(25_000)).toBe(11);
  });
});

describe("ringForDistance", () => {
  it("grows the neighbourhood as the camera pulls back", () => {
    expect(ringForDistance(150, 15)).toBe(1);
    expect(ringForDistance(1_200, 15)).toBeGreaterThan(1);
    expect(ringForDistance(4_000, 14)).toBeGreaterThan(
      ringForDistance(400, 15),
    );
    expect(ringForDistance(10_000, 13)).toBeLessThanOrEqual(3);
  });
});

describe("fogRange", () => {
  it("keeps near past the schematic and far on the tile window", () => {
    const close = fogRange(150, 15);
    expect(close.near).toBeGreaterThanOrEqual(80);
    expect(close.far).toBeGreaterThan(close.near);
    const far = fogRange(4_000, 14);
    expect(far.near).toBeGreaterThan(close.near);
    expect(far.far).toBeGreaterThan(far.near);
    expect(far.far).toBeLessThanOrEqual((2 * ringForDistance(4_000, 14) + 1) * 2_000);
  });
});

describe("surfaceFromMvt", () => {
  it("decodes a building polygon in the KGX tile into an ENU ring", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    const buf = vtpbf.fromGeojsonVt({
      buildings: {
        features: [
          {
            id: 7,
            type: 3,
            geometry: [polyRing()],
            tags: { height: 22 },
          },
        ],
      },
    });
    const surface = surfaceFromMvt(new Uint8Array(buf), tile, HUBKGX_ORIGIN);
    expect(surface.buildings).toHaveLength(1);
    expect(surface.buildings[0]!.height).toBe(22);
    expect(surface.buildings[0]!.ring.length).toBeGreaterThanOrEqual(3);
    const aabb = ringAabb(surface.buildings[0]!.ring);
    expect(aabb.maxX).toBeGreaterThan(aabb.minX);
    expect(aabb.maxZ).toBeGreaterThan(aabb.minZ);
    expect(Math.abs(aabb.minX)).toBeLessThan(5_000);
    expect(Math.abs(aabb.minZ)).toBeLessThan(5_000);
  });

  it("keeps park landuse and drops residential", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    const buf = vtpbf.fromGeojsonVt({
      landuse: {
        features: [
          {
            id: 1,
            type: 3,
            geometry: [polyRing()],
            tags: { kind: "park" },
          },
          {
            id: 2,
            type: 3,
            geometry: [polyRing()],
            tags: { kind: "residential" },
          },
        ],
      },
    });
    const surface = surfaceFromMvt(new Uint8Array(buf), tile, HUBKGX_ORIGIN);
    expect(surface.land).toHaveLength(1);
    expect(surface.land[0]!.kind).toBe("park");
  });

  it("keeps water polygons and canal lines, skips streams", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    const buf = vtpbf.fromGeojsonVt({
      water: {
        features: [
          {
            id: 1,
            type: 3,
            geometry: [polyRing()],
            tags: { kind: "water" },
          },
          {
            id: 2,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "other", kind_detail: "canal" },
          },
          {
            id: 3,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "other", kind_detail: "stream" },
          },
        ],
      },
    });
    const surface = surfaceFromMvt(new Uint8Array(buf), tile, HUBKGX_ORIGIN);
    expect(surface.water).toHaveLength(1);
    expect(surface.waterways).toHaveLength(1);
    expect(surface.waterways[0]!.kind).toBe("canal");
    expect(surface.waterways[0]!.path.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps major roads and skips links, tunnels, and minor roads", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    const buf = vtpbf.fromGeojsonVt({
      roads: {
        features: [
          {
            id: 1,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "highway" },
          },
          {
            id: 2,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "highway", is_link: true },
          },
          {
            id: 3,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "major_road", is_tunnel: true },
          },
          {
            id: 4,
            type: 2,
            geometry: [linePath()],
            tags: { kind: "minor_road" },
          },
        ],
      },
    });
    const surface = surfaceFromMvt(new Uint8Array(buf), tile, HUBKGX_ORIGIN);
    expect(surface.roads).toHaveLength(1);
    expect(surface.roads[0]!.kind).toBe("highway");
  });

  it("omits buildings below z13", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 12);
    const buf = vtpbf.fromGeojsonVt({
      buildings: {
        features: [
          {
            id: 7,
            type: 3,
            geometry: [polyRing()],
            tags: { height: 22 },
          },
        ],
      },
    });
    const surface = surfaceFromMvt(new Uint8Array(buf), tile, HUBKGX_ORIGIN);
    expect(surface.buildings).toHaveLength(0);
  });
});
