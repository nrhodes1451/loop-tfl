"use client";

import { Line } from "@react-three/drei";
import { memo, useMemo, type RefObject } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import {
  hallPickGeometry,
  hallPrismEdges,
  hallsToBottomGeometry,
  stairFlightPickGeometry,
  stairsToBottomGeometry,
  stairsToLineSegments,
} from "@/lib/schematic/building-geom";
import {
  STAIR_COLOR,
  STAIR_DROP_M,
  STAIR_LINE_WIDTH,
  STAIR_RISERS,
  overlayGeometries,
  type EntranceOverlayFile,
  type OverlayHallItem,
  type OverlayStairItem,
} from "@/lib/schematic/entrances";
import {
  makeHoverId,
  schematicEdgeColor,
  splitHoverId,
  VOLUME_BOTTOM_OPACITY,
} from "@/lib/schematic/scene";
import type { LatLon } from "@/lib/schematic/geo";
import { DoubleSide, type BufferGeometry } from "three";

// Same queue as VolumeMesh / GlowLine. City buildings write depth later
// (order 3); painting first lets them composite over the cages the way
// the rest of the dollhouse shows through the block.
const VOLUME_ORDER = 1;
const LINE_ORDER = 2;

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

function lineOpacity(highlighted: boolean, dimmed: boolean): number {
  if (highlighted) return 1;
  if (dimmed) return 0.22;
  return 0.95;
}

const OverlayPickMesh = memo(function OverlayPickMesh({
  geometry,
  hoverId,
  stationId,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  geometry: BufferGeometry | null;
  hoverId: string;
  stationId: string;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: (stationId: string) => void;
}) {
  if (!geometry) return null;
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    onHover(hoverId);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (stickyHover) return;
    onHover(null);
  };
  const onTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    onHover(hoverId);
    onPick?.(stationId);
  };
  return (
    <mesh
      geometry={geometry}
      renderOrder={VOLUME_ORDER}
      onPointerOver={onOver}
      onPointerOut={onOut}
      onClick={onTap}
    >
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
});

const OverlayHall = memo(function OverlayHall({
  hall,
  highlighted,
  dimmed,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  hall: OverlayHallItem;
  highlighted: boolean;
  dimmed: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: (stationId: string) => void;
}) {
  const { pts, bottom, pick } = useMemo(
    () => ({
      pts: hallPrismEdges(hall.ring, hall.height),
      bottom: hallsToBottomGeometry([hall]),
      pick: hallPickGeometry(hall.ring, hall.height),
    }),
    [hall],
  );
  const color = schematicEdgeColor("street");
  const hoverId = makeHoverId(hall.stationId, hall.id);
  return (
    <group>
      {bottom ? (
        <mesh
          geometry={bottom}
          renderOrder={VOLUME_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={color}
            transparent
            opacity={scaledOpacity(VOLUME_BOTTOM_OPACITY, highlighted, dimmed)}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      {pts.length >= 2 ? (
        <Line
          points={pts}
          segments
          color={color}
          lineWidth={highlighted ? STAIR_LINE_WIDTH * 1.35 : STAIR_LINE_WIDTH}
          transparent
          opacity={lineOpacity(highlighted, dimmed)}
          toneMapped={false}
          frustumCulled={false}
          renderOrder={LINE_ORDER}
          depthWrite={false}
          raycast={noopRaycast}
        />
      ) : null}
      <OverlayPickMesh
        geometry={pick}
        hoverId={hoverId}
        stationId={hall.stationId}
        draggingRef={draggingRef}
        stickyHover={stickyHover}
        onHover={onHover}
        onPick={onPick}
      />
    </group>
  );
});

const OverlayStairs = memo(function OverlayStairs({
  stair,
  highlighted,
  dimmed,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  stair: OverlayStairItem;
  highlighted: boolean;
  dimmed: boolean;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: (stationId: string) => void;
}) {
  const { pts, bottom, pick } = useMemo(
    () => ({
      pts: stairsToLineSegments([stair], STAIR_RISERS, STAIR_DROP_M),
      bottom: stairsToBottomGeometry([stair], STAIR_RISERS, STAIR_DROP_M),
      pick: stairFlightPickGeometry(stair.path, stair.widthM, STAIR_DROP_M),
    }),
    [stair],
  );
  const hoverId = makeHoverId(stair.stationId, stair.id);
  return (
    <group>
      {bottom ? (
        <mesh
          geometry={bottom}
          renderOrder={VOLUME_ORDER}
          raycast={noopRaycast}
        >
          <meshBasicMaterial
            color={STAIR_COLOR}
            transparent
            opacity={scaledOpacity(VOLUME_BOTTOM_OPACITY, highlighted, dimmed)}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      {pts.length >= 2 ? (
        <Line
          points={pts}
          segments
          color={STAIR_COLOR}
          lineWidth={highlighted ? STAIR_LINE_WIDTH * 1.35 : STAIR_LINE_WIDTH}
          transparent
          opacity={lineOpacity(highlighted, dimmed)}
          toneMapped={false}
          frustumCulled={false}
          renderOrder={LINE_ORDER}
          depthWrite={false}
          raycast={noopRaycast}
        />
      ) : null}
      <OverlayPickMesh
        geometry={pick}
        hoverId={hoverId}
        stationId={stair.stationId}
        draggingRef={draggingRef}
        stickyHover={stickyHover}
        onHover={onHover}
        onPick={onPick}
      />
    </group>
  );
});

export function EntranceOverlay({
  origin,
  overlay,
  stationIds,
  hoveredId,
  draggingRef,
  stickyHover,
  onHover,
  onPick,
}: {
  origin: LatLon;
  overlay: EntranceOverlayFile;
  stationIds: string[];
  hoveredId: string | null;
  draggingRef: RefObject<boolean>;
  stickyHover: boolean;
  onHover: (id: string | null) => void;
  onPick?: (stationId: string) => void;
}) {
  const { halls, stairs } = useMemo(
    () => overlayGeometries(overlay, origin, stationIds),
    [overlay, origin, stationIds],
  );
  const parsed = hoveredId ? splitHoverId(hoveredId) : null;

  return (
    <group>
      {halls.map((hall) => {
        const active = parsed?.stationId === hall.stationId;
        return (
          <OverlayHall
            key={`${hall.stationId}:${hall.id}`}
            hall={hall}
            highlighted={active && parsed?.volumeId === hall.id}
            dimmed={!!parsed && active && parsed.volumeId !== hall.id}
            draggingRef={draggingRef}
            stickyHover={stickyHover}
            onHover={onHover}
            onPick={onPick}
          />
        );
      })}
      {stairs.map((stair) => {
        const active = parsed?.stationId === stair.stationId;
        return (
          <OverlayStairs
            key={`${stair.stationId}:${stair.id}`}
            stair={stair}
            highlighted={active && parsed?.volumeId === stair.id}
            dimmed={!!parsed && active && parsed.volumeId !== stair.id}
            draggingRef={draggingRef}
            stickyHover={stickyHover}
            onHover={onHover}
            onPick={onPick}
          />
        );
      })}
    </group>
  );
}
