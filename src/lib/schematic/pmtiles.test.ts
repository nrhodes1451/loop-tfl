import { afterEach, describe, expect, it, vi } from "vitest";
import vtpbf from "vt-pbf";
import { CITY_MAX_DISTANCE_M, HUBKGX_ORIGIN } from "./geo";
import { ringAabb } from "./osm";
import {
  PMTILES_TILE_BUFFER_UNITS,
  fogRange,
  landZoomForDistance,
  latToTileY,
  lonLatToTile,
  lonToTileX,
  nextCoarserLandZoom,
  tileEnuRect,
  tileKey,
  tilePointToLonLat,
  tileToLat,
  tileToLon,
  tileWidthM,
  ringForDistance,
  surfaceFromMvt,
  tilesAround,
  tileUrl,
  fetchTileSurface,
  zoomForDistance,
  type TileCoord,
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

const EXTENT = 4096;
const BUF = PMTILES_TILE_BUFFER_UNITS;
const WIDTH_M = tileWidthM(15, HUBKGX_ORIGIN.lat);

/** Ring wound clockwise in tile space, which MVT expects for outer rings. */
function box(x0: number, y0: number, x1: number, y1: number) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

/** The same tile-space coordinates as the eastern neighbour sees them. */
function fromEast(coords: number[][]) {
  return coords.map(([x, y]) => [x! - EXTENT, y!]);
}

type MvtLayers = Parameters<typeof vtpbf.fromGeojsonVt>[0];

function mvtBytes(layers: MvtLayers) {
  return new Uint8Array(vtpbf.fromGeojsonVt(layers));
}

function decodeTile(tile: TileCoord, layers: MvtLayers) {
  return surfaceFromMvt(mvtBytes(layers), tile, HUBKGX_ORIGIN);
}

/** A z15 tile and its eastern neighbour, sharing one vertical edge. */
function adjacentTiles(): { west: TileCoord; east: TileCoord } {
  const west = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
  return { west, east: { z: west.z, x: west.x + 1, y: west.y } };
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

describe("nextCoarserLandZoom", () => {
  it("steps down the z15–z11 ladder and stops at z11", () => {
    expect(nextCoarserLandZoom(120)).toBe(14);
    expect(nextCoarserLandZoom(3_000)).toBe(13);
    expect(nextCoarserLandZoom(8_000)).toBe(12);
    expect(nextCoarserLandZoom(20_000)).toBe(11);
    expect(nextCoarserLandZoom(23_000)).toBeNull();
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

  it("uses a 7×7 window at the far-orbit z14 preload distance", () => {
    expect(ringForDistance(CITY_MAX_DISTANCE_M, 14)).toBe(3);
  });
});

describe("fogRange", () => {
  it("tracks camera distance and caps far at the tile window", () => {
    const close = fogRange(150, 15);
    expect(close.near).toBe(150 * 0.9);
    expect(close.far).toBe(150 * 2.2);
    expect(fogRange(201, 15).far).toBeGreaterThan(close.far);
    expect(fogRange(500, 15).near).toBe(500 * 0.9);

    const city = fogRange(4_000, 14);
    const windowM =
      (2 * ringForDistance(4_000, 14) + 1) * tileWidthM(14, 51.53);
    expect(city.near).toBeGreaterThan(close.near);
    expect(city.far).toBeLessThanOrEqual(windowM);
    expect(city.far).toBeGreaterThan(city.near);
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

  it("keeps a footprint that never touches an edge intact", () => {
    const tile = lonLatToTile(HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN.lat, 15);
    const surface = decodeTile(tile, {
      buildings: {
        features: [
          { id: 7, type: 3, geometry: [box(1000, 1000, 1100, 1100)], tags: {} },
        ],
      },
    });
    expect(surface.buildings).toHaveLength(1);
    const aabb = ringAabb(surface.buildings[0]!.ring);
    const rect = tileEnuRect(tile, HUBKGX_ORIGIN);
    expect(aabb.minX).toBeGreaterThan(rect.minX);
    expect(aabb.maxX).toBeLessThan(rect.maxX);
    expect(aabb.maxX - aabb.minX).toBeCloseTo((100 / 4096) * WIDTH_M, 3);
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

/**
 * Every layer overspills its tile by PMTILES_TILE_BUFFER_UNITS, so neighbours
 * hold overlapping copies. Drawing both compounds the translucent surface alpha
 * into a grid, so each tile must emit its share exactly once.
 */
describe("surfaceFromMvt tile seams", () => {
  it("puts the shared edge at the same ENU x for both tiles", () => {
    const { west, east } = adjacentTiles();
    expect(tileEnuRect(west, HUBKGX_ORIGIN).maxX).toBe(
      tileEnuRect(east, HUBKGX_ORIGIN).minX,
    );
  });

  it("hands a road crossing the edge to both tiles, abutting not overlapping", () => {
    const { west, east } = adjacentTiles();
    const line = [
      [3900, 2000],
      [EXTENT + BUF, 2000],
    ];
    const layer = (geometry: number[][]) => ({
      roads: {
        features: [{ id: 1, type: 2, geometry: [geometry], tags: { kind: "highway" } }],
      },
    });
    const a = decodeTile(west, layer(line));
    const b = decodeTile(east, layer(fromEast([[EXTENT - BUF, 2000], [4300, 2000]])));

    expect(a.roads).toHaveLength(1);
    expect(b.roads).toHaveLength(1);
    const seam = tileEnuRect(west, HUBKGX_ORIGIN).maxX;
    expect(ringAabb(a.roads[0]!.path).maxX).toBeCloseTo(seam, 6);
    expect(ringAabb(b.roads[0]!.path).minX).toBeCloseTo(seam, 6);
  });

  it("gives a park in the buffer band to the only tile that contains it", () => {
    const { west, east } = adjacentTiles();
    const park = box(EXTENT - 96, 2000, EXTENT - 16, 2080);
    const layer = (geometry: number[][]) => ({
      landuse: {
        features: [{ id: 1, type: 3, geometry: [geometry], tags: { kind: "park" } }],
      },
    });
    expect(decodeTile(west, layer(park)).land).toHaveLength(1);
    expect(decodeTile(east, layer(fromEast(park))).land).toHaveLength(0);
  });

  it("clips a water polygon spanning the edge into complementary halves", () => {
    const { west, east } = adjacentTiles();
    const lake = box(3800, 2000, EXTENT + 400, 2400);
    const layer = (geometry: number[][]) => ({
      water: {
        features: [{ id: 1, type: 3, geometry: [geometry], tags: { kind: "water" } }],
      },
    });
    const a = decodeTile(west, layer(lake));
    const b = decodeTile(east, layer(fromEast(lake)));
    const seam = tileEnuRect(west, HUBKGX_ORIGIN).maxX;
    expect(ringAabb(a.water[0]!.ring).maxX).toBe(seam);
    expect(ringAabb(b.water[0]!.ring).minX).toBe(seam);
  });

  it("gives a whole footprint straddling the edge to one tile only", () => {
    const layer = (geometry: number[][]) => ({
      buildings: {
        features: [{ id: 7, type: 3, geometry: [geometry], tags: { height: 20 } }],
      },
    });
    const count = (footprint: number[][]) => {
      const { west, east } = adjacentTiles();
      return (
        decodeTile(west, layer(footprint)).buildings.length +
        decodeTile(east, layer(fromEast(footprint))).buildings.length
      );
    };
    // Centred just west of the edge, then just east of it.
    expect(count(box(EXTENT - 36, 2000, EXTENT + 34, 2070))).toBe(1);
    expect(count(box(EXTENT - 26, 2000, EXTENT + 44, 2070))).toBe(1);
  });

  it("keeps the whole footprint, not a clipped half, for the owning tile", () => {
    const { west } = adjacentTiles();
    const surface = decodeTile(west, {
      buildings: {
        features: [
          {
            id: 7,
            type: 3,
            geometry: [box(EXTENT - 36, 2000, EXTENT + 34, 2070)],
            tags: { height: 20 },
          },
        ],
      },
    });
    expect(surface.buildings).toHaveLength(1);
    const aabb = ringAabb(surface.buildings[0]!.ring);
    expect(aabb.maxX).toBeGreaterThan(tileEnuRect(west, HUBKGX_ORIGIN).maxX);
    expect(aabb.maxX - aabb.minX).toBeCloseTo((70 / EXTENT) * WIDTH_M, 3);
  });

  it("clips a footprint truncated at the buffer bound instead of owning it", () => {
    const { west, east } = adjacentTiles();
    const layer = (geometry: number[][]) => ({
      buildings: {
        features: [{ id: 7, type: 3, geometry: [geometry], tags: { height: 20 } }],
      },
    });
    const a = decodeTile(west, layer(box(4000, 2000, EXTENT + BUF, 2400)));
    const b = decodeTile(east, layer(fromEast(box(EXTENT - BUF, 2000, 4500, 2400))));
    expect(a.buildings).toHaveLength(1);
    expect(b.buildings).toHaveLength(1);
    const seam = tileEnuRect(west, HUBKGX_ORIGIN).maxX;
    expect(ringAabb(a.buildings[0]!.ring).maxX).toBe(seam);
    expect(ringAabb(b.buildings[0]!.ring).minX).toBe(seam);
  });
});

describe("tileUrl", () => {
  it("puts the archive version ahead of z/x/y", () => {
    expect(tileUrl({ z: 15, x: 16368, y: 10891 }, "a1b2c3")).toBe(
      "/api/osm/tiles/a1b2c3/15/16368/10891",
    );
  });

  it("escapes a version that would otherwise change the path", () => {
    expect(tileUrl({ z: 1, x: 0, y: 0 }, "a/b")).toBe("/api/osm/tiles/a%2Fb/1/0/0");
  });
});

describe("fetchTileSurface", () => {
  const tile: TileCoord = { z: 15, x: 16368, y: 10891 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(res: Response) {
    const fetchMock = vi.fn(async () => res);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("requests the versioned tile URL", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await fetchTileSurface(tile, HUBKGX_ORIGIN, "v9");
    expect(fetchMock).toHaveBeenCalledWith(tileUrl(tile, "v9"));
  });

  it("treats 204 as nothing to draw", async () => {
    stubFetch(new Response(null, { status: 204 }));
    const surface = await fetchTileSurface(tile, HUBKGX_ORIGIN, "v9");
    expect(Object.values(surface).every((layer) => layer.length === 0)).toBe(true);
  });

  it("treats a missing archive as nothing to draw", async () => {
    stubFetch(new Response("Not found", { status: 404 }));
    const surface = await fetchTileSurface(tile, HUBKGX_ORIGIN, "v9");
    expect(Object.values(surface).every((layer) => layer.length === 0)).toBe(true);
  });

  it("throws on a server error so the tile can be retried", async () => {
    stubFetch(new Response("Boom", { status: 500 }));
    await expect(fetchTileSurface(tile, HUBKGX_ORIGIN, "v9")).rejects.toThrow(
      /15\/16368\/10891/,
    );
  });

  it("decodes MVT bytes from a 200", async () => {
    const bytes = mvtBytes({
      roads: {
        features: [
          { id: 1, type: 2, geometry: [linePath()], tags: { kind: "highway" } },
        ],
      },
    });
    stubFetch(new Response(bytes, { status: 200 }));
    const surface = await fetchTileSurface(tile, HUBKGX_ORIGIN, "v9");
    expect(surface.roads).toHaveLength(1);
  });
});
