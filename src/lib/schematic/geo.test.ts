import { describe, expect, it } from "vitest";
import kgxJson from "../../../data/schematic/HUBKGX.json";
import {
  HUBKGX_ORIGIN,
  SCHEMATIC_METRES_PER_UNIT,
  applyPlacement,
  enuToLatLon,
  latLonToEnu,
  placeSchematic,
} from "./geo";
import { buildSceneGeometry } from "./scene";
import type { SchematicStation } from "./types";

const station = kgxJson as SchematicStation;

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
