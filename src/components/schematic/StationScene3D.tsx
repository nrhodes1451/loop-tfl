"use client";

import { useRouter } from "next/navigation";
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  DoubleSide,
  MOUSE,
  NoToneMapping,
  PerspectiveCamera,
  Spherical,
  SRGBColorSpace,
  TOUCH,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  SCENE_BACKGROUND,
  buildSceneGeometry,
  cameraFrame,
  hoverHighlight,
  makeHoverId,
  splitHoverId,
  type CameraFrame,
  type HoverHighlight,
  type SceneGeometry,
  type ScenePolyline,
  type SceneQuality,
  type SceneVolume,
  type StationTopology,
} from "@/lib/schematic/scene";
import {
  CITY_FAR_M,
  CITY_MAX_DISTANCE_M,
  HUBKGX_ORIGIN,
  NEIGHBOR_LOAD_RADIUS_M,
  NEIGHBOR_UNLOAD_RADIUS_M,
  STATION_LOD_DIST_STEP_M,
  STATION_LOD_MOVE_M,
  STATION_LOD_SAMPLE_MS,
  clampToAabb2,
  distanceM,
  mapPanBounds,
  placeSchematicAt,
  schematicWorldOffset,
  stationsShownAtDistance,
  worldToLatLon,
  type Aabb2,
  type LatLon,
  type SchematicPlacement,
} from "@/lib/schematic/geo";
import type {
  SchematicStation,
  SchematicStationRef,
} from "@/lib/schematic/types";
import type { LineNetwork } from "@/lib/schematic/lines";
import { PmtilesSurface } from "./PmtilesSurface";
import { TubeLayer } from "./TubeLayer";

export type SceneStation = {
  id: string;
  name: string;
  topology: StationTopology;
  lat: number;
  lon: number;
};

export type StationScene3DProps = {
  selectedId: string;
  stations: SceneStation[];
  index: SchematicStationRef[];
  origin?: LatLon;
  quality?: SceneQuality;
  resetRef?: RefObject<(() => void) | null>;
  showSurface?: boolean;
  showSchematic?: boolean;
  /** London PMTiles surface when the extract is present. */
  usePmtiles?: boolean;
  /** Archive version keying the immutable tile URLs. */
  tilesVersion?: string | null;
  /** Left-drag pans the ground instead of orbiting. */
  panMode?: boolean;
  showLines?: boolean;
  lineNetwork?: LineNetwork | null;
  /** Compass rose lives in page chrome; this ref is the rotating needle. */
  roseRef: RefObject<HTMLDivElement | null>;
  faceNorthRef?: RefObject<(() => void) | null>;
};

function detectQuality(): SceneQuality {
  if (typeof window === "undefined") return "low";
  return window.matchMedia("(max-width: 640px), (pointer: coarse)").matches
    ? "low"
    : "high";
}

function detectCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

function useQuality(override?: SceneQuality): SceneQuality {
  const [detected, setDetected] = useState<SceneQuality>(detectQuality);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px), (pointer: coarse)");
    const apply = () => setDetected(mq.matches ? "low" : "high");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return override ?? detected;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(detectCoarsePointer);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return coarse;
}

function noopRaycast() {}

function scaledOpacity(
  base: number,
  highlighted: boolean,
  dimmed: boolean,
): number {
  if (highlighted) return Math.min(0.42, base * 2.4);
  if (dimmed) return base * 0.28;
  return base;
}

function GlassFace({
  color,
  opacity,
  attach,
}: {
  color: string;
  opacity: number;
  attach: string;
}) {
  return (
    <meshBasicMaterial
      attach={attach}
      color={color}
      transparent
      opacity={opacity}
      depthWrite={false}
      side={DoubleSide}
      toneMapped
      fog={false}
    />
  );
}

