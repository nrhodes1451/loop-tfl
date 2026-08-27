import { describe, expect, it } from "vitest";
import { kgxStation } from "./kgx.fixture";
import {
  HUBKGX_ORIGIN,
  LONDON_BBOX,
  MAP_PAN_INSET_M,
  NEIGHBOR_LOAD_RADIUS_M,
  SCHEMATIC_METRES_PER_UNIT,
  applyPlacement,
  clampToAabb2,
  enuToLatLon,
  insetAabb,
  latLonToEnu,
  latLonToWorld,
  londonWorldAabb,
  mapPanBounds,
  placeSchematic,
  placeSchematicAt,
  schematicWorldOffset,
  stationsShownAtDistance,
  worldToLatLon,
} from "./geo";
import { buildSceneGeometry } from "./scene";

const station = kgxStation;

describe("latLonToEnu", () => {
  it("maps the origin to (0, 0)", () => {
    const p = latLonToEnu(HUBKGX_ORIGIN.lat, HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it("round-trips through enuToLatLon", () => {
    const orig = { lat: 51.531, lon: -0.122 };
    const enu = latLonToEnu(orig.lat, orig.lon, HUBKGX_ORIGIN);
    const back = enuToLatLon(enu.x, enu.z, HUBKGX_ORIGIN);
    expect(back.lat).toBeCloseTo(orig.lat, 8);
    expect(back.lon).toBeCloseTo(orig.lon, 8);
  });

  it("puts 200 m east on +X and 200 m north on +Z", () => {
    const mLat = 111_320;
    const mLon = 111_320 * Math.cos((HUBKGX_ORIGIN.lat * Math.PI) / 180);
    const east = latLonToEnu(
      HUBKGX_ORIGIN.lat,
      HUBKGX_ORIGIN.lon + 200 / mLon,
      HUBKGX_ORIGIN,
    );
    expect(east.x).toBeCloseTo(200, 6);
    expect(east.z).toBeCloseTo(0, 6);
    const north = latLonToEnu(
      HUBKGX_ORIGIN.lat + 200 / mLat,
      HUBKGX_ORIGIN.lon,
      HUBKGX_ORIGIN,
    );
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.z).toBeCloseTo(200, 6);
  });
});

describe("placeSchematic", () => {
  const geom = buildSceneGeometry(
    { nodes: station.nodes, edges: station.edges },
    { quality: "high" },
  );
  const placed = placeSchematic(geom);

  it("uses 4 metres per schematic unit", () => {
    expect(placed.scale).toBe(SCHEMATIC_METRES_PER_UNIT);
    expect(placed.scale).toBe(4);
  });

  it("puts the street-node centroid on the origin in XZ", () => {
    const streets = geom.volumes.filter((v) => v.type === "street");
    expect(streets.length).toBeGreaterThan(0);
    let x = 0;
    let z = 0;
    for (const vol of streets) {
      const w = applyPlacement(vol.position, placed.scale, placed.position);
      x += w[0];
      z += w[2];
    }
    x /= streets.length;
    z /= streets.length;
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("puts street volume tops on Y = 0", () => {
    const streets = geom.volumes.filter((v) => v.type === "street");
    for (const vol of streets) {
      const topLocal: [number, number, number] = [
        vol.position[0],
        vol.position[1] + vol.size[1] / 2,
        vol.position[2],
      ];
      const top = applyPlacement(topLocal, placed.scale, placed.position);
      expect(top[1]).toBeCloseTo(0, 6);
    }
  });
});

describe("latLonToWorld", () => {
  it("maps the origin to (0, 0)", () => {
    const p = latLonToWorld(HUBKGX_ORIGIN.lat, HUBKGX_ORIGIN.lon, HUBKGX_ORIGIN);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it("puts 200 m east on −X (west is +X) and 200 m north on +Z", () => {
    const mLat = 111_320;
    const mLon = 111_320 * Math.cos((HUBKGX_ORIGIN.lat * Math.PI) / 180);
    const east = latLonToWorld(
      HUBKGX_ORIGIN.lat,
      HUBKGX_ORIGIN.lon + 200 / mLon,
      HUBKGX_ORIGIN,
    );
    expect(east.x).toBeCloseTo(-200, 6);
    expect(east.z).toBeCloseTo(0, 6);
    const north = latLonToWorld(
      HUBKGX_ORIGIN.lat + 200 / mLat,
      HUBKGX_ORIGIN.lon,
      HUBKGX_ORIGIN,
    );
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.z).toBeCloseTo(200, 6);
  });

  it("round-trips through worldToLatLon", () => {
    const orig = { lat: 51.528, lon: -0.133 };
    const world = latLonToWorld(orig.lat, orig.lon, HUBKGX_ORIGIN);
    const back = worldToLatLon(world.x, world.z, HUBKGX_ORIGIN);
    expect(back.lat).toBeCloseTo(orig.lat, 8);
    expect(back.lon).toBeCloseTo(orig.lon, 8);
  });
});

describe("mapPanBounds", () => {
  it("keeps King’s Cross inside the inset extract", () => {
    const bounds = mapPanBounds(HUBKGX_ORIGIN);
    const origin = latLonToWorld(
      HUBKGX_ORIGIN.lat,
      HUBKGX_ORIGIN.lon,
      HUBKGX_ORIGIN,
    );
    expect(origin.x).toBeGreaterThan(bounds.minX);
    expect(origin.x).toBeLessThan(bounds.maxX);
    expect(origin.z).toBeGreaterThan(bounds.minZ);
    expect(origin.z).toBeLessThan(bounds.maxZ);
  });

  it("insets each side by MAP_PAN_INSET_M from the extract AABB", () => {
    const map = londonWorldAabb(HUBKGX_ORIGIN);
    const pan = mapPanBounds(HUBKGX_ORIGIN);
    expect(pan.minX).toBeCloseTo(map.minX + MAP_PAN_INSET_M);
    expect(pan.maxX).toBeCloseTo(map.maxX - MAP_PAN_INSET_M);
    expect(pan.minZ).toBeCloseTo(map.minZ + MAP_PAN_INSET_M);
    expect(pan.maxZ).toBeCloseTo(map.maxZ - MAP_PAN_INSET_M);
  });

  it("clamps a point east of the extract back to map − R", () => {
    const pan = mapPanBounds(HUBKGX_ORIGIN);
    const east = latLonToWorld(
      HUBKGX_ORIGIN.lat,
      LONDON_BBOX.east + 0.2,
      HUBKGX_ORIGIN,
    );
    const clamped = clampToAabb2(east.x, east.z, pan);
    expect(clamped.x).toBe(pan.minX);
    expect(clamped.z).toBeGreaterThanOrEqual(pan.minZ);
    expect(clamped.z).toBeLessThanOrEqual(pan.maxZ);
  });

  it("collapses a too-large inset to the AABB centre", () => {
    const box = { minX: -10, maxX: 10, minZ: -4, maxZ: 4 };
    const collapsed = insetAabb(box, 100);
    expect(collapsed.minX).toBe(0);
    expect(collapsed.maxX).toBe(0);
    expect(collapsed.minZ).toBe(0);
    expect(collapsed.maxZ).toBe(0);
  });
});

describe("placeSchematicAt", () => {
  const geom = buildSceneGeometry(
    { nodes: station.nodes, edges: station.edges },
    { quality: "high" },
  );

  it("matches placeSchematic when the world offset is the origin", () => {
    const local = placeSchematic(geom);
    const atOrigin = placeSchematicAt(geom, { x: 0, z: 0 });
    expect(atOrigin.position).toEqual(local.position);
    expect(atOrigin.bounds.center).toEqual(local.bounds.center);
  });

  it("puts the street-node centroid on the world offset", () => {
    const world = latLonToWorld(51.528, -0.1334, HUBKGX_ORIGIN);
    const placed = placeSchematicAt(geom, world);
    const streets = geom.volumes.filter((v) => v.type === "street");
    expect(streets.length).toBeGreaterThan(0);
    let x = 0;
    let z = 0;
    for (const vol of streets) {
      const w = applyPlacement(vol.position, placed.scale, placed.position);
      x += w[0];
      z += w[2];
    }
    x /= streets.length;
    z /= streets.length;
    expect(x).toBeCloseTo(world.x, 6);
    expect(z).toBeCloseTo(world.z, 6);
  });

  it("plants HUBKGX at latLonToWorld of its coordinates (the scene origin)", () => {
    const offset = schematicWorldOffset(
      "HUBKGX",
      HUBKGX_ORIGIN.lat,
      HUBKGX_ORIGIN.lon,
    );
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.z).toBeCloseTo(0, 9);
  });

  it("plants other stations at latLonToWorld of their coordinates", () => {
    const lat = 51.528;
    const lon = -0.1334;
    const offset = schematicWorldOffset("940GZZLUEUS", lat, lon, HUBKGX_ORIGIN);
    const world = latLonToWorld(lat, lon, HUBKGX_ORIGIN);
    expect(offset.x).toBeCloseTo(world.x, 9);
    expect(offset.z).toBeCloseTo(world.z, 9);
    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThan(100);
  });
});

describe("stationsShownAtDistance", () => {
  it("shows dollhouses when close, even if they were hidden", () => {
    expect(stationsShownAtDistance(150, false)).toBe(true);
  });

  it("hides dollhouses when far, even if they were shown", () => {
    expect(stationsShownAtDistance(3_000, true)).toBe(false);
  });

  it("uses hysteresis between show and hide distances", () => {
    expect(stationsShownAtDistance(1_700, true)).toBe(true);
    expect(stationsShownAtDistance(1_700, false)).toBe(false);
  });

  it("loads neighbors in an 800 m window", () => {
    expect(NEIGHBOR_LOAD_RADIUS_M).toBe(800);
  });
});
