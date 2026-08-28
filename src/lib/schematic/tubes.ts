/**
 * World-space tube meshes for inter-station lines.
 * Isolated from routing — do not import plan/status/topology.
 */

import {
  CatmullRomCurve3,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SURFACE_ORDER } from "./building-geom";
import { platformWorldY } from "./foi-layout";
import {
  NEIGHBOR_UNLOAD_RADIUS_M,
  distanceM,
  type LatLon,
} from "./geo";
import {
  headingAxis,
  headingPerp,
  lineAnchor,
  lineAnchorWorld,
  type LineNetwork,
} from "./lines";
import {
  DEEP_TUBE_DIAMETER_M,
  PLATFORM_LENGTH_M,
  PLATFORM_WIDTH_M,
  isSubsurfaceLine,
  tubeRadiusM,
} from "./lu-scale";
import {
  schematicEdgeColor,
  schematicFaceColor,
  type SceneQuality,
  type Vec3,
} from "./scene";

export const TUBE_RADIUS = DEEP_TUBE_DIAMETER_M / 2;
export const TUBE_SEGMENT_M = 40;
/** Schematic minimum running-tunnel radius (LU-ish). */
export const TUBE_MIN_RADIUS_M = 200;
export const TUBE_COINCIDENT_M = 1;
export const TUBE_FANOUT_M = DEEP_TUBE_DIAMETER_M;
/** Below the translucent ground so tubes read as underground. */
export const TUBE_RENDER_ORDER = SURFACE_ORDER.ground - 1;
export const TUBE_FACE_OPACITY = 0.2;

export type TubeMesh = {
  lineId: string;
  track: number;
  geometry: BufferGeometry;
  faceColor: string;
  edgeColor: string;
  centreline: Vec3[];
};

export type TubeAnchorKey = `${string}\0${string}\0${number}`;

export function tubeAnchorKey(
  stationId: string,
  lineId: string,
  track = 0,
): TubeAnchorKey {
  return `${stationId}\0${lineId}\0${track}`;
}

export function parseTubeAnchorKey(key: string): {
  stationId: string;
  lineId: string;
  track: number;
} {
  const i = key.indexOf("\0");
  const j = key.lastIndexOf("\0");
  if (i < 0) {
    return { stationId: key, lineId: "", track: 0 };
  }
  if (j === i) {
    return {
      stationId: key.slice(0, i),
      lineId: key.slice(i + 1),
      track: 0,
    };
  }
  return {
    stationId: key.slice(0, i),
    lineId: key.slice(i + 1, j),
    track: Number.parseInt(key.slice(j + 1), 10) || 0,
  };
}

export type WorldAnchor = { x: number; y: number; z: number };

export function trackCountForLine(lineId: string): number {
  return isSubsurfaceLine(lineId) ? 1 : 2;
}

export function worldAnchors(
  network: LineNetwork,
  origin: LatLon,
): Map<TubeAnchorKey, WorldAnchor> {
  const out = new Map<TubeAnchorKey, WorldAnchor>();
  for (const chain of network.chains) {
    const tracks = trackCountForLine(chain.lineId);
    for (const stationId of chain.stationIds) {
      const st = network.stations[stationId];
      if (!st) continue;
      const y = platformWorldY(stationId, chain.lineId);
      for (let track = 0; track < tracks; track++) {
        const key = tubeAnchorKey(stationId, chain.lineId, track);
        if (out.has(key)) continue;
        const xz = lineAnchorWorld(
          st,
          lineAnchor(network.anchors, stationId, chain.lineId, track),
          origin,
        );
        out.set(key, { x: xz.x, y, z: xz.z });
      }
    }
  }
  inventDeepTrackPairs(network, out);
  return out;
}

function inventDeepTrackPairs(
  network: LineNetwork,
  anchors: Map<TubeAnchorKey, WorldAnchor>,
): void {
  const gap = PLATFORM_WIDTH_M + DEEP_TUBE_DIAMETER_M;
  const seen = new Set<string>();
  for (const chain of network.chains) {
    if (trackCountForLine(chain.lineId) < 2) continue;
    for (const stationId of chain.stationIds) {
      const stamp = `${stationId}\0${chain.lineId}`;
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      const a = anchors.get(tubeAnchorKey(stationId, chain.lineId, 0));
      const b = anchors.get(tubeAnchorKey(stationId, chain.lineId, 1));
      if (!a || !b) continue;
      if (Math.hypot(b.x - a.x, b.z - a.z) > TUBE_COINCIDENT_M) continue;
      const angle = network.angles[stationId]?.[chain.lineId] ?? 0;
      const perp = headingPerp(angle);
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      anchors.set(tubeAnchorKey(stationId, chain.lineId, 0), {
        x: mx - 0.5 * gap * perp.x,
        y: a.y,
        z: mz - 0.5 * gap * perp.z,
      });
      anchors.set(tubeAnchorKey(stationId, chain.lineId, 1), {
        x: mx + 0.5 * gap * perp.x,
        y: b.y,
        z: mz + 0.5 * gap * perp.z,
      });
    }
  }
}

