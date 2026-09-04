/**
 * Metre-graph layout: CULG rise/angle for length and Z, FOI for heading.
 * Isolated from routing — do not import plan/status/topology.
 * Depths and offsets are approximate; never used for access decisions.
 */

import {
  RISE_DISAGREE_M,
  escalatorPlanRunM,
  isSurfaceLanding,
  landingLineIds,
} from "./escalators";
import type { FoiDepth } from "./foi-extract";
import { planDir, undirectedBearingDeg } from "./foi-project";
import { PLATFORM_LENGTH_M, SCHEMATIC_UNIT_M } from "./lu-scale";
import { ESCALATOR_WIDTH_U } from "./scene";

export const ANGEL_STATION_ID = "940GZZLUAGL";
export const DEPTH_CULG_OVER_FOI = "depth-culg-over-foi";
/** Skip a level walk when the landing already sits on a platform end. */
export const WALK_GAP_M = 4;
/** Ticket-hall box along the first bank (schematic units via SCHEMATIC_UNIT_M). */
export const HALL_LENGTH_M = 10;
/** Small slab at the lower bank's bottom. */
export const LANDING_LENGTH_M = 8;

export type GraphBankIn = {
  id: string;
  from: string;
  to: string;
  riseM: number | null;
  angleDeg: number;
  eastTopM: number;
  northTopM: number;
  eastBotM: number;
  northBotM: number;
};

export type GraphPlatformIn = {
  lineId: string;
  eastM: number;
  northM: number;
  bearingDeg: number;
  depthM?: number;
};

export type GraphLanding = {
  key: string;
  label: string;
  eastM: number;
  northM: number;
  depthM: number;
  planWx?: number;
  planWy?: number;
  bearingDeg?: number;
};

export type GraphBankOut = {
  id: string;
  fromKey: string;
  toKey: string;
  eastTopM: number;
  northTopM: number;
  eastBotM: number;
  northBotM: number;
  topDepthM: number;
  botDepthM: number;
};

export type GraphWalk = {
  fromKey: string;
  /** Landing-to-landing corridor when set; else a walk to a platform. */
  toKey?: string;
  lineId?: string;
  eastFromM: number;
  northFromM: number;
  eastToM: number;
  northToM: number;
  depthM: number;
};

export type StationGraphInput = {
  banks: readonly GraphBankIn[];
  platforms: readonly GraphPlatformIn[];
  depths?: readonly FoiDepth[];
  /** Added to every east/north (OSM hall ENU vs StopPoint). */
  osmHallEnu?: { eastM: number; northM: number };
};

export type StationGraph = {
  hall: {
    eastM: number;
    northM: number;
    depthM: number;
    planWx: number;
    planWy: number;
    bearingDeg: number;
  };
  landings: GraphLanding[];
  banks: GraphBankOut[];
  walks: GraphWalk[];
  platformDepthM: Record<string, number>;
  flags: string[];
};

export function landingKey(text: string): string {
  return text.trim().toLowerCase();
}

