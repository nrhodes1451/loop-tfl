"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
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
  Color,
  DoubleSide,
  NoToneMapping,
  Spherical,
  SRGBColorSpace,
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
import { placeSchematic, surfaceWorldBounds } from "@/lib/schematic/geo";
import type { OsmSurface } from "@/lib/schematic/osm";
import { SurfaceLayer } from "./SurfaceLayer";

export type StationScene3DProps = {
  topology: StationTopology;
  quality?: SceneQuality;
  resetRef?: RefObject<(() => void) | null>;
  surface?: OsmSurface | null;
  showSurface?: boolean;
  showSchematic?: boolean;
};

function detectQuality(): SceneQuality {
  if (typeof window === "undefined") return "low";
  return window.matchMedia("(max-width: 640px), (pointer: coarse)").matches
    ? "low"
    : "high";
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
    />
  );
}

function VolumeMesh({
  volume,
  highlighted,
  dimmed,
  draggingRef,
  onHover,
}: {
  volume: SceneVolume;
  highlighted: boolean;
  dimmed: boolean;
  draggingRef: RefObject<boolean>;
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
    onHover(null);
  };

  return (
    <group>
      <mesh
        position={volume.position}
        renderOrder={1}
        {...(!volume.pickable ? { raycast: noopRaycast } : {})}
        onPointerOver={volume.pickable ? onOver : undefined}
        onPointerOut={volume.pickable ? onOut : undefined}
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
        >
          <cylinderGeometry
            args={[
              Math.max(volume.size[0] * 2.4, 0.28),
              Math.max(volume.size[0] * 2.4, 0.28),
              volume.size[1],
              8,
            ]}
          />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

/** Rec.709 luma — matches the bloom luminance pass better than sRGB average. */
function rec709Lum(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Mid TfL colours sit around here; brighter lines are pulled down to match. */
const BLOOM_TARGET_LUM = 0.58;
/** Shafts stack several bright strokes; extra pullback after luma compensation. */
const SHAFT_BLOOM_SCALE = 0.82;

function isShaftLine(line: ScenePolyline): boolean {
  return line.mode === "shaft" || line.id.startsWith("wire::shaft::");
}

function bloomLineColor(hex: string, roleGain: number, extra: number): Color {
  const color = new Color(hex);
  const lum = Math.max(rec709Lum(color), 0.22);
  const gain = roleGain * extra * Math.min(1, BLOOM_TARGET_LUM / lum);
  color.multiplyScalar(gain);
  return color;
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
  const baseGain = line.role === "outline" ? 1.85 : 1.4;
  const roleGain = highlighted ? baseGain * 1.45 : baseGain;
  const extra = isShaftLine(line) ? SHAFT_BLOOM_SCALE : 1;
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
      color={bloomLineColor(line.color, roleGain, extra)}
      lineWidth={highlighted ? line.lineWidth * 1.35 : line.lineWidth}
      transparent
      opacity={opacity}
      toneMapped={false}
      frustumCulled={false}
      renderOrder={2}
      depthWrite={false}
      raycast={noopRaycast}
    />
  );
}

function FrameCamera({ frame }: { frame: CameraFrame }) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
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
          ? "absolute z-20 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border select-none right-3 bottom-[max(140px,calc(env(safe-area-inset-bottom)+136px))] sm:right-6 sm:bottom-[148px]"
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
  onDragStart,
  onDragEnd,
}: {
  frame: CameraFrame;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(...frame.target);
    controls.minDistance = frame.minDistance;
    controls.maxDistance = frame.maxDistance;
    controls.saveState();
  }, [controlsRef, frame]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      target={frame.target}
      minPolarAngle={frame.minPolarAngle}
      maxPolarAngle={frame.maxPolarAngle}
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
  onHover,
}: {
  geom: SceneGeometry;
  highlight: HoverHighlight;
  active: boolean;
  draggingRef: RefObject<boolean>;
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

function SceneEffects({ samples }: { samples: number }) {
  return (
    <EffectComposer multisampling={samples} enableNormalPass={false}>
      <Bloom
        luminanceThreshold={0.84}
        luminanceSmoothing={0.18}
        intensity={1.05}
        mipmapBlur
        radius={0.72}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.58} />
    </EffectComposer>
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
}: StationScene3DProps) {
  const quality = useQuality(qualityProp);
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

  useLayoutEffect(() => {
    if (!resetRef) return;
    resetRef.current = () => controlsRef.current?.reset();
    return () => {
      resetRef.current = null;
    };
  }, [resetRef]);

  const geom = useMemo(
    () => buildSceneGeometry(topology, { quality }),
    [topology, quality],
  );
  const placement = useMemo(
    () => (surface ? placeSchematic(geom) : null),
    [surface, geom],
  );
  const frame = useMemo(() => {
    if (!surface || !placement) return cameraFrame(geom.bounds);
    const maxH = surface.buildings.reduce((m, b) => Math.max(m, b.height), 10);
    return cameraFrame(
      unionBounds(
        placement.bounds,
        surfaceWorldBounds(surface.sizeM, maxH, placement.bounds),
      ),
      { minDistance: Math.max(4, placement.bounds.radius * 0.7) },
    );
  }, [geom.bounds, surface, placement]);
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
      aria-label="Schematic 3D station view. Not to scale, not for wayfinding."
      onPointerMove={onWrapPointerMove}
      onPointerLeave={() => {
        setHoveredId(null);
        setPointer(null);
      }}
    >
      <Canvas
        dpr={quality === "low" ? [1, 1.25] : [1, 1.5]}
        gl={{
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
        {surface && placement ? (
          <>
            {showSurface ? <SurfaceLayer surface={surface} /> : null}
            {showSchematic ? (
              <group position={placement.position} scale={placement.scale}>
                <StationMeshes
                  geom={geom}
                  highlight={highlight}
                  active={hoveredId !== null}
                  draggingRef={draggingRef}
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
            onHover={setHoveredId}
          />
        ) : null}
        <CompassTracker controlsRef={controlsRef} roseRef={roseRef} />
        <SceneControls
          frame={frame}
          controlsRef={controlsRef}
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
        <SceneEffects samples={quality === "high" ? 4 : 2} />
      </Canvas>
      <CompassButton
        roseRef={roseRef}
        raised={!!surface}
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
