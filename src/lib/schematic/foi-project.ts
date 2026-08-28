/**
 * Fit a sheet's axonometric projection from platform endpoints + bearings.
 * Isolated from routing — do not import plan/status/topology.
 * Plan offsets are reconstructed from ~2015 scans; never used for access.
 */

import { PLATFORM_LENGTH_M } from "./lu-scale";

export const PLACEMENT_RESIDUAL_LIMIT = 0.35;
export const PLACEMENT_DISAGREE_M = 30;
/** FOI A4 landscape width / height. Normalised x is stretched vs y. */
export const SHEET_ASPECT = 841.92 / 595.32;

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
  mode: "fit" | "plan";
};

export type PlanMetres = { eastM: number; northM: number };

/** Undirected bearing in [0, 180). 0 = north, 90 = east. */
export function undirectedBearingDeg(deg: number): number {
  let d = deg % 180;
  if (d < 0) d += 180;
  return d;
}

/** FOI undirected bearing → rotationY that maps a +Z-long slab onto the line. */
export function bearingToRotationY(bearingDeg: number): number {
  return -((bearingDeg * Math.PI) / 180);
}

/** Unit plan vector (east, north) for a compass bearing clockwise from north. */
export function planDir(bearingDeg: number): [number, number] {
  const r = (bearingDeg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

function hypot2(x: number, y: number): number {
  return Math.hypot(x, y);
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
 * Image-to-plan matrix: the page is a map, the rose is north.
 * `northDeg` is clockwise from image up (v down). A square on the A4
 * page is a square in metres (`SHEET_ASPECT` stretches normalised u).
 */
export function planImageToPlan(
  northDeg: number,
): [number, number, number, number] {
  const th = (northDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  // northDeg=0: east = du * SHEET_ASPECT, north = -dv.
  return [c * SHEET_ASPECT, s, s * SHEET_ASPECT, -c];
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
 * otherwise falls back to a north-up plan (rose = north, page = map).
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
  const Aplan = planImageToPlan(northDeg ?? 0);

  const rows = usable.map((m) => {
    const d: [number, number] = [m.b[0] - m.a[0], m.b[1] - m.a[1]];
    let u = planDir(m.bearingDeg);
    const mapped = applyA(Aplan, d[0], d[1]);
    if (mapped[0] * u[0] + mapped[1] * u[1] < 0) u = [-u[0], -u[1]];
    return { d, target: [L * u[0], L * u[1]] as [number, number] };
  });

  const parallel = !hasTwoDirections(rows.map((r) => r.d));
  let A: [number, number, number, number] = Aplan;
  let mode: SheetBasis["mode"] = "plan";
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