export function solveStationGraph(input: StationGraphInput): StationGraph {
  const shiftE = input.osmHallEnu?.eastM ?? 0;
  const shiftN = input.osmHallEnu?.northM ?? 0;
  const flags: string[] = [];
  const placed = input.banks.filter(
    (b) =>
      b.riseM != null &&
      Number.isFinite(b.riseM) &&
      b.riseM > 0 &&
      Number.isFinite(b.angleDeg),
  );
  const depths = chainLandingDepths(placed);
  const byId = new Map(placed.map((b) => [b.id, b]));

  const hallXY = { eastM: shiftE, northM: shiftN, depthM: 0 };
  const ordered = orderBanksFromSurface(placed);
  const surface = ordered.find((b) => isSurfaceLanding(b.from));
  const pinE = hallXY.eastM - (surface?.eastTopM ?? 0);
  const pinN = hallXY.northM - (surface?.northTopM ?? 0);

  const banksOut: GraphBankOut[] = [];
  for (const b of ordered) {
    const fromKey = bankEndKey(b, "from");
    const toKey = bankEndKey(b, "to");
    const rise = b.riseM!;
    const run = escalatorPlanRunM(rise, b.angleDeg);
    const heading = unitHeading(
      b.eastBotM - b.eastTopM,
      b.northBotM - b.northTopM,
    );
    const top = {
      eastM: b.eastTopM + pinE,
      northM: b.northTopM + pinN,
    };
    const bot = {
      eastM: top.eastM + heading[0] * run,
      northM: top.northM + heading[1] * run,
    };
    banksOut.push({
      id: b.id,
      fromKey,
      toKey,
      eastTopM: top.eastM,
      northTopM: top.northM,
      eastBotM: bot.eastM,
      northBotM: bot.northM,
      topDepthM: depths.get(landingKey(b.from)) ?? 0,
      botDepthM: depths.get(landingKey(b.to)) ?? rise,
    });
  }

  const e4 = banksOut.find((b) => isSurfaceLanding(byId.get(b.id)?.from ?? ""));
  const hallBearing = e4
    ? headingBearingDeg(e4.eastBotM - e4.eastTopM, e4.northBotM - e4.northTopM)
    : 0;
  const hall = {
    ...hallXY,
    planWx: ESCALATOR_WIDTH_U,
    planWy: HALL_LENGTH_M / SCHEMATIC_UNIT_M,
    bearingDeg: hallBearing,
  };

  const landingsByKey = new Map<string, GraphLanding>();
  const addLanding = (row: GraphLanding) => {
    if (landingsByKey.has(row.key)) return;
    landingsByKey.set(row.key, row);
  };

  addLanding({
    key: surface ? bankEndKey(surface, "from") : landingKey("Surface ticket hall"),
    label: surface?.from ?? "Surface ticket hall",
    eastM: hall.eastM,
    northM: hall.northM,
    depthM: 0,
    planWx: hall.planWx,
    planWy: hall.planWy,
    bearingDeg: hall.bearingDeg,
  });

  for (const bank of banksOut) {
    const src = byId.get(bank.id)!;
    addLanding({
      key: bank.fromKey,
      label: src.from,
      eastM: bank.eastTopM,
      northM: bank.northTopM,
      depthM: bank.topDepthM,
    });
    const lineIds = landingLineIds(src.to);
    const lineSlab =
      lineIds.length === 1
        ? {
            planWx: ESCALATOR_WIDTH_U,
            planWy: LANDING_LENGTH_M / SCHEMATIC_UNIT_M,
            bearingDeg: headingBearingDeg(
              bank.eastBotM - bank.eastTopM,
              bank.northBotM - bank.northTopM,
            ),
          }
        : {};
    addLanding({
      key: bank.toKey,
      label: src.to,
      eastM: bank.eastBotM,
      northM: bank.northBotM,
      depthM: bank.botDepthM,
      ...lineSlab,
    });
  }

  const walks: GraphWalk[] = [];
  for (const a of banksOut) {
    const aIn = byId.get(a.id)!;
    for (const b of banksOut) {
      if (a.id === b.id) continue;
      const bIn = byId.get(b.id)!;
      if (landingKey(aIn.to) !== landingKey(bIn.from)) continue;
      if (isSurfaceLanding(aIn.to)) continue;
      if (landingLineIds(aIn.to).length > 0) continue;
      const de = b.eastTopM - a.eastBotM;
      const dn = b.northTopM - a.northBotM;
      const span = Math.hypot(de, dn);
      walks.push({
        fromKey: a.toKey,
        toKey: b.fromKey,
        eastFromM: a.eastBotM,
        northFromM: a.northBotM,
        eastToM: b.eastTopM,
        northToM: b.northTopM,
        depthM: a.botDepthM,
      });
      addLanding({
        key: "link-corridor",
        label: aIn.to,
        eastM: (a.eastBotM + b.eastTopM) / 2,
        northM: (a.northBotM + b.northTopM) / 2,
        depthM: a.botDepthM,
        planWx: ESCALATOR_WIDTH_U,
        planWy: Math.max(span, SCHEMATIC_UNIT_M) / SCHEMATIC_UNIT_M,
        bearingDeg: headingBearingDeg(de, dn),
      });
    }
  }

  const landings = [...landingsByKey.values()];

  const platformDepthM: Record<string, number> = {};
  for (const landing of landings) {
    const ids = landingLineIds(landing.label);
    if (ids.length !== 1) continue;
    const lineId = ids[0]!;
    platformDepthM[lineId] = landing.depthM;
    const foi = (input.depths ?? []).find((d) => d.lineId === lineId)?.metres;
    if (
      foi != null &&
      Math.abs(foi - landing.depthM) > RISE_DISAGREE_M &&
      !flags.includes(DEPTH_CULG_OVER_FOI)
    ) {
      flags.push(DEPTH_CULG_OVER_FOI);
    }
  }

  for (const bank of banksOut) {
    const src = byId.get(bank.id)!;
    const ids = landingLineIds(src.to);
    if (ids.length !== 1) continue;
    const lineId = ids[0]!;
    const plats = input.platforms.filter((p) => p.lineId === lineId);
    if (plats.length === 0) continue;
    const end = nearestPlatformEnd(
      bank.eastBotM,
      bank.northBotM,
      plats.map((p) => ({
        eastM: p.eastM + shiftE,
        northM: p.northM + shiftN,
        bearingDeg: p.bearingDeg,
      })),
    );
    const gap = Math.hypot(end.eastM - bank.eastBotM, end.northM - bank.northBotM);
    if (gap < WALK_GAP_M) continue;
    walks.push({
      fromKey: bank.toKey,
      lineId,
      eastFromM: bank.eastBotM,
      northFromM: bank.northBotM,
      eastToM: end.eastM,
      northToM: end.northM,
      depthM: bank.botDepthM,
    });
  }

  return {
    hall,
    landings,
    banks: banksOut,
    walks,
    platformDepthM,
    flags: [...flags].sort(),
  };
}