/**
 * Offset coincident anchors (no distinct platform) perpendicular to the
 * station's line bearing, before curve fitting. Only fans *different lines*;
 * the two tracks of one deep-level line are already a pair.
 */
export function applyFanout(
  network: LineNetwork,
  anchors: Map<TubeAnchorKey, WorldAnchor>,
  spacingM: number = TUBE_FANOUT_M,
  coincidentM: number = TUBE_COINCIDENT_M,
): Map<TubeAnchorKey, WorldAnchor> {
  const out = new Map(anchors);
  const byStation = new Map<
    string,
    { lineId: string; track: number; key: TubeAnchorKey }[]
  >();
  for (const key of anchors.keys()) {
    const parsed = parseTubeAnchorKey(key);
    const list = byStation.get(parsed.stationId) ?? [];
    list.push({ ...parsed, key });
    byStation.set(parsed.stationId, list);
  }

  for (const [stationId, items] of byStation) {
    const leftover = [...items].sort(
      (a, b) =>
        a.lineId.localeCompare(b.lineId) || a.track - b.track,
    );
    while (leftover.length > 0) {
      const seed = leftover.shift()!;
      const seedPos = out.get(seed.key)!;
      const cluster = [seed];
      for (let i = leftover.length - 1; i >= 0; i--) {
        const other = leftover[i]!;
        const p = out.get(other.key)!;
        if (Math.hypot(p.x - seedPos.x, p.z - seedPos.z) <= coincidentM) {
          cluster.push(other);
          leftover.splice(i, 1);
        }
      }
      const lineIds = new Set(cluster.map((c) => c.lineId));
      if (lineIds.size < 2) continue;
      cluster.sort(
        (a, b) => a.lineId.localeCompare(b.lineId) || a.track - b.track,
      );
      const n = cluster.length;
      const mid = (n - 1) / 2;
      const gap = Math.max(
        spacingM,
        ...cluster.map((c) => 2 * tubeRadiusM(c.lineId)),
      );
      for (let i = 0; i < n; i++) {
        const item = cluster[i]!;
        const angle = network.angles[stationId]?.[item.lineId] ?? 0;
        const px = Math.cos(angle);
        const pz = -Math.sin(angle);
        const shift = (i - mid) * gap;
        const p = out.get(item.key)!;
        out.set(item.key, {
          x: p.x + px * shift,
          y: p.y,
          z: p.z + pz * shift,
        });
      }
    }
  }
  return out;
}