function VolumeMesh({
  volume,
  highlighted,
  dimmed,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  volume: SceneVolume;
  highlighted: boolean;
  dimmed: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: () => void;
}) {
  const opacity = scaledOpacity(volume.opacity, highlighted, dimmed);
  const bottomOpacity = scaledOpacity(
    volume.bottomOpacity,
    highlighted,
    dimmed,
  );
  const faceOpacities =
    volume.kind === "cylinder"
      ? [opacity, opacity, bottomOpacity]
      : [opacity, opacity, opacity, bottomOpacity, opacity, opacity];

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    onHover(volume.id);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (stickyHover) return;
    onHover(null);
  };
  const onTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    onHover(volume.id);
    onPick?.();
  };

  return (
    <group>
      <mesh
        position={volume.position}
        rotation={[0, volume.rotationY ?? 0, 0]}
        renderOrder={1}
        {...(!volume.pickable ? { raycast: noopRaycast } : {})}
        onPointerOver={volume.pickable ? onOver : undefined}
        onPointerOut={volume.pickable ? onOut : undefined}
        onClick={volume.pickable ? onTap : undefined}
      >
        {volume.kind === "cylinder" ? (
          <cylinderGeometry
            args={[
              volume.size[0],
              volume.size[0],
              volume.size[1],
              volume.radialSegments,
            ]}
          />
        ) : (
          <boxGeometry args={volume.size} />
        )}
        {faceOpacities.map((faceOpacity, i) => (
          <GlassFace
            key={i}
            attach={`material-${i}`}
            color={volume.faceColor}
            opacity={faceOpacity}
          />
        ))}
      </mesh>
      {volume.type === "shaft" && volume.pickable ? (
        <mesh
          position={volume.position}
          onPointerOver={onOver}
          onPointerOut={onOut}
          onClick={onTap}
        >
          <cylinderGeometry
            args={[
              Math.max(volume.size[0] * 2.4, 0.28),
              Math.max(volume.size[0] * 2.4, 0.28),
              volume.size[1],
              8,
            ]}
          />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            fog={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function GlowLine({
  line,
  highlighted,
  dimmed,
}: {
  line: ScenePolyline;
  highlighted: boolean;
  dimmed: boolean;
}) {
  if (line.points.length < 2) return null;
  const opacity = highlighted
    ? 1
    : dimmed
      ? 0.22
      : line.role === "outline"
        ? 0.95
        : 0.8;
  return (
    <Line
      points={line.points}
      segments={line.segments}
      color={line.color}
      lineWidth={highlighted ? line.lineWidth * 1.35 : line.lineWidth}
      transparent
      opacity={opacity}
      toneMapped={false}
      frustumCulled={false}
      renderOrder={2}
      depthWrite={false}
      fog={false}
      raycast={noopRaycast}
    />
  );
}

function FrameCamera({
  frame,
  reframeKey,
}: {
  frame: CameraFrame;
  reframeKey: string;
}) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
    if (camera instanceof PerspectiveCamera) {
      /* Three.js cameras are mutable scene objects. */
      /* eslint-disable react-hooks/immutability */
      camera.near = 0.1;
      camera.far = frame.far;
      /* eslint-enable react-hooks/immutability */
    }
    camera.updateProjectionMatrix();
    /* Station / geo-mode changes only — overlay toggles rebuild `frame`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, reframeKey]);
  return null;
}

/** Look heading: 0 = north (+Z), clockwise east. */
function lookHeading(controls: OrbitControlsImpl): number {
  const dx = controls.object.position.x - controls.target.x;
  const dz = controls.object.position.z - controls.target.z;
  return Math.atan2(-dx, -dz);
}

type WasdKeys = { w: boolean; a: boolean; s: boolean; d: boolean };

function emptyWasd(): WasdKeys {
  return { w: false, a: false, s: false, d: false };
}

function isFormField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function applyWasdKey(keys: WasdKeys, code: string, down: boolean): boolean {
  switch (code) {
    case "KeyW":
      keys.w = down;
      return true;
    case "KeyA":
      keys.a = down;
      return true;
    case "KeyS":
      keys.s = down;
      return true;
    case "KeyD":
      keys.d = down;
      return true;
    default:
      return false;
  }
}

/** Ground-plane pan in look space. Speed scales with zoom (camera–target distance). */
function panByWasd(controls: OrbitControlsImpl, keys: WasdKeys, dt: number) {
  let right = 0;
  let forward = 0;
  if (keys.w) forward += 1;
  if (keys.s) forward -= 1;
  if (keys.a) right += 1;
  if (keys.d) right -= 1;
  const mag = Math.hypot(right, forward);
  if (mag === 0) return;

  const heading = lookHeading(controls);
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dist = controls.object.position.distanceTo(controls.target);
  const step = dist * 0.85 * Math.min(dt, 0.05);
  const nx = right / mag;
  const nz = forward / mag;
  const dx = (nx * cos + nz * sin) * step;
  const dz = (-nx * sin + nz * cos) * step;

  controls.target.x += dx;
  controls.target.z += dz;
  controls.object.position.x += dx;
  controls.object.position.z += dz;
}

/** Keep the look-at point inside the map; slide the camera with it. */
function clampOrbitPan(controls: OrbitControlsImpl, bounds: Aabb2) {
  const t = controls.target;
  const p = controls.object.position;
  const next = clampToAabb2(t.x, t.z, bounds);
  const dx = next.x - t.x;
  const dz = next.z - t.z;
  if (dx === 0 && dz === 0) return;
  t.x += dx;
  t.z += dz;
  p.x += dx;
  p.z += dz;
}

function faceNorth(controls: OrbitControlsImpl) {
  const cam = controls.object;
  const offset = cam.position.clone().sub(controls.target);
  const spherical = new Spherical().setFromVector3(offset);
  spherical.theta = Math.PI;
  cam.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  cam.lookAt(controls.target);
  const extra = controls as OrbitControlsImpl & {
    sphericalDelta?: { set: (r: number, phi: number, theta: number) => void };
  };
  extra.sphericalDelta?.set(0, 0, 0);
  controls.update();
}

function CompassTracker({
  controlsRef,
  roseRef,
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  roseRef: RefObject<HTMLDivElement | null>;
}) {
  useFrame(() => {
    const controls = controlsRef.current;
    const rose = roseRef.current;
    if (!controls || !rose) return;
    rose.style.transform = `rotate(${-lookHeading(controls)}rad)`;
  });
  return null;
}

export function CompassButton({
  roseRef,
  onFaceNorth,
}: {
  roseRef: RefObject<HTMLDivElement | null>;
  onFaceNorth: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFaceNorth}
      aria-label="Face north"
      title="Face north"
      className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border select-none"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        color: "#e8edf4",
        background: "rgba(12, 14, 18, 0.82)",
        borderColor: "#2a313c",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        ref={roseRef}
        className="flex h-10 w-10 items-center justify-center will-change-transform"
      >
        <svg viewBox="0 0 40 40" className="h-10 w-10" aria-hidden>
          <circle
            cx="20"
            cy="20"
            r="18"
            fill="none"
            stroke="#2a313c"
            strokeWidth="1"
          />
          <polygon points="20,11 23,19 17,19" fill="#e8edf4" />
          <polygon points="20,29 17,21 23,21" fill="#3a4250" />
          <text
            x="20"
            y="10"
            textAnchor="middle"
            fill="#ffe7a8"
            fontSize="8"
            fontWeight="700"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            N
          </text>
        </svg>
      </div>
    </button>
  );
}

function SceneControls({
  frame,
  reframeKey,
  controlsRef,
  panMode,
  panAltitude,
  panBounds,
  onDragStart,
  onDragEnd,
}: {
  frame: CameraFrame;
  reframeKey: string;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  panMode: boolean;
  panAltitude: RefObject<{ cam: number; target: number } | null>;
  panBounds: Aabb2 | null;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const wasd = useRef(emptyWasd());

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...frame.target);
    controls.minDistance = frame.minDistance;
    controls.maxDistance = frame.maxDistance;
    controls.saveState();
    /* Station / geo-mode changes only — overlay toggles rebuild `frame`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlsRef, reframeKey]);

  useLayoutEffect(() => {
    if (!panMode) {
      panAltitude.current = null;
      return;
    }
    panAltitude.current = {
      cam: camera.position.y,
      target: controlsRef.current?.target.y ?? frame.target[1],
    };
    /* Capture height when pan mode turns on, not when overlay toggles rebuild `frame`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panMode, camera, controlsRef, panAltitude]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormField(e.target)) return;
      if (applyWasdKey(wasd.current, e.code, true)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      applyWasdKey(wasd.current, e.code, false);
    };
    const clear = () => {
      const keys = wasd.current;
      keys.w = false;
      keys.a = false;
      keys.s = false;
      keys.d = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);

  useFrame((_, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    panByWasd(controls, wasd.current, dt);
    if (panBounds) clampOrbitPan(controls, panBounds);
    const lock = panAltitude.current;
    if (!lock) return;
    /* Orbit dolly/pan must not change world height in map pan mode. */
    /* eslint-disable react-hooks/immutability */
    camera.position.y = lock.cam;
    controls.target.y = lock.target;
    /* eslint-enable react-hooks/immutability */
  }, -1);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enableRotate={!panMode}
      screenSpacePanning={false}
      mouseButtons={{
        LEFT: panMode ? MOUSE.PAN : MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      }}
      touches={{
        ONE: panMode ? TOUCH.PAN : TOUCH.ROTATE,
        TWO: TOUCH.DOLLY_PAN,
      }}
      minPolarAngle={panMode ? 0.08 : frame.minPolarAngle}
      maxPolarAngle={panMode ? 1.52 : frame.maxPolarAngle}
      minDistance={frame.minDistance}
      maxDistance={frame.maxDistance}
      onChange={() => {
        const controls = controlsRef.current;
        if (controls && panBounds) clampOrbitPan(controls, panBounds);
      }}
      onStart={onDragStart}
      onEnd={onDragEnd}
    />
  );
}