function bankEndKey(bank: GraphBankIn, end: "from" | "to"): string {
  const label = end === "from" ? bank.from : bank.to;
  if (isSurfaceLanding(label)) return landingKey(label);
  if (landingLineIds(label).length === 1) return landingKey(label);
  return `${bank.id}-${end === "from" ? "top" : "bot"}`;
}

function headingBearingDeg(de: number, dn: number): number {
  return undirectedBearingDeg((Math.atan2(de, dn) * 180) / Math.PI);
}

function chainLandingDepths(
  banks: readonly GraphBankIn[],
): Map<string, number> {
  const depths = new Map<string, number>();
  for (const b of banks) {
    if (isSurfaceLanding(b.from)) depths.set(landingKey(b.from), 0);
    if (isSurfaceLanding(b.to)) depths.set(landingKey(b.to), 0);
  }
  for (const b of orderBanksFromSurface(banks)) {
    const rise = b.riseM;
    if (rise == null) continue;
    const fk = landingKey(b.from);
    const tk = landingKey(b.to);
    const fromZ = depths.get(fk);
    const toZ = depths.get(tk);
    if (fromZ != null && toZ == null) depths.set(tk, fromZ + rise);
    else if (toZ != null && fromZ == null) depths.set(fk, toZ - rise);
    else if (fromZ == null && toZ == null) {
      depths.set(fk, 0);
      depths.set(tk, rise);
    } else if (
      fromZ != null &&
      toZ != null &&
      Math.abs(toZ - fromZ - rise) > RISE_DISAGREE_M
    ) {
      depths.set(tk, fromZ + rise);
    }
  }
  return depths;
}

function orderBanksFromSurface(banks: readonly GraphBankIn[]): GraphBankIn[] {
  const left = [...banks];
  const out: GraphBankIn[] = [];
  const known = new Set(
    left.filter((b) => isSurfaceLanding(b.from)).map((b) => landingKey(b.from)),
  );
  while (left.length > 0) {
    const i = left.findIndex(
      (b) => known.has(landingKey(b.from)) || isSurfaceLanding(b.from),
    );
    const take = i >= 0 ? left.splice(i, 1)[0]! : left.shift()!;
    out.push(take);
    known.add(landingKey(take.from));
    known.add(landingKey(take.to));
  }
  return out;
}

function unitHeading(de: number, dn: number): [number, number] {
  const len = Math.hypot(de, dn);
  if (len < 1e-9) return [0, -1];
  return [de / len, dn / len];
}

function platformEnds(plat: {
  eastM: number;
  northM: number;
  bearingDeg: number;
}): { eastM: number; northM: number }[] {
  const [e, n] = planDir(plat.bearingDeg);
  const h = PLATFORM_LENGTH_M / 2;
  return [
    { eastM: plat.eastM + e * h, northM: plat.northM + n * h },
    { eastM: plat.eastM - e * h, northM: plat.northM - n * h },
  ];
}

function nearestPlatformEnd(
  eastM: number,
  northM: number,
  plats: { eastM: number; northM: number; bearingDeg: number }[],
): { eastM: number; northM: number } {
  let best = { eastM: plats[0]!.eastM, northM: plats[0]!.northM };
  let bestD = Infinity;
  for (const p of plats) {
    for (const end of platformEnds(p)) {
      const d = Math.hypot(end.eastM - eastM, end.northM - northM);
      if (d < bestD) {
        bestD = d;
        best = end;
      }
    }
  }
  return best;
}
