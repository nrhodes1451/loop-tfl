import { describe, expect, it } from "vitest";
import { escalatorPlanRunM } from "./escalators";
import {
  ANGEL_STATION_ID,
  DEPTH_CULG_OVER_FOI,
  solveStationGraph,
} from "./station-graph";

const angelBanks = [
  {
    id: `${ANGEL_STATION_ID}-Esc-4`,
    from: "Surface ticket hall",
    to: "Link passage",
    riseM: 27.39,
    angleDeg: 30,
    eastTopM: 5.838,
    northTopM: -5.838,
    eastBotM: 7.134,
    northBotM: -97.955,
  },
  {
    id: `${ANGEL_STATION_ID}-Esc-1`,
    from: "Link passage",
    to: "Northern Line",
    riseM: 8,
    angleDeg: 30,
    eastTopM: 54.548,
    northTopM: -120.6,
    eastBotM: 77.193,
    northBotM: -168.014,
  },
];

const angelPlatforms = [
  {
    lineId: "northern",
    eastM: 152.797,
    northM: -185.822,
    bearingDeg: 100,
    depthM: 27.4,
  },
  {
    lineId: "northern",
    eastM: 149.67,
    northM: -223.978,
    bearingDeg: 100,
    depthM: 27.4,
  },
];

describe("escalatorPlanRunM", () => {
  it("is rise / tan(angle)", () => {
    expect(escalatorPlanRunM(10, 30)).toBeCloseTo(10 / Math.tan(Math.PI / 6));
  });
});

describe("solveStationGraph Angel", () => {
  const graph = solveStationGraph({
    banks: angelBanks,
    platforms: angelPlatforms,
    depths: [{ label: "NORTHERN LINE PLATFORMS", metres: 27.4, lineId: "northern" }],
  });

  it("uses CULG plan runs and stacks Z 0 → 27.39 → 35.39", () => {
    const e4 = graph.banks.find((b) => b.id.endsWith("-Esc-4"))!;
    const e1 = graph.banks.find((b) => b.id.endsWith("-Esc-1"))!;
    expect(Math.hypot(e4.eastBotM - e4.eastTopM, e4.northBotM - e4.northTopM)).toBeCloseTo(
      escalatorPlanRunM(27.39, 30),
      5,
    );
    expect(Math.hypot(e1.eastBotM - e1.eastTopM, e1.northBotM - e1.northTopM)).toBeCloseTo(
      escalatorPlanRunM(8, 30),
      5,
    );
    expect(e4.topDepthM).toBe(0);
    expect(e4.botDepthM).toBeCloseTo(27.39);
    expect(e1.topDepthM).toBeCloseTo(27.39);
    expect(e1.botDepthM).toBeCloseTo(35.39);
  });

  it("keeps independent CULG runs with a level corridor at the link", () => {
    const e4 = graph.banks.find((b) => b.id.endsWith("-Esc-4"))!;
    const e1 = graph.banks.find((b) => b.id.endsWith("-Esc-1"))!;
    expect(e4.eastBotM).not.toBeCloseTo(e1.eastTopM);
    expect(e4.northBotM).not.toBeCloseTo(e1.northTopM);
    expect(e4.toKey).not.toBe(e1.fromKey);
    expect(graph.hall.eastM).toBe(0);
    expect(graph.hall.northM).toBe(0);
    const cx = (angelPlatforms[0]!.eastM + angelPlatforms[1]!.eastM) / 2;
    const cy = (angelPlatforms[0]!.northM + angelPlatforms[1]!.northM) / 2;
    expect(graph.hall.eastM).not.toBeCloseTo(cx);
    expect(graph.hall.northM).not.toBeCloseTo(cy);
    const link = graph.walks.find((w) => w.toKey && !w.lineId);
    expect(link).toBeTruthy();
    expect(link!.fromKey).toBe(e4.toKey);
    expect(link!.toKey).toBe(e1.fromKey);
  });

  it("pins Northern depth to the CULG stack and flags FOI", () => {
    expect(graph.platformDepthM.northern).toBeCloseTo(35.39);
    expect(graph.flags).toContain(DEPTH_CULG_OVER_FOI);
  });

  it("keeps FOI azimuth signs on both banks", () => {
    const e4 = graph.banks.find((b) => b.id.endsWith("-Esc-4"))!;
    const e1 = graph.banks.find((b) => b.id.endsWith("-Esc-1"))!;
    expect(e4.eastBotM - e4.eastTopM).toBeGreaterThan(0);
    expect(e4.northBotM - e4.northTopM).toBeLessThan(0);
    expect(e1.eastBotM - e1.eastTopM).toBeGreaterThan(0);
    expect(e1.northBotM - e1.northTopM).toBeLessThan(0);
  });

  it("emits a walk when the lower landing misses the platform end", () => {
    expect(graph.walks.length).toBeGreaterThan(0);
    expect(graph.walks.some((w) => w.lineId === "northern")).toBe(true);
    expect(
      graph.walks.find((w) => w.lineId === "northern")!.fromKey,
    ).toBe("northern line");
  });

  it("translates by an OSM hall offset when given", () => {
    const shifted = solveStationGraph({
      banks: angelBanks,
      platforms: angelPlatforms,
      osmHallEnu: { eastM: 10, northM: -4 },
    });
    expect(shifted.hall.eastM).toBe(10);
    expect(shifted.hall.northM).toBe(-4);
    const e4 = shifted.banks.find((b) => b.id.endsWith("-Esc-4"))!;
    expect(e4.eastTopM).toBe(10);
    expect(e4.northTopM).toBe(-4);
  });
});
