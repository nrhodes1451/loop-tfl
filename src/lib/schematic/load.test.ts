import { describe, expect, it } from "vitest";
import {
  clearSchematicCache,
  listSchematicStations,
  loadOsmSurface,
  loadSchematic,
  loadSchematicsNear,
  SchematicNotFoundError,
} from "./load";
import { HUBKGX_ORIGIN } from "./geo";

describe("loadSchematic", () => {
  it("prefers the hand-authored HUBKGX override", async () => {
    clearSchematicCache();
    const station = await loadSchematic("HUBKGX");
    expect(station.stationId).toBe("HUBKGX");
    expect(station.nodes.some((n) => n.id === "street-wth")).toBe(true);
    expect(station.entrance.source).toMatch(/\/node\/\d+/);
  });

  it("lists generated stations including the HUBKGX override", async () => {
    clearSchematicCache();
    const stations = await listSchematicStations();
    expect(stations.some((s) => s.id === "HUBKGX")).toBe(true);
    expect(stations.length).toBeGreaterThan(1);
    const generated = stations.find((s) => s.id !== "HUBKGX");
    expect(generated).toBeTruthy();
    expect(typeof generated!.lat).toBe("number");
    expect(typeof generated!.lon).toBe("number");
    const kgx = stations.find((s) => s.id === "HUBKGX");
    expect(kgx!.lat).toBeCloseTo(HUBKGX_ORIGIN.lat, 4);
    expect(kgx!.lon).toBeCloseTo(HUBKGX_ORIGIN.lon, 4);
    const station = await loadSchematic(generated!.id);
    expect(station.stationId).toBe(generated!.id);
    expect(station.nodes.some((n) => n.id === "street")).toBe(true);
  });

  it("loads schematics within a radius of the origin", async () => {
    clearSchematicCache();
    const near = await loadSchematicsNear(HUBKGX_ORIGIN, 2_000);
    expect(near.some((s) => s.stationId === "HUBKGX")).toBe(true);
    expect(near.length).toBeGreaterThan(1);
    const tight = await loadSchematicsNear(HUBKGX_ORIGIN, 80);
    expect(tight.some((s) => s.stationId === "HUBKGX")).toBe(true);
    expect(tight.length).toBeLessThan(near.length);
  });

  it("rejects unsafe ids", async () => {
    await expect(loadSchematic("../network")).rejects.toBeInstanceOf(
      SchematicNotFoundError,
    );
  });
});

describe("loadOsmSurface", () => {
  it("loads the baked King’s Cross building block", async () => {
    const surface = await loadOsmSurface("HUBKGX");
    expect(surface).not.toBeNull();
    expect(surface!.stationId).toBe("HUBKGX");
    expect(surface!.sizeM).toBe(400);
    expect(surface!.origin.source).toBe("tfl-stoppoint");
    expect(surface!.origin.lat).toBeCloseTo(51.530663, 5);
    expect(surface!.origin.lon).toBeCloseTo(-0.123194, 5);
    expect(surface!.buildings.length).toBeGreaterThan(50);
    expect(surface!.buildings[0]!.ring.length).toBeGreaterThanOrEqual(3);
  });

  it("returns null when no bake exists", async () => {
    expect(await loadOsmSurface("NOPE")).toBeNull();
  });
});
