import { describe, expect, it } from "vitest";
import { PLATFORM_LENGTH_M } from "./lu-scale";
import {
  PLACEMENT_RESIDUAL_LIMIT,
  fitSheetBasis,
  imageToPlan,
  planDir,
  planImageToPlan,
  undirectedBearingDeg,
} from "./foi-project";

function invert2(
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number, number, number] {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det];
}

function planToImage(
  eastM: number,
  northM: number,
  A: [number, number, number, number],
  origin: [number, number],
): [number, number] {
  const M = invert2(A[0], A[1], A[2], A[3]);
  return [
    origin[0] + M[0] * eastM + M[1] * northM,
    origin[1] + M[2] * eastM + M[3] * northM,
  ];
}

describe("undirectedBearingDeg", () => {
  it("folds 0/180 and 90/270 together", () => {
    expect(undirectedBearingDeg(0)).toBe(0);
    expect(undirectedBearingDeg(180)).toBe(0);
    expect(undirectedBearingDeg(90)).toBe(90);
    expect(undirectedBearingDeg(270)).toBe(90);
    expect(undirectedBearingDeg(-10)).toBeCloseTo(170);
  });
});

describe("planDir", () => {
  it("sends north to +north and east to +east", () => {
    expect(planDir(0)[0]).toBeCloseTo(0);
    expect(planDir(0)[1]).toBeCloseTo(1);
    expect(planDir(90)[0]).toBeCloseTo(1);
    expect(planDir(90)[1]).toBeCloseTo(0);
  });
});

describe("planImageToPlan", () => {
  it("maps right to east and down to south when the rose points up", () => {
    const A = planImageToPlan(0);
    expect(A[0] * 0.1 + A[1] * 0).toBeGreaterThan(0);
    expect(A[2] * 0 + A[3] * 0.1).toBeLessThan(0);
  });
});

describe("fitSheetBasis", () => {
  const origin: [number, number] = [0.5, 0.5];
  const northDeg = 25;
  const Aplan = planImageToPlan(northDeg);
  const half = PLATFORM_LENGTH_M / 2;

  const nsEnds = {
    a: planToImage(0, -half, Aplan, origin),
    b: planToImage(0, half, Aplan, origin),
    bearingDeg: 0,
  };
  const ewEnds = {
    a: planToImage(40 - half, 15, Aplan, origin),
    b: planToImage(40 + half, 15, Aplan, origin),
    bearingDeg: 90,
  };

  it("round-trips known plan offsets and bearings", () => {
    const basis = fitSheetBasis([nsEnds, ewEnds], northDeg, origin);
    expect(basis.mode).toBe("fit");
    expect(basis.residual).toBeLessThan(0.05);

    const ns = imageToPlan(
      (nsEnds.a[0] + nsEnds.b[0]) / 2,
      (nsEnds.a[1] + nsEnds.b[1]) / 2,
      basis,
    );
    const ew = imageToPlan(
      (ewEnds.a[0] + ewEnds.b[0]) / 2,
      (ewEnds.a[1] + ewEnds.b[1]) / 2,
      basis,
    );
    expect(ns.eastM).toBeCloseTo(0, 5);
    expect(ns.northM).toBeCloseTo(0, 5);
    expect(ew.eastM).toBeCloseTo(40, 5);
    expect(ew.northM).toBeCloseTo(15, 5);
  });

  it("falls back to plan when every platform is parallel", () => {
    const other = {
      a: planToImage(20, -half, Aplan, origin),
      b: planToImage(20, half, Aplan, origin),
      bearingDeg: 0,
    };
    const basis = fitSheetBasis([nsEnds, other], northDeg, origin);
    expect(basis.mode).toBe("plan");
    const ns = imageToPlan(
      (nsEnds.a[0] + nsEnds.b[0]) / 2,
      (nsEnds.a[1] + nsEnds.b[1]) / 2,
      basis,
    );
    expect(ns.eastM).toBeCloseTo(0, 4);
    expect(ns.northM).toBeCloseTo(0, 4);
  });

  it("round-trips a known east offset through the plan fallback", () => {
    const other = {
      a: planToImage(40, -half, Aplan, origin),
      b: planToImage(40, half, Aplan, origin),
      bearingDeg: 0,
    };
    const basis = fitSheetBasis([nsEnds, other], northDeg, origin);
    expect(basis.mode).toBe("plan");
    const hit = imageToPlan(
      (other.a[0] + other.b[0]) / 2,
      (other.a[1] + other.b[1]) / 2,
      basis,
    );
    expect(hit.eastM).toBeCloseTo(40, 4);
    expect(hit.northM).toBeCloseTo(0, 4);
  });

  it("maps a Pimlico-shaped vertical gap to south, not west", () => {
    const northUp: [number, number, number, number] = planImageToPlan(0);
    const upper = {
      a: planToImage(-half, 0, northUp, origin),
      b: planToImage(half, 0, northUp, origin),
      bearingDeg: 90,
    };
    const lower = {
      a: planToImage(-half, -20, northUp, origin),
      b: planToImage(half, -20, northUp, origin),
      bearingDeg: 90,
    };
    const basis = fitSheetBasis([upper, lower], 0, origin);
    expect(basis.mode).toBe("plan");
    const u = imageToPlan(
      (upper.a[0] + upper.b[0]) / 2,
      (upper.a[1] + upper.b[1]) / 2,
      basis,
    );
    const lo = imageToPlan(
      (lower.a[0] + lower.b[0]) / 2,
      (lower.a[1] + lower.b[1]) / 2,
      basis,
    );
    expect(u.eastM).toBeCloseTo(lo.eastM, 4);
    expect(u.northM - lo.northM).toBeCloseTo(20, 4);
  });

  it("reports a high residual when parallel platforms claim conflicting bearings", () => {
    const other = {
      a: planToImage(20, -half, Aplan, origin),
      b: planToImage(20, half, Aplan, origin),
      bearingDeg: 90,
    };
    const basis = fitSheetBasis([nsEnds, other], northDeg, origin);
    expect(basis.mode).toBe("plan");
    expect(basis.residual).toBeGreaterThan(PLACEMENT_RESIDUAL_LIMIT);
  });
});
