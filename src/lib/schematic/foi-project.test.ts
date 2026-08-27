import { describe, expect, it } from "vitest";
import { PLATFORM_LENGTH_M } from "./lu-scale";
import {
  PLACEMENT_RESIDUAL_LIMIT,
  fitSheetBasis,
  imageToPlan,
  isometricImageToPlan,
  planDir,
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

describe("fitSheetBasis", () => {
  const origin: [number, number] = [0.5, 0.5];
  const northDeg = 25;
  const Aiso = isometricImageToPlan(northDeg);
  const half = PLATFORM_LENGTH_M / 2;

  const nsEnds = {
    a: planToImage(0, -half, Aiso, origin),
    b: planToImage(0, half, Aiso, origin),
    bearingDeg: 0,
  };
  const ewEnds = {
    a: planToImage(40 - half, 15, Aiso, origin),
    b: planToImage(40 + half, 15, Aiso, origin),
    bearingDeg: 90,
  };

  it("round-trips known isometric offsets and bearings", () => {
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

  it("falls back to isometric when every platform is parallel", () => {
    const other = {
      a: planToImage(20, -half, Aiso, origin),
      b: planToImage(20, half, Aiso, origin),
      bearingDeg: 0,
    };
    const basis = fitSheetBasis([nsEnds, other], northDeg, origin);
    expect(basis.mode).toBe("isometric");
    const ns = imageToPlan(
      (nsEnds.a[0] + nsEnds.b[0]) / 2,
      (nsEnds.a[1] + nsEnds.b[1]) / 2,
      basis,
    );
    expect(ns.eastM).toBeCloseTo(0, 4);
    expect(ns.northM).toBeCloseTo(0, 4);
  });

  it("reports a high residual when parallel platforms claim conflicting bearings", () => {
    const other = {
      a: planToImage(20, -half, Aiso, origin),
      b: planToImage(20, half, Aiso, origin),
      bearingDeg: 90,
    };
    const basis = fitSheetBasis([nsEnds, other], northDeg, origin);
    expect(basis.mode).toBe("isometric");
    expect(basis.residual).toBeGreaterThan(PLACEMENT_RESIDUAL_LIMIT);
  });
});
