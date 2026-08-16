import { describe, expect, it } from "vitest";
import {
  clearSchematicCache,
  listSchematicStations,
  loadSchematic,
  SchematicNotFoundError,
} from "./load";

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
    const station = await loadSchematic(generated!.id);
    expect(station.stationId).toBe(generated!.id);
    expect(station.nodes.some((n) => n.id === "street")).toBe(true);
  });

  it("rejects unsafe ids", async () => {
    await expect(loadSchematic("../network")).rejects.toBeInstanceOf(
      SchematicNotFoundError,
    );
  });
});
