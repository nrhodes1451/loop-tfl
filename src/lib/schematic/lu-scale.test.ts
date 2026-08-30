import { describe, expect, it } from "vitest";
import {
  DEEP_TUBE_RADIUS_M,
  PLATFORM_TUBE_OFFSET_M,
  PLATFORM_WIDTH_M,
  typicalDepthM,
  tubeRadiusM,
} from "./lu-scale";

describe("tubeRadiusM", () => {
  it("uses 1.85 m for deep-level Northern and 3.75 m for Circle", () => {
    expect(tubeRadiusM("northern")).toBeCloseTo(1.85);
    expect(tubeRadiusM("circle")).toBeCloseTo(3.75);
  });
});

describe("PLATFORM_TUBE_OFFSET_M", () => {
  it("is half the platform plus a deep-level radius", () => {
    expect(PLATFORM_TUBE_OFFSET_M).toBeCloseTo(
      PLATFORM_WIDTH_M / 2 + DEEP_TUBE_RADIUS_M,
    );
  });
});

describe("typicalDepthM", () => {
  it("falls back to 8 / 20 / 25 m by family", () => {
    expect(typicalDepthM("circle")).toBe(8);
    expect(typicalDepthM("victoria")).toBe(20);
    expect(typicalDepthM("northern")).toBe(25);
  });
});
