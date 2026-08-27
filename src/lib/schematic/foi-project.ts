/**
 * Fit a sheet's axonometric projection from platform endpoints + bearings.
 * Isolated from routing — do not import plan/status/topology.
 * Plan offsets are reconstructed from ~2015 scans; never used for access.
 */

import { PLATFORM_LENGTH_M } from "./lu-scale";

export const PLACEMENT_RESIDUAL_LIMIT = 0.35;
export const PLACEMENT_DISAGREE_M = 30;

export type SheetMark = {
  a: [number, number];
  b: [number, number];
  bearingDeg: number;
};

export type SheetBasis = {
  /** Image Δ(u,v) → (east metres, north metres). */
  m00: number;
  m01: number;
  m10: number;
  m11: number;
  originU: number;
  originV: number;
  residual: number;
  mode: "fit" | "isometric";
};

export type PlanMetres = { eastM: number; northM: number };

/** Undirected bearing in [0, 180). 0 = north, 90 = east. */
export function undirectedBearingDeg(deg: number): number {
  let d = deg % 180;
  if (d < 0) d += 180;
  return d;
}

/** Unit plan vector (east, north) for a compass bearing clockwise from north. */
export function planDir(bearingDeg: number): [number, number] {
  const r = (bearingDeg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function hypot2(x: number, y: number): number {
  return Math.hypot(x, y);
}

function invert2(
  a: number,
  b: number,
  c: number,
  d: number,
): [number, number, number, number] | null {
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det];
}

function applyA(
  A: [number, number, number, number],
  du: number,
  dv: number,
): [number, number] {
  return [A[0] * du + A[1] * dv, A[2] * du + A[3] * dv];
}

function scaleA(
  A: [number, number, number, number],
  s: number,
): [number, number, number, number] {
  return [A[0] * s, A[1] * s, A[2] * s, A[3] * s];
}

/**
 * Image-to-plan matrix for a canonical 30° isometric, rotated so that
 * drawing north (clockwise degrees from image up) matches `northDeg`.
 */
export function isometricImageToPlan(
  northDeg: number,
): [number, number, number, number] {
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  // Plan → image (north-up isometric, v down):
  // du =  (east - north) * cos30
  // dv = -(east + north) * sin30
  const M00 = c;
  const M01 = -c;
  const M10 = -s;
  const M11 = -s;
  const th = (northDeg * Math.PI) / 180;
  // Clockwise in y-down = [cos -sin; sin cos]
  const rc = Math.cos(th);
  const rs = Math.sin(th);
  const RM00 = rc * M00 - rs * M10;
  const RM01 = rc * M01 - rs * M11;
  const RM10 = rs * M00 + rc * M10;
  const RM11 = rs * M01 + rc * M11;
  return invert2(RM00, RM01, RM10, RM11) ?? [1, 0, 0, -1];
}

function hasTwoDirections(dirs: [number, number][]): boolean {
  const units: [number, number][] = [];
  for (const d of dirs) {
    const len = hypot2(d[0], d[1]);
    if (len < 1e-9) continue;
    units.push([d[0] / len, d[1] / len]);
  }
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const dot = Math.abs(units[i]![0] * units[j]![0] + units[i]![1] * units[j]![1]);
      if (dot < Math.cos((15 * Math.PI) / 180)) return true;
    }
  }
  return false;
}

function leastSquares(
  rows: { d: [number, number]; target: [number, number] }[],
): [number, number, number, number] | null {
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let sue = 0;
  let sve = 0;
  let sun = 0;
  let svn = 0;
  for (const r of rows) {
    const [du, dv] = r.d;
    suu += du * du;
    suv += du * dv;
    svv += dv * dv;
    sue += du * r.target[0];
    sve += dv * r.target[0];
    sun += du * r.target[1];
    svn += dv * r.target[1];
  }
  const det = suu * svv - suv * suv;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  const m00 = (svv * sue - suv * sve) / det;
  const m01 = (suu * sve - suv * sue) / det;
  const m10 = (svv * sun - suv * svn) / det;
  const m11 = (suu * svn - suv * sun) / det;
  if (![m00, m01, m10, m11].every(Number.isFinite)) return null;
  return [m00, m01, m10, m11];
}

function meanCentre(marks: SheetMark[]): [number, number] {
  if (marks.length === 0) return [0.5, 0.5];
  let u = 0;
  let v = 0;
  for (const m of marks) {
    u += (m.a[0] + m.b[0]) / 2;
    v += (m.a[1] + m.b[1]) / 2;
  }
  return [u / marks.length, v / marks.length];
}

function residualOf(
  A: [number, number, number, number],
  rows: { d: [number, number]; target: [number, number] }[],
  lengthM: number,
): number {
  if (rows.length === 0) return 1;
  let acc = 0;
  for (const r of rows) {
    const p = applyA(A, r.d[0], r.d[1]);
    const dx = p[0] - r.target[0];
    const dy = p[1] - r.target[1];
    acc += (dx * dx + dy * dy) / (lengthM * lengthM);
  }
  return Math.sqrt(acc / rows.length);
}

/**
 * Fit a 2×2 image→plan basis. Needs two non-parallel image directions;
 * otherwise falls back to a northDeg-rotated isometric basis.
 */
export function fitSheetBasis(
  marks: readonly SheetMark[],
  northDeg: number | null,
  origin?: [number, number],
): SheetBasis {
  const usable = marks.filter((m) => {
    if (!Number.isFinite(m.bearingDeg)) return false;
    return hypot2(m.b[0] - m.a[0], m.b[1] - m.a[1]) > 1e-8;
  });
  const originUV = origin ?? meanCentre(usable);
  const L = PLATFORM_LENGTH_M;
  const Aiso = isometricImageToPlan(northDeg ?? 0);

  const rows = usable.map((m) => {
    const d: [number, number] = [m.b[0] - m.a[0], m.b[1] - m.a[1]];
    let u = planDir(m.bearingDeg);
    const mapped = applyA(Aiso, d[0], d[1]);
    if (mapped[0] * u[0] + mapped[1] * u[1] < 0) u = [-u[0], -u[1]];
    return { d, target: [L * u[0], L * u[1]] as [number, number] };
  });

  const parallel = !hasTwoDirections(rows.map((r) => r.d));
  let A: [number, number, number, number] = Aiso;
  let mode: SheetBasis["mode"] = "isometric";
  if (rows.length >= 2 && !parallel) {
    const fit = leastSquares(rows);
    if (fit) {
      A = fit;
      mode = "fit";
    }
  }

  const lens = rows.map((r) => hypot2(...applyA(A, r.d[0], r.d[1])));
  const meanLen =
    lens.length === 0 ? 0 : lens.reduce((a, b) => a + b, 0) / lens.length;
  if (meanLen > 1e-9) A = scaleA(A, L / meanLen);

  return {
    m00: A[0],
    m01: A[1],
    m10: A[2],
    m11: A[3],
    originU: originUV[0],
    originV: originUV[1],
    residual: residualOf(A, rows, L),
    mode,
  };
}

export function imageToPlan(
  u: number,
  v: number,
  basis: SheetBasis,
): PlanMetres {
  const du = u - basis.originU;
  const dv = v - basis.originV;
  return {
    eastM: basis.m00 * du + basis.m01 * dv,
    northM: basis.m10 * du + basis.m11 * dv,
  };
}

export function markCentre(mark: { a: [number, number]; b: [number, number] }): [
  number,
  number,
] {
  return [(mark.a[0] + mark.b[0]) / 2, (mark.a[1] + mark.b[1]) / 2];
}