export function clipChainStations(
  stationIds: string[],
  network: LineNetwork,
  focus: LatLon,
  radiusM: number,
): string[][] {
  const inRange = (id: string) => {
    const s = network.stations[id];
    if (!s) return false;
    return distanceM(s, focus) <= radiusM;
  };
  const keep = stationIds.map((id, i) => {
    if (inRange(id)) return true;
    if (i > 0 && inRange(stationIds[i - 1]!)) return true;
    if (i < stationIds.length - 1 && inRange(stationIds[i + 1]!)) return true;
    return false;
  });
  const runs: string[][] = [];
  let run: string[] = [];
  for (let i = 0; i < stationIds.length; i++) {
    if (keep[i]) {
      run.push(stationIds[i]!);
    } else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

function xzForward(
  from: WorldAnchor,
  to: WorldAnchor,
): { x: number; z: number } | null {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const len = Math.hypot(x, z);
  if (len < 1e-6) return null;
  return { x: x / len, z: z / len };
}

/** Swap the pair so track 1 sits to the right of `forward` (Y-up). */
export function alignTrackPair(
  a: WorldAnchor,
  b: WorldAnchor,
  forward: { x: number; z: number },
): [WorldAnchor, WorldAnchor] {
  const sideX = forward.z;
  const sideZ = -forward.x;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (dx * sideX + dz * sideZ < 0) return [b, a];
  return [a, b];
}

function stationForward(
  pts: WorldAnchor[],
  i: number,
): { x: number; z: number } | null {
  if (i + 1 < pts.length) return xzForward(pts[i]!, pts[i + 1]!);
  if (i > 0) return xzForward(pts[i - 1]!, pts[i]!);
  return null;
}

/**
 * Control points for one track of a chain run: aligned left/right, then
 * FOI tangent handles at stations that have a sheet bearing.
 */
export function trackControlPoints(
  network: LineNetwork,
  lineId: string,
  run: string[],
  track: number,
  anchors: Map<TubeAnchorKey, WorldAnchor>,
  closed: boolean,
): WorldAnchor[] {
  const nTracks = trackCountForLine(lineId);
  const stations: WorldAnchor[] = [];
  for (const id of run) {
    const p = anchors.get(tubeAnchorKey(id, lineId, Math.min(track, nTracks - 1)));
    if (p) stations.push(p);
  }
  if (stations.length < 2) return stations;

  if (nTracks > 1) {
    const spine: WorldAnchor[] = [];
    for (const id of run) {
      const p0 = anchors.get(tubeAnchorKey(id, lineId, 0));
      const p1 = anchors.get(tubeAnchorKey(id, lineId, 1));
      if (p0 && p1) {
        spine.push({
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2,
          z: (p0.z + p1.z) / 2,
        });
      } else if (p0) {
        spine.push(p0);
      }
    }
    const aligned: WorldAnchor[] = [];
    for (let i = 0; i < run.length; i++) {
      const p0 = anchors.get(tubeAnchorKey(run[i]!, lineId, 0));
      const p1 = anchors.get(tubeAnchorKey(run[i]!, lineId, 1));
      if (!p0 || !p1) {
        if (p0) aligned.push(p0);
        continue;
      }
      let fwd = stationForward(spine, i);
      if (!fwd && closed && spine.length > 1) {
        fwd =
          i === 0
            ? xzForward(spine[spine.length - 1]!, spine[0]!)
            : xzForward(spine[i]!, spine[(i + 1) % spine.length]!);
      }
      const pair = fwd ? alignTrackPair(p0, p1, fwd) : [p0, p1];
      aligned.push(pair[track]!);
    }
    return insertFoiHandles(network, lineId, run, aligned, closed);
  }
  return stations;
}

function neighbourAt(
  stations: WorldAnchor[],
  i: number,
  dir: -1 | 1,
  closed: boolean,
): WorldAnchor | null {
  const n = stations.length;
  if (n < 2) return null;
  if (closed) return stations[(i + dir + n) % n]!;
  const j = i + dir;
  if (j < 0 || j >= n) return null;
  return stations[j]!;
}

function alongAxis(
  p: WorldAnchor,
  ux: number,
  uz: number,
  dist: number,
): WorldAnchor {
  return { x: p.x + dist * ux, y: p.y, z: p.z + dist * uz };
}

function chordAngle(
  ux: number,
  uz: number,
  from: WorldAnchor,
  to: WorldAnchor,
): number {
  const cx = to.x - from.x;
  const cz = to.z - from.z;
  const len = Math.hypot(cx, cz);
  if (len < 1e-6) return 0;
  const dot = (ux * cx + uz * cz) / len;
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** Platform-end distance and optional lead-in along one ray toward `neighbour`. */
function sideHandles(
  p: WorldAnchor,
  neighbour: WorldAnchor | null,
  ux: number,
  uz: number,
): { dEnd: number; dLead: number | null } {
  const dEndDefault = PLATFORM_LENGTH_M / 2;
  if (!neighbour) return { dEnd: dEndDefault, dLead: null };
  const gap = Math.hypot(neighbour.x - p.x, neighbour.z - p.z);
  const dEnd =
    gap < 2 * dEndDefault ? Math.max(1, 0.4 * gap) : dEndDefault;
  const theta = chordAngle(ux, uz, p, neighbour);
  const extra =
    TUBE_MIN_RADIUS_M * Math.tan(Math.min(theta, Math.PI - 1e-3) / 2);
  const dLead = Math.min(dEnd + extra, 0.45 * gap);
  if (dLead < dEnd + 8) return { dEnd, dLead: null };
  return { dEnd, dLead };
}

function insertFoiHandles(
  network: LineNetwork,
  lineId: string,
  run: string[],
  stations: WorldAnchor[],
  closed: boolean,
): WorldAnchor[] {
  const out: WorldAnchor[] = [];
  for (let i = 0; i < stations.length; i++) {
    const p = stations[i]!;
    const stationId = run[i];
    if (!stationId || !network.foi?.[stationId]?.[lineId]) {
      out.push(p);
      continue;
    }
    const angle = network.angles[stationId]?.[lineId];
    if (angle == null) {
      out.push(p);
      continue;
    }
    let axis = headingAxis(angle);
    let fwd: { x: number; z: number } | null = null;
    if (i + 1 < stations.length) fwd = xzForward(p, stations[i + 1]!);
    else if (i > 0) fwd = xzForward(stations[i - 1]!, p);
    else if (closed && stations.length > 1) {
      fwd = xzForward(p, stations[(i + 1) % stations.length]!);
    }
    if (fwd && axis.x * fwd.x + axis.z * fwd.z < 0) {
      axis = { x: -axis.x, z: -axis.z };
    }
    const first = i === 0 && !closed;
    const last = i === stations.length - 1 && !closed;
    if (!first) {
      const prev = neighbourAt(stations, i, -1, closed);
      const side = sideHandles(p, prev, -axis.x, -axis.z);
      if (side.dLead != null) {
        out.push(alongAxis(p, -axis.x, -axis.z, side.dLead));
      }
      out.push(alongAxis(p, -axis.x, -axis.z, side.dEnd));
    }
    out.push(p);
    if (!last) {
      const next = neighbourAt(stations, i, 1, closed);
      const side = sideHandles(p, next, axis.x, axis.z);
      out.push(alongAxis(p, axis.x, axis.z, side.dEnd));
      if (side.dLead != null) {
        out.push(alongAxis(p, axis.x, axis.z, side.dLead));
      }
    }
  }
  return out;
}

function curveThrough(
  points: WorldAnchor[],
  closed: boolean,
): CatmullRomCurve3 | null {
  if (points.length < 2) return null;
  const vecs = points.map((p) => new Vector3(p.x, p.y, p.z));
  return new CatmullRomCurve3(vecs, closed, "centripetal");
}

function meshKey(lineId: string, track: number): string {
  return `${lineId}\0${track}`;
}

function parseMeshKey(key: string): { lineId: string; track: number } {
  const sep = key.lastIndexOf("\0");
  return {
    lineId: key.slice(0, sep),
    track: Number.parseInt(key.slice(sep + 1), 10) || 0,
  };
}

type TubeBuildAcc = {
  network: LineNetwork;
  radial: number;
  base: Map<TubeAnchorKey, WorldAnchor>;
  geoms: Map<string, BufferGeometry[]>;
  lines: Map<string, Vec3[]>;
};

function createTubeBuildAcc(
  network: LineNetwork,
  origin: LatLon,
  quality: SceneQuality,
): TubeBuildAcc {
  return {
    network,
    radial: quality === "high" ? 12 : 8,
    base: applyFanout(network, worldAnchors(network, origin)),
    geoms: new Map(),
    lines: new Map(),
  };
}

function processChain(acc: TubeBuildAcc, chain: LineNetwork["chains"][number]) {
  const run = chain.stationIds;
  if (run.length < 2) return;
  const nTracks = trackCountForLine(chain.lineId);
  const closed = !!chain.closed;
  for (let track = 0; track < nTracks; track++) {
    const pts = trackControlPoints(
      acc.network,
      chain.lineId,
      run,
      track,
      acc.base,
      closed,
    );
    const curve = curveThrough(pts, closed);
    if (!curve) continue;
    const length = curve.getLength();
    const tubular = Math.max(1, Math.round(length / TUBE_SEGMENT_M));
    const geom = new TubeGeometry(
      curve,
      tubular,
      tubeRadiusM(chain.lineId),
      acc.radial,
      closed,
    );
    const k = meshKey(chain.lineId, track);
    const list = acc.geoms.get(k) ?? [];
    list.push(geom);
    acc.geoms.set(k, list);

    const spaced = curve.getSpacedPoints(Math.max(2, tubular));
    const centre = acc.lines.get(k) ?? [];
    for (let i = 0; i + 1 < spaced.length; i++) {
      const a = spaced[i]!;
      const b = spaced[i + 1]!;
      centre.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
    }
    acc.lines.set(k, centre);
  }
}

function tubeMeshForKey(
  acc: TubeBuildAcc,
  key: string,
  geometry: BufferGeometry,
  centreline: Vec3[],
): TubeMesh {
  const { lineId, track } = parseMeshKey(key);
  return {
    lineId,
    track,
    geometry,
    faceColor: schematicFaceColor("platform", lineId),
    edgeColor: schematicEdgeColor("platform", lineId),
    centreline,
  };
}

/** Unmerged per-chain parts — safe to show while the rest of the network builds. */
function previewTubeMeshes(acc: {
  geoms: Map<string, BufferGeometry[]>;
  lines: Map<string, Vec3[]>;
  network: LineNetwork;
}): TubeMesh[] {
  const meshes: TubeMesh[] = [];
  const keys = [...acc.geoms.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const parts = acc.geoms.get(k)!;
    const centre = acc.lines.get(k) ?? [];
    const { lineId, track } = parseMeshKey(k);
    for (let i = 0; i < parts.length; i++) {
      meshes.push({
        lineId,
        track,
        geometry: parts[i]!,
        faceColor: schematicFaceColor("platform", lineId),
        edgeColor: schematicEdgeColor("platform", lineId),
        centreline: i === 0 ? centre : [],
      });
    }
  }
  return meshes;
}

function disposeAccParts(acc: TubeBuildAcc) {
  for (const parts of acc.geoms.values()) {
    for (const g of parts) g.dispose();
  }
  acc.geoms.clear();
  acc.lines.clear();
}

export type TubeMeshesBuild = {
  meshes: TubeMesh[];
  /** Parts replaced by a merge; dispose after React swaps to `meshes`. */
  leftovers: BufferGeometry[];
};

function finalizeTubeMeshes(acc: TubeBuildAcc): TubeMeshesBuild {
  const meshes: TubeMesh[] = [];
  const leftovers: BufferGeometry[] = [];
  const keys = [...acc.geoms.keys()].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const parts = acc.geoms.get(k)!;
    const merged =
      parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
    if (!merged) continue;
    if (parts.length > 1) leftovers.push(...parts);
    meshes.push(tubeMeshForKey(acc, k, merged, acc.lines.get(k) ?? []));
  }
  return { meshes, leftovers };
}

export function buildTubeMeshes(
  network: LineNetwork,
  origin: LatLon,
  quality: SceneQuality = "high",
): TubeMesh[] {
  const acc = createTubeBuildAcc(network, origin, quality);
  for (const chain of network.chains) processChain(acc, chain);
  const { meshes, leftovers } = finalizeTubeMeshes(acc);
  for (const g of leftovers) g.dispose();
  return meshes;
}

export type TubeBuildChunkOptions = {
  signal?: AbortSignal;
  /** Return true to wait a frame before the next chain. Tests pass `() => false`. */
  shouldYield?: () => boolean | Promise<boolean>;
  onChunk?: (meshes: TubeMesh[]) => void;
  /** Work slice before yielding when `shouldYield` is omitted. */
  budgetMs?: number;
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export async function buildTubeMeshesChunked(
  network: LineNetwork,
  origin: LatLon,
  quality: SceneQuality = "high",
  options: TubeBuildChunkOptions = {},
): Promise<TubeMeshesBuild> {
  const acc = createTubeBuildAcc(network, origin, quality);
  const budgetMs = options.budgetMs ?? 8;
  let sliceStart = performance.now();
  const abort = () => {
    disposeAccParts(acc);
    return { meshes: [] as TubeMesh[], leftovers: [] as BufferGeometry[] };
  };

  for (const chain of network.chains) {
    if (options.signal?.aborted) return abort();
    processChain(acc, chain);
    if (options.signal?.aborted) return abort();
    const overBudget = performance.now() - sliceStart >= budgetMs;
    const yieldNow = options.shouldYield
      ? await options.shouldYield()
      : overBudget;
    if (yieldNow) {
      options.onChunk?.(previewTubeMeshes(acc));
      await nextFrame();
      if (options.signal?.aborted) return abort();
      sliceStart = performance.now();
    }
  }
  if (options.signal?.aborted) return abort();
  return finalizeTubeMeshes(acc);
}

export function disposeTubeMeshes(meshes: TubeMesh[]) {
  for (const m of meshes) m.geometry.dispose();
}

export function disposeGeometries(geoms: BufferGeometry[]) {
  for (const g of geoms) g.dispose();
}
