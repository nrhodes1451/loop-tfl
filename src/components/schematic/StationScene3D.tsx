"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
  unionBounds,
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
  SURFACE_SIZE_M,
  placeSchematic,
  surfaceWorldBounds,
} from "@/lib/schematic/geo";
import type { OsmSurface } from "@/lib/schematic/osm";
import { PmtilesSurface } from "./PmtilesSurface";
import { SurfaceLayer } from "./SurfaceLayer";

export type StationScene3DProps = {
  topology: StationTopology;
  quality?: SceneQuality;
  resetRef?: RefObject<(() => void) | null>;
  surface?: OsmSurface | null;
  showSurface?: boolean;
  showSchematic?: boolean;
  /** Prefer London PMTiles over the 400 m bake. */
  usePmtiles?: boolean;
  /** Left-drag pans the ground instead of orbiting. */
  panMode?: boolean;
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
}: {
  volume: SceneVolume;
  highlighted: boolean;
  dimmed: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
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
  };

  return (
    <group>
      <mesh
        position={volume.position}
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

function FrameCamera({ frame }: { frame: CameraFrame }) {
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
  }, [camera, frame]);
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

function CompassButton({
  roseRef,
  onFaceNorth,
  raised = false,
}: {
  roseRef: RefObject<HTMLDivElement | null>;
  onFaceNorth: () => void;
  raised?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onFaceNorth}
      aria-label="Face north"
      title="Face north"
      className={
        raised
          ? "absolute z-20 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border select-none right-3 bottom-[max(176px,calc(env(safe-area-inset-bottom)+172px))] sm:right-6 sm:bottom-[184px]"
          : "absolute z-20 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border select-none right-3 bottom-[max(56px,calc(env(safe-area-inset-bottom)+52px))] sm:right-6 sm:bottom-[72px]"
      }
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
  controlsRef,
  panMode,
  panAltitude,
  onDragStart,
  onDragEnd,
}: {
  frame: CameraFrame;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  panMode: boolean;
  panAltitude: RefObject<{ cam: number; target: number } | null>;
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
  }, [controlsRef, frame]);

  useLayoutEffect(() => {
    if (!panMode) {
      panAltitude.current = null;
      return;
    }
    panAltitude.current = {
      cam: camera.position.y,
      target: controlsRef.current?.target.y ?? frame.target[1],
    };
  }, [panMode, camera, controlsRef, frame.target, panAltitude]);

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
    const lock = panAltitude.current;
    if (!lock) return;
    /* Orbit dolly/pan must not change world height in map pan mode. */
    /* eslint-disable react-hooks/immutability */
    camera.position.y = lock.cam;
    controls.target.y = lock.target;
    /* eslint-enable react-hooks/immutability */
  });

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
      target={frame.target}
      minPolarAngle={panMode ? 0.08 : frame.minPolarAngle}
      maxPolarAngle={panMode ? 1.52 : frame.maxPolarAngle}
      minDistance={frame.minDistance}
      maxDistance={frame.maxDistance}
      onStart={onDragStart}
      onEnd={onDragEnd}
    />
  );
}

function StationMeshes({
  geom,
  highlight,
  active,
  draggingRef,
  stickyHover,
  onHover,
}: {
  geom: SceneGeometry;
  highlight: HoverHighlight;
  active: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
}) {
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
          onHover={onHover}
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

export function StationScene3D({
  topology,
  quality: qualityProp,
  resetRef,
  surface = null,
  showSurface = true,
  showSchematic = true,
  usePmtiles = false,
  panMode = false,
}: StationScene3DProps) {
  const quality = useQuality(qualityProp);
  const stickyHover = useCoarsePointer();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const roseRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const panAltitude = useRef<{ cam: number; target: number } | null>(null);

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

  const geom = useMemo(
    () => buildSceneGeometry(topology, { quality }),
    [topology.nodes, topology.edges, quality],
  );
  const geoScene = !!(surface || usePmtiles);
  const placement = useMemo(
    () => (geoScene ? placeSchematic(geom) : null),
    [geoScene, geom],
  );
  const frame = useMemo(() => {
    if (!geoScene || !placement) return cameraFrame(geom.bounds);
    const minDistance = Math.max(4, placement.bounds.radius * 0.7);
    if (usePmtiles) {
      return cameraFrame(placement.bounds, {
        minDistance,
        maxDistance: CITY_MAX_DISTANCE_M,
        far: CITY_FAR_M,
      });
    }
    const maxH = surface
      ? surface.buildings.reduce((m, b) => Math.max(m, b.height), 10)
      : 10;
    return cameraFrame(
      unionBounds(
        placement.bounds,
        surfaceWorldBounds(surface?.sizeM ?? SURFACE_SIZE_M, maxH, placement.bounds),
      ),
      { minDistance },
    );
  }, [geom.bounds, geoScene, surface, placement, usePmtiles]);
  const highlight = useMemo(
    () => hoverHighlight(hoveredId, geom),
    [hoveredId, geom],
  );
  const hovered = hoveredId && showSchematic
    ? geom.volumes.find((v) => v.id === hoveredId)
    : undefined;

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
        camera={{
          position: frame.position,
          fov: 42,
          near: 0.1,
          far: frame.far,
        }}
        onPointerMissed={() => setHoveredId(null)}
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <FrameCamera frame={frame} />
        {geoScene && placement ? (
          <>
            {showSurface ? (
              usePmtiles ? (
                <PmtilesSurface origin={HUBKGX_ORIGIN} />
              ) : surface ? (
                <SurfaceLayer surface={surface} />
              ) : null
            ) : null}
            {showSchematic ? (
              <group position={placement.position} scale={placement.scale}>
                <StationMeshes
                  geom={geom}
                  highlight={highlight}
                  active={hoveredId !== null}
                  draggingRef={draggingRef}
                  stickyHover={stickyHover}
                  onHover={setHoveredId}
                />
              </group>
            ) : null}
          </>
        ) : showSchematic ? (
          <StationMeshes
            geom={geom}
            highlight={highlight}
            active={hoveredId !== null}
            draggingRef={draggingRef}
            stickyHover={stickyHover}
            onHover={setHoveredId}
          />
        ) : null}
        <CompassTracker controlsRef={controlsRef} roseRef={roseRef} />
        <SceneControls
          frame={frame}
          controlsRef={controlsRef}
          panMode={panMode}
          panAltitude={panAltitude}
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
      <CompassButton
        roseRef={roseRef}
        raised={geoScene}
        onFaceNorth={() => {
          const controls = controlsRef.current;
          if (controls) faceNorth(controls);
        }}
      />
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
          <div className="font-medium">{hovered.label}</div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-[10.5px]"
            style={{ color: "#8b93a0" }}
          >
            {hovered.type}
            {" · "}
            level {hovered.level}
            {hovered.liftId ? ` · ${hovered.liftId}` : ""}
            {hovered.lineId ? ` · ${hovered.lineId}` : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
