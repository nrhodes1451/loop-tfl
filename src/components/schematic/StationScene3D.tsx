"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
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
  ACESFilmicToneMapping,
  Color,
  DoubleSide,
  NoToneMapping,
  SRGBColorSpace,
} from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  SCENE_BACKGROUND,
  buildSceneGeometry,
  cameraFrame,
  hoverHighlight,
  type CameraFrame,
  type HoverHighlight,
  type SceneGeometry,
  type ScenePolyline,
  type SceneQuality,
  type SceneVolume,
  type StationTopology,
} from "@/lib/schematic/scene";

export type StationScene3DProps = {
  topology: StationTopology;
  quality?: SceneQuality;
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
  );
}

function boostedColor(hex: string, gain: number): Color {
  const color = new Color(hex);
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
  const gain = highlighted ? baseGain * 1.45 : baseGain;
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
      color={boostedColor(line.color, gain)}
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

function HighQualityEffects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
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

export function StationScene3D({ topology, quality: qualityProp }: StationScene3DProps) {
  const quality = useQuality(qualityProp);
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

  const geom = useMemo(
    () => buildSceneGeometry(topology, { quality }),
    [topology, quality],
  );
  const frame = useMemo(() => cameraFrame(geom.bounds), [geom.bounds]);
  const highlight = useMemo(
    () => hoverHighlight(hoveredId, geom),
    [hoveredId, geom],
  );
  const hovered = hoveredId
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
        dpr={quality === "low" ? 1 : [1, 1.5]}
        gl={{
          antialias: quality === "high",
          toneMapping:
            quality === "high" ? NoToneMapping : ACESFilmicToneMapping,
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
        <StationMeshes
          geom={geom}
          highlight={highlight}
          active={hoveredId !== null}
          draggingRef={draggingRef}
          onHover={setHoveredId}
        />
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
        {quality === "high" ? <HighQualityEffects /> : null}
      </Canvas>
      <button
        type="button"
        onClick={() => controlsRef.current?.reset()}
        className="absolute top-3 right-3 z-10 cursor-pointer rounded-[7px] border px-[13px] py-2 text-[12.5px] font-medium"
        style={{
          color: "#d5dbe6",
          background: "rgba(12, 14, 18, 0.82)",
          borderColor: "#2a313c",
        }}
      >
        Reset view
      </button>
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