function StationMeshes({
  stationId,
  geom,
  highlight,
  active,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  stationId: string;
  geom: SceneGeometry;
  highlight: HoverHighlight;
  active: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: (stationId: string) => void;
}) {
  const hoverVolume = (volumeId: string | null) => {
    onHover(volumeId ? makeHoverId(stationId, volumeId) : null);
  };
  return (
    <group>
      {geom.volumes.map((volume) => (
        <VolumeMesh
          key={volume.id}
          volume={volume}
          highlighted={highlight.volumeIds.has(volume.id)}
          dimmed={active && !highlight.volumeIds.has(volume.id)}
          draggingRef={draggingRef}
          stickyHover={stickyHover}
          onHover={hoverVolume}
          onPick={onPick ? () => onPick(stationId) : undefined}
        />
      ))}
      {geom.polylines.map((line) => (
        <GlowLine
          key={line.id}
          line={line}
          highlighted={highlight.polylineIds.has(line.id)}
          dimmed={active && !highlight.polylineIds.has(line.id)}
        />
      ))}
    </group>
  );
}

function tooltipPos(
  cursor: { x: number; y: number },
  wrap: { width: number; height: number },
): { left: number; top: number } {
  const pad = 10;
  const tw = 248;
  const th = 64;
  let left = cursor.x + 14;
  let top = cursor.y + 14;
  if (left + tw > wrap.width - pad) left = cursor.x - tw - 8;
  if (top + th > wrap.height - pad) top = cursor.y - th - 8;
  return {
    left: Math.max(pad, left),
    top: Math.max(pad, top),
  };
}

