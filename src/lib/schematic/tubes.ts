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
  lineAnchor,
  lineAnchorWorld,
  type LineNetwork,
} from "./lines";
import {
  DEEP_TUBE_DIAMETER_M,
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
export const TUBE_COINCIDENT_M = 1;
export const TUBE_FANOUT_M = DEEP_TUBE_DIAMETER_M;
/** Below the translucent ground so tubes read as underground. */
export const TUBE_RENDER_ORDER = SURFACE_ORDER.ground - 1;

export type TubeMesh = {
  lineId: string;
  geometry: BufferGeometry;
  faceColor: string;
  edgeColor: string;
  centreline: Vec3[];
};

export type TubeAnchorKey = `${string}\0${string}`;

export function tubeAnchorKey(stationId: string, lineId: string): TubeAnchorKey {
  return `${stationId}\0${lineId}`;
}

export type WorldAnchor = { x: number; y: number; z: number };

export function worldAnchors(
  network: LineNetwork,
  origin: LatLon,
): Map<TubeAnchorKey, WorldAnchor> {
  const out = new Map<TubeAnchorKey, WorldAnchor>();
  for (const chain of network.chains) {
    for (const stationId of chain.stationIds) {
      const key = tubeAnchorKey(stationId, chain.lineId);
      if (out.has(key)) continue;
      const st = network.stations[stationId];
      if (!st) continue;
      const xz = lineAnchorWorld(
        st,
        lineAnchor(network.anchors, stationId, chain.lineId),
        origin,
      );
      out.set(key, {
        x: xz.x,
        y: platformWorldY(stationId, chain.lineId),
        z: xz.z,
      });
    }
  }
  return out;
}

/**
 * Offset coincident anchors (no distinct platform) perpendicular to the
 * station's line bearing, before curve fitting.
 */
export function applyFanout(
  network: LineNetwork,
  anchors: Map<TubeAnchorKey, WorldAnchor>,
  spacingM: number = TUBE_FANOUT_M,
  coincidentM: number = TUBE_COINCIDENT_M,
): Map<TubeAnchorKey, WorldAnchor> {
  const out = new Map(anchors);
  const byStation = new Map<string, { lineId: string; key: TubeAnchorKey }[]>();
  for (const key of anchors.keys()) {
    const sep = key.indexOf("\0");
    const stationId = key.slice(0, sep);
    const lineId = key.slice(sep + 1);
    const list = byStation.get(stationId) ?? [];
    list.push({ lineId, key });
    byStation.set(stationId, list);
  }

  for (const [stationId, items] of byStation) {
    const leftover = [...items].sort((a, b) => a.lineId.localeCompare(b.lineId));
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
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => a.lineId.localeCompare(b.lineId));
      const n = cluster.length;
      const mid = (n - 1) / 2;
      const gap = Math.max(
        spacingM,
        ...cluster.map((c) => 2 * tubeRadiusM(c.lineId)),
      );
      for (let i = 0; i < n; i++) {
        const item = cluster[i]!;
        const angle = network.angles[stationId]?.[item.lineId] ?? 0;
        // Long axis is (sin θ, cos θ); perpendicular in XZ is (cos θ, −sin θ).
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

function curveThrough(
  points: WorldAnchor[],
  closed: boolean,
): CatmullRomCurve3 | null {
  if (points.length < 2) return null;
  const vecs = points.map((p) => new Vector3(p.x, p.y, p.z));
  return new CatmullRomCurve3(vecs, closed, "centripetal");
}

export function buildTubeMeshes(
  network: LineNetwork,
  origin: LatLon,
  focus: LatLon,
  quality: SceneQuality = "high",
  radiusM: number = NEIGHBOR_UNLOAD_RADIUS_M,
): TubeMesh[] {
  const radial = quality === "high" ? 12 : 8;
  const base = applyFanout(network, worldAnchors(network, origin));
  const geoms = new Map<string, BufferGeometry[]>();
  const lines = new Map<string, Vec3[]>();

  for (const chain of network.chains) {
    const runs = clipChainStations(chain.stationIds, network, focus, radiusM);
    for (const run of runs) {
      const pts: WorldAnchor[] = [];
      for (const id of run) {
        const p = base.get(tubeAnchorKey(id, chain.lineId));
        if (p) pts.push(p);
      }
      const closed =
        !!chain.closed &&
        run.length === chain.stationIds.length &&
        run.every((id, i) => id === chain.stationIds[i]);
      const curve = curveThrough(pts, closed);
      if (!curve) continue;
      const length = curve.getLength();
      const tubular = Math.max(1, Math.round(length / TUBE_SEGMENT_M));
      const geom = new TubeGeometry(
        curve,
        tubular,
        tubeRadiusM(chain.lineId),
        radial,
        closed,
      );
      const list = geoms.get(chain.lineId) ?? [];
      list.push(geom);
      geoms.set(chain.lineId, list);

      const spaced = curve.getSpacedPoints(Math.max(2, tubular));
      const centre = lines.get(chain.lineId) ?? [];
      for (let i = 0; i + 1 < spaced.length; i++) {
        const a = spaced[i]!;
        const b = spaced[i + 1]!;
        centre.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
      }
      lines.set(chain.lineId, centre);
    }
  }

  const meshes: TubeMesh[] = [];
  const lineIds = [...geoms.keys()].sort((a, b) => a.localeCompare(b));
  for (const lineId of lineIds) {
    const parts = geoms.get(lineId)!;
    const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
    if (parts.length > 1) {
      for (const g of parts) g.dispose();
    }
    if (!merged) continue;
    meshes.push({
      lineId,
      geometry: merged,
      faceColor: schematicFaceColor("platform", lineId),
      edgeColor: schematicEdgeColor("platform", lineId),
      centreline: lines.get(lineId) ?? [],
    });
  }
  return meshes;
}

export function disposeTubeMeshes(meshes: TubeMesh[]) {
  for (const m of meshes) m.geometry.dispose();
}
