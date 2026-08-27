import { describe, expect, it } from "vitest";
import {
  clearSchematicCache,
  listSchematicStations,
  loadEntranceOverlay,
  loadLineNetwork,
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
    const near = await loadSchematicsNear(HUBKGX_ORIGIN, 800);
    expect(near.some((s) => s.stationId === "HUBKGX")).toBe(true);
    expect(near.length).toBeGreaterThan(0);
    const wide = await loadSchematicsNear(HUBKGX_ORIGIN, 2_000);
    expect(wide.some((s) => s.stationId === "HUBKGX")).toBe(true);
    expect(wide.length).toBeGreaterThanOrEqual(near.length);
  });

  it("loads the inter-station line network", async () => {
    clearSchematicCache();
    const network = await loadLineNetwork();
    expect(network.chains.length).toBeGreaterThan(50);
    expect(network.stations.HUBKGX).toBeTruthy();
    expect(network.angles.HUBKGX?.circle).toBeTypeOf("number");
  });

  it("rejects unsafe ids", async () => {
    await expect(loadSchematic("../network")).rejects.toBeInstanceOf(
      SchematicNotFoundError,
    );
  });

  it("returns null when the entrance overlay bake is missing", async () => {
    clearSchematicCache();
    const overlay = await loadEntranceOverlay();
    if (overlay == null) {
      expect(overlay).toBeNull();
      return;
    }
    expect(overlay.stations).toBeTypeOf("object");
    expect(overlay.generatedAt).toBeTypeOf("string");
  });
});
