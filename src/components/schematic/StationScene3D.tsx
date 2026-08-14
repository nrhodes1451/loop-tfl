"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ACESFilmicToneMapping, Color, NoToneMapping, SRGBColorSpace } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  SCENE_BACKGROUND,
  buildSceneGeometry,
  cameraFrame,
  type CameraFrame,
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

function VolumeMesh({ volume }: { volume: SceneVolume }) {
  return (
    <mesh position={volume.position} renderOrder={1}>
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
      <meshBasicMaterial
        color={volume.faceColor}
        transparent
        opacity={volume.opacity}
        depthWrite={false}
        toneMapped
      />
    </mesh>
  );
}

function boostedColor(hex: string, gain: number): Color {
  const color = new Color(hex);
  color.multiplyScalar(gain);
  return color;
}

function GlowLine({ line }: { line: ScenePolyline }) {
  if (line.points.length < 2) return null;
  const gain = line.role === "outline" ? 1.85 : 1.4;
  return (
    <Line
      points={line.points}
      segments={line.segments}
      color={boostedColor(line.color, gain)}
      lineWidth={line.lineWidth}
      transparent
      opacity={line.role === "outline" ? 0.95 : 0.8}
      toneMapped={false}
      frustumCulled={false}
      renderOrder={2}
      depthWrite={false}
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
}: {
  frame: CameraFrame;
  controlsRef: RefObject<OrbitControlsImpl | null>;
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
    />
  );
}

function StationMeshes({ geom }: { geom: SceneGeometry }) {
  return (
    <group>
      {geom.volumes.map((volume) => (
        <VolumeMesh key={volume.id} volume={volume} />
      ))}
      {geom.polylines.map((line) => (
        <GlowLine key={line.id} line={line} />
      ))}
    </group>
  );
}

function HighQualityEffects() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
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

export function StationScene3D({ topology, quality: qualityProp }: StationScene3DProps) {
  const quality = useQuality(qualityProp);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const geom = useMemo(
    () => buildSceneGeometry(topology, { quality }),
    [topology, quality],
  );
  const frame = useMemo(() => cameraFrame(geom.bounds), [geom.bounds]);

  return (
    <div
      className="relative h-full w-full touch-none"
      style={{ background: SCENE_BACKGROUND }}
      aria-label="Schematic 3D station view. Not to scale, not for wayfinding."
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
      >
        <color attach="background" args={[SCENE_BACKGROUND]} />
        <FrameCamera frame={frame} />
        <StationMeshes geom={geom} />
        <SceneControls frame={frame} controlsRef={controlsRef} />
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
    </div>
  );
}
