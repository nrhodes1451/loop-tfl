import { describe, expect, it } from "vitest";
import {
  typicalDepthM,
  tubeRadiusM,
} from "./lu-scale";

describe("tubeRadiusM", () => {
  it("uses 1.85 m for deep-level Northern and 3.75 m for Circle", () => {
    expect(tubeRadiusM("northern")).toBeCloseTo(1.85);
    expect(tubeRadiusM("circle")).toBeCloseTo(3.75);
  });
});

describe("typicalDepthM", () => {
  it("falls back to 8 / 20 / 25 m by family", () => {
    expect(typicalDepthM("circle")).toBe(8);
    expect(typicalDepthM("victoria")).toBe(20);
    expect(typicalDepthM("northern")).toBe(25);
  });
});
