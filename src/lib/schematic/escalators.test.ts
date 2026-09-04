import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bankLandingScore,
  culgMachineCount,
  escalatorCountMismatch,
  escalatorLengthM,
  escalatorPlanRunM,
  joinCulgEscalators,
  pickRise,
  type CulgEscalatorsFile,
} from "./escalators";
import type { FoiStationLayout } from "./foi-extract";

const culg = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "data/foi/culg-escalators.json"),
    "utf8",
  ),
) as CulgEscalatorsFile;

function toyStation(
  escalators: FoiStationLayout["escalators"],
): FoiStationLayout {
  return {
    stationId: "940GZZLUAGL",
    northDeg: 315,
    depths: [
      { label: "NORTHERN LINE PLATFORMS", metres: 27.4, lineId: "northern" },
    ],
    platforms: [],
    marks: [],
    escalators,
    sources: [],
  };
}

describe("CULG machine counts", () => {
  it("flags CULG vs StopPoint mismatches and matches Angel and Old Street", () => {
    const byId = new Map(culg.stations.map((s) => [s.stationId, s]));
    expect(escalatorCountMismatch(byId.get("940GZZLUAGL")!)).toEqual({
      culg: 6,
      tfl: 6,
      mismatch: false,
    });
    expect(escalatorCountMismatch(byId.get("HUBOLD")!)).toEqual({
      culg: 3,
      tfl: 3,
      mismatch: false,
    });
    expect(escalatorCountMismatch(byId.get("HUBKGX")!).mismatch).toBe(false);
    expect(escalatorCountMismatch(byId.get("HUBEUS")!).mismatch).toBe(true);
    expect(escalatorCountMismatch(byId.get("HUBWAT")!).mismatch).toBe(true);
    expect(escalatorCountMismatch(byId.get("HUBBAN")!).mismatch).toBe(true);
    expect(culgMachineCount(byId.get("HUBKGX")!)).toBe(19);
  });
});

describe("pickRise and length", () => {
  it("keeps the FOI delta when it disagrees with CULG by more than 3 m", () => {
    expect(
      pickRise({ culgRiseM: 8, topDepthM: 0, botDepthM: 27.4 }),
    ).toEqual({ riseM: 27.4, flags: ["rise-foi-over-culg"] });
    expect(
      pickRise({ culgRiseM: 8, topDepthM: 19.4, botDepthM: 27.4 }),
    ).toEqual({ riseM: 8, flags: [] });
  });

  it("is rise / sin(angle)", () => {
    expect(escalatorLengthM(10, 30)).toBeCloseTo(20);
    expect(escalatorPlanRunM(10, 30)).toBeCloseTo(10 / Math.tan(Math.PI / 6));
  });
});

describe("joinCulgEscalators", () => {
  it("joins by landing text and leaves unmatched CULG banks unplaced", () => {
    const [st] = joinCulgEscalators(
      [
        toyStation([
          {
            id: "940GZZLUAGL-Esc-foi-1",
            caption: "surface ticket hall to link passage",
            eNumbers: [],
            from: "surface ticket hall to link passage",
            to: "",
            eastTopM: 10,
            northTopM: 20,
            eastBotM: 30,
            northBotM: 4,
            topDepthM: null,
            botDepthM: null,
            riseM: null,
            angleDeg: 30,
            machines: 3,
            placed: true,
            sources: [{ file: "3d northern line stations Redacted.pdf", page: 1 }],
          },
        ]),
      ],
      culg,
    );
    const e4 = st!.escalators.find((e) => e.id.endsWith("-Esc-4"));
    const e1 = st!.escalators.find((e) => e.id.endsWith("-Esc-1"));
    expect(e4).toMatchObject({
      placed: true,
      eNumbers: ["E4", "E5", "E6"],
      eastTopM: 10,
      northTopM: 20,
      riseM: 27.39,
    });
    expect(e1).toMatchObject({
      placed: false,
      eNumbers: ["E1", "E2", "E3"],
      eastTopM: null,
    });
    expect(
      bankLandingScore(
        "east intermediate to Jubilee Line west end",
        "east intermediate level",
        "Jubilee Line west end",
      ),
    ).toBeGreaterThan(0.7);
    expect(
      bankLandingScore(
        "east intermediate to Jubilee Line west end",
        "east intermediate level",
        "Jubilee Line east end",
      ),
    ).toBeLessThan(0.7);
  });
});