type CameraLod = LatLon & { distM: number };

type BuiltRow = {
  station: SceneStation;
  geom: SceneGeometry;
  placement: SchematicPlacement | null;
};

function CameraLodSampler({
  origin,
  controlsRef,
  onLod,
}: {
  origin: LatLon;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  onLod: (lod: CameraLod) => void;
}) {
  const camera = useThree((s) => s.camera);
  const last = useRef(0);
  const sent = useRef<CameraLod | null>(null);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < STATION_LOD_SAMPLE_MS) return;
    const target = controlsRef.current?.target;
    if (!target) return;
    last.current = now;
    const ll = worldToLatLon(target.x, target.z, origin);
    const distM = camera.position.distanceTo(target);
    const prev = sent.current;
    if (
      prev &&
      distanceM(prev, ll) < STATION_LOD_MOVE_M &&
      Math.abs(prev.distM - distM) < STATION_LOD_DIST_STEP_M
    ) {
      return;
    }
    const next = { lat: ll.lat, lon: ll.lon, distM };
    sent.current = next;
    onLod(next);
  });
  return null;
}

function useNearbyStations(
  index: SchematicStationRef[],
  initial: SceneStation[],
  lod: CameraLod,
  extra: Record<string, SceneStation>,
  setExtra: Dispatch<SetStateAction<Record<string, SceneStation>>>,
  enabled: boolean,
  shown: boolean,
): string[] {
  const inflight = useRef(new Set<string>());

  const initialById = useMemo(() => {
    const m = new Map<string, SceneStation>();
    for (const s of initial) m.set(s.id, s);
    return m;
  }, [initial]);

  const focusLat = lod.lat;
  const focusLon = lod.lon;

  useEffect(() => {
    if (!enabled) return;
    const origin = { lat: focusLat, lon: focusLon };
    setExtra((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, s] of Object.entries(next)) {
        if (distanceM(s, origin) > NEIGHBOR_UNLOAD_RADIUS_M) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [enabled, focusLat, focusLon, setExtra]);

  useEffect(() => {
    if (!enabled || !shown) return;
    const origin = { lat: focusLat, lon: focusLon };
    const needed = index.filter(
      (s) => distanceM(s, origin) <= NEIGHBOR_LOAD_RADIUS_M,
    );
    for (const ref of needed) {
      if (
        initialById.has(ref.id) ||
        extra[ref.id] ||
        inflight.current.has(ref.id)
      ) {
        continue;
      }
      inflight.current.add(ref.id);
      fetch(`/api/schematic/${encodeURIComponent(ref.id)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json: SchematicStation | null) => {
          if (!json) return;
          const station: SceneStation = {
            id: json.stationId,
            name: json.name,
            topology: { nodes: json.nodes, edges: json.edges },
            lat: ref.lat,
            lon: ref.lon,
          };
          setExtra((prev) =>
            prev[station.id] ? prev : { ...prev, [station.id]: station },
          );
        })
        .catch(() => {})
        .finally(() => {
          inflight.current.delete(ref.id);
        });
    }
  }, [enabled, extra, focusLat, focusLon, index, initialById, setExtra, shown]);

  return useMemo(() => {
    if (!enabled || !shown) return [];
    const origin = { lat: focusLat, lon: focusLon };
    const loaded = [...initialById.values()];
    for (const s of Object.values(extra)) {
      if (!initialById.has(s.id)) loaded.push(s);
    }
    return loaded
      .filter((s) => distanceM(s, origin) <= NEIGHBOR_UNLOAD_RADIUS_M)
      .map((s) => s.id)
      .sort();
  }, [enabled, extra, focusLat, focusLon, initialById, shown]);
}

function platformAnglesKey(angles?: Record<string, number>): string {
  if (!angles) return "";
  return Object.keys(angles)
    .sort()
    .map((k) => `${k}:${angles[k]!.toFixed(5)}`)
    .join(",");
}

export function StationScene3D({
  selectedId,
  stations,
  index,
  origin = HUBKGX_ORIGIN,
  quality: qualityProp,
  resetRef,
  showSurface = true,
  showSchematic = true,
  usePmtiles = false,
  tilesVersion = null,
  panMode = false,
  showLines = false,
  lineNetwork = null,
  roseRef,
  faceNorthRef,
}: StationScene3DProps) {
  const quality = useQuality(qualityProp);
  const stickyHover = useCoarsePointer();
  const router = useRouter();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [extra, setExtra] = useState<Record<string, SceneStation>>({});
  const [lod, setLod] = useState<CameraLod>(() => {
    const s = stations.find((row) => row.id === selectedId) ?? stations[0];
    return {
      lat: s?.lat ?? origin.lat,
      lon: s?.lon ?? origin.lon,
      distM: 0,
    };
  });
  const [lodForId, setLodForId] = useState(selectedId);
  const [shown, setShown] = useState(true);
  const geomCacheRef = useRef(new Map<string, BuiltRow>());
  const panAltitude = useRef<{ cam: number; target: number } | null>(null);
  const selectedSeed = stations.find((s) => s.id === selectedId) ?? stations[0];
  const selectedLat = selectedSeed?.lat;
  const selectedLon = selectedSeed?.lon;
  if (lodForId !== selectedId) {
    setLodForId(selectedId);
    setLod({
      lat: selectedLat ?? origin.lat,
      lon: selectedLon ?? origin.lon,
      distM: 0,
    });
    setShown(true);
    setHoveredId(null);
  }
  const nextShown = stationsShownAtDistance(lod.distM, shown);
  if (nextShown !== shown) setShown(nextShown);

  useLayoutEffect(() => {
    if (!resetRef) return;
    resetRef.current = () => {
      const controls = controlsRef.current;
      if (!controls) return;
      controls.reset();
      if (panAltitude.current) {
        panAltitude.current = {
          cam: controls.object.position.y,
          target: controls.target.y,
        };
      }
    };
    return () => {
      resetRef.current = null;
    };
  }, [resetRef]);

  useLayoutEffect(() => {
    if (!faceNorthRef) return;
    faceNorthRef.current = () => {
      const controls = controlsRef.current;
      if (controls) faceNorth(controls);
    };
    return () => {
      faceNorthRef.current = null;
    };
  }, [faceNorthRef]);

  const geoScene = usePmtiles;
  const loadedById = useMemo(() => {
    const m = new Map<string, SceneStation>();
    for (const s of stations) m.set(s.id, s);
    for (const s of Object.values(extra)) {
      if (!m.has(s.id)) m.set(s.id, s);
    }
    return m;
  }, [stations, extra]);
  const visibleIds = useNearbyStations(
    index,
    stations,
    lod,
    extra,
    setExtra,
    geoScene,
    geoScene && shown,
  );
  const visibleKey = visibleIds.join("\0");
  const selectedRow = useMemo(() => {
    const s = stations.find((row) => row.id === selectedId) ?? stations[0];
    if (!s) return null;
    const geom = buildSceneGeometry(s.topology, {
      quality,
      stationId: s.id,
      platformAngles: lineNetwork?.angles[s.id],
    });
    const world = schematicWorldOffset(s.id, s.lat, s.lon, origin);
    return {
      station: s,
      geom,
      placement: geoScene ? placeSchematicAt(geom, world) : null,
    };
  }, [stations, selectedId, quality, geoScene, origin, lineNetwork]);
  const built = useMemo(() => {
    const cache = geomCacheRef.current;
    const ids = visibleKey ? visibleKey.split("\0") : [];
    const keyOf = (id: string) =>
      `${quality}\0${id}\0${platformAnglesKey(lineNetwork?.angles[id])}`;
    const keep = new Set(ids.map(keyOf));
    for (const key of [...cache.keys()]) {
      if (!keep.has(key)) cache.delete(key);
    }
    const rows: BuiltRow[] = [];
    for (const id of ids) {
      const key = keyOf(id);
      let row = cache.get(key);
      if (!row) {
        const s = loadedById.get(id);
        if (!s) continue;
        const geom = buildSceneGeometry(s.topology, {
          quality,
          stationId: s.id,
          platformAngles: lineNetwork?.angles[id],
        });
        const world = schematicWorldOffset(s.id, s.lat, s.lon, origin);
        row = {
          station: s,
          geom,
          placement: geoScene ? placeSchematicAt(geom, world) : null,
        };
        cache.set(key, row);
      }
      rows.push(row);
    }
    return rows;
  }, [visibleKey, loadedById, quality, geoScene, origin, lineNetwork]);
  const frame = useMemo(() => {
    if (!selectedRow) {
      return cameraFrame({
        min: [-1, -1, -1],
        max: [1, 1, 1],
        center: [0, 0, 0],
        radius: 8,
      });
    }
    if (!geoScene || !selectedRow.placement) {
      return cameraFrame(selectedRow.geom.bounds);
    }
    const placement = selectedRow.placement;
    const minDistance = Math.max(4, placement.bounds.radius * 0.7);
    return cameraFrame(placement.bounds, {
      minDistance,
      maxDistance: CITY_MAX_DISTANCE_M,
      far: CITY_FAR_M,
    });
  }, [geoScene, selectedRow]);
  const panBounds = useMemo(
    () => (geoScene ? mapPanBounds(origin) : null),
    [geoScene, origin],
  );
  const reframeKey = `${selectedId}:${geoScene ? "geo" : "local"}`;
  const canvasCamera = useMemo(
    () => ({
      position: frame.position,
      fov: 42,
      near: 0.1,
      far: frame.far,
    }),
    // Overlay toggles rebuild `frame` with a new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reframeKey],
  );

  const hovered = useMemo(() => {
    if (!hoveredId || !showSchematic) return undefined;
    const { stationId, volumeId } = splitHoverId(hoveredId);
    const row = built.find((b) => b.station.id === stationId);
    if (!row) return undefined;
    const volume = row.geom.volumes.find((v) => v.id === volumeId);
    if (!volume) return undefined;
    return { station: row.station, volume };
  }, [built, hoveredId, showSchematic]);

  const onWrapPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPointer({
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      w: r.width,
      h: r.height,
    });
  };

  const tip =
    hovered && pointer && !isDragging
      ? tooltipPos(pointer, { width: pointer.w, height: pointer.h })
      : null;

  const onPickStation = (id: string) => {
    if (id === selectedId) return;
    router.push(`/schematic/${encodeURIComponent(id)}`);
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none"
      style={{
        background: SCENE_BACKGROUND,
        cursor: isDragging ? "grabbing" : hovered ? "pointer" : "grab",
      }}
      aria-label="Schematic 3D station view. WASD to pan. Not to scale, not for wayfinding."
      onPointerMove={onWrapPointerMove}
      onPointerLeave={() => {
        if (stickyHover) return;
        setHoveredId(null);
        setPointer(null);
      }}
    >
      <Canvas
        dpr={quality === "low" ? [1, 1.25] : [1, 1.5]}
        gl={{
          // MSAA is framebuffer-wide: schematic 1px lines need it; the map
          // rides along at no extra cost. Bloom/composer MSAA is off.
          antialias: true,
          toneMapping: NoToneMapping,
          outputColorSpace: SRGBColorSpace,
        }}
        camera={canvasCamera}
        onPointerMissed={() => setHoveredId(null)}
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <FrameCamera frame={frame} reframeKey={reframeKey} />
        {geoScene ? (
          <>
            {showSurface && tilesVersion ? (
              <PmtilesSurface origin={origin} tilesVersion={tilesVersion} />
            ) : null}
            {showLines && lineNetwork ? (
              <TubeLayer
                network={lineNetwork}
                origin={origin}
                focus={{ lat: lod.lat, lon: lod.lon }}
                shown={shown}
                quality={quality}
              />
            ) : null}
            {showSchematic
              ? built.map((row) => {
                  if (!row.placement) return null;
                  const parsed = hoveredId ? splitHoverId(hoveredId) : null;
                  const thisHover = parsed?.stationId === row.station.id;
                  const highlight = hoverHighlight(
                    thisHover && parsed ? parsed.volumeId : null,
                    row.geom,
                  );
                  return (
                    <group
                      key={row.station.id}
                      position={row.placement.position}
                      scale={row.placement.scale}
                    >
                      <StationMeshes
                        stationId={row.station.id}
                        geom={row.geom}
                        highlight={highlight}
                        active={thisHover}
                        draggingRef={draggingRef}
                        stickyHover={stickyHover}
                        onHover={setHoveredId}
                        onPick={onPickStation}
                      />
                    </group>
                  );
                })
              : null}
            <CameraLodSampler
              key={selectedId}
              origin={origin}
              controlsRef={controlsRef}
              onLod={setLod}
            />
          </>
        ) : showSchematic && selectedRow ? (
          <StationMeshes
            stationId={selectedRow.station.id}
            geom={selectedRow.geom}
            highlight={hoverHighlight(
              hoveredId ? splitHoverId(hoveredId).volumeId : null,
              selectedRow.geom,
            )}
            active={hoveredId !== null}
            draggingRef={draggingRef}
            stickyHover={stickyHover}
            onHover={setHoveredId}
          />
        ) : null}
        <CompassTracker controlsRef={controlsRef} roseRef={roseRef} />
        <SceneControls
          frame={frame}
          reframeKey={reframeKey}
          controlsRef={controlsRef}
          panMode={panMode}
          panAltitude={panAltitude}
          panBounds={panBounds}
          onDragStart={() => {
            draggingRef.current = true;
            setIsDragging(true);
            setHoveredId(null);
          }}
          onDragEnd={() => {
            draggingRef.current = false;
            setIsDragging(false);
          }}
        />
      </Canvas>
      {hovered && tip ? (
        <div
          className="pointer-events-none absolute z-20 max-w-[248px] rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{
            left: tip.left,
            top: tip.top,
            color: "#e8edf4",
            background: "rgba(8, 10, 14, 0.92)",
            borderColor: "#2a313c",
          }}
        >
          <div className="font-medium">
            {hovered.station.id === selectedId
              ? hovered.volume.label
              : `${hovered.station.name} · ${hovered.volume.label}`}
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-[10.5px]"
            style={{ color: "#8b93a0" }}
          >
            {hovered.volume.type}
            {" · "}
            level {hovered.volume.level}
            {hovered.volume.liftId ? ` · ${hovered.volume.liftId}` : ""}
            {hovered.volume.lineId ? ` · ${hovered.volume.lineId}` : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
