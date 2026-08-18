"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { StationPicker } from "@/components/schematic/StationPicker";
import { SCENE_BACKGROUND } from "@/lib/schematic/scene";
import type {
  SchematicStation,
  SchematicStationRef,
} from "@/lib/schematic/types";
import type { OsmSurface } from "@/lib/schematic/osm";
import { lineColorForSchematic } from "@/lib/tokens";
import { PMTILES_ATTRIBUTION, PMTILES_URL } from "@/lib/schematic/pmtiles";

const StationScene3D = dynamic(
  () => import("./StationScene3D").then((m) => m.StationScene3D),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full" style={{ background: SCENE_BACKGROUND }} />
    ),
  },
);

const TYPE_KEY: { id: string; name: string; shape: "slab" | "platform" | "shaft" }[] =
  [
    { id: "concourse", name: "Concourse", shape: "slab" },
    { id: "platform", name: "Platform", shape: "platform" },
    { id: "shaft", name: "Lift shaft", shape: "shaft" },
  ];

const LINE_LABELS: Record<string, string> = {
  bakerloo: "Bakerloo",
  central: "Central",
  circle: "Circle",
  district: "District",
  "hammersmith-city": "Hammersmith & City",
  jubilee: "Jubilee",
  metropolitan: "Metropolitan",
  northern: "Northern",
  piccadilly: "Piccadilly",
  victoria: "Victoria",
  "waterloo-city": "Waterloo & City",
  "elizabeth-line": "Elizabeth line",
  elizabeth: "Elizabeth line",
  dlr: "DLR",
  "london-overground": "Overground",
  overground: "Overground",
  liberty: "Liberty",
  lioness: "Lioness",
  mildmay: "Mildmay",
  suffragette: "Suffragette",
  weaver: "Weaver",
  windrush: "Windrush",
  tram: "Tram",
  "national-rail": "National Rail",
};

function lineLabel(id: string): string {
  if (LINE_LABELS[id]) return LINE_LABELS[id];
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function depthLegend(
  station: SchematicStation,
): { key: string; level: number; label: string; color: string }[] {
  const rows: { key: string; level: number; label: string; color: string }[] =
    [];
  if (station.nodes.some((n) => n.type === "street")) {
    rows.push({
      key: "street",
      level: 0,
      label: "Street",
      color: "#84b817",
    });
  }
  const concourseLevels = [
    ...new Set(
      station.nodes.filter((n) => n.type === "concourse").map((n) => n.level),
    ),
  ].sort((a, b) => b - a);
  for (const level of concourseLevels) {
    const mezz = level <= -3;
    rows.push({
      key: `concourse-${level}`,
      level,
      label: mezz ? "Mezzanine" : "Ticket hall",
      color: mezz ? "#a894d6" : "#d6a860",
    });
  }
  const lines = new Map<string, number>();
  for (const n of station.nodes) {
    if (n.type !== "platform" || !n.lineId) continue;
    const prev = lines.get(n.lineId);
    if (prev == null || n.level < prev) lines.set(n.lineId, n.level);
  }
  const lineRows = [...lines.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [lineId, level] of lineRows) {
    rows.push({
      key: `line-${lineId}`,
      level,
      label: lineLabel(lineId),
      color: lineColorForSchematic(lineId),
    });
  }
  return rows;
}

function fmtCoord(n: number): string {
  return n.toFixed(5);
}

function TypeGlyph({ shape }: { shape: "slab" | "platform" | "shaft" }) {
  const stroke = "#8fd8ff";
  if (shape === "shaft") {
    return (
      <span
        className="inline-block h-[9px] w-[9px] rounded-full border"
        style={{ borderColor: stroke, background: "rgba(143, 216, 255, 0.2)" }}
        aria-hidden
      />
    );
  }
  if (shape === "platform") {
    return (
      <span
        className="inline-block h-[6px] w-[14px] border"
        style={{ borderColor: stroke, background: "rgba(143, 216, 255, 0.2)" }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block h-[9px] w-[11px] border"
      style={{ borderColor: stroke, background: "rgba(143, 216, 255, 0.2)" }}
      aria-hidden
    />
  );
}

function ChromeCheck({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-[7px] border px-2.5 py-1.5 text-[12px] select-none sm:px-[13px] sm:py-2 sm:text-[12.5px]"
      style={{
        color: "#d5dbe6",
        background: "rgba(12, 14, 18, 0.82)",
        borderColor: "#2a313c",
        backdropFilter: "blur(8px)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[#8fd8ff]"
      />
      {label}
    </label>
  );
}

export function SchematicPage({
  station,
  stations,
  surface = null,
}: {
  station: SchematicStation;
  stations: SchematicStationRef[];
  surface?: OsmSurface | null;
}) {
  const [showLegend, setShowLegend] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [showSchematic, setShowSchematic] = useState(true);
  const [panMode, setPanMode] = useState(false);
  const [pmtilesOk, setPmtilesOk] = useState(false);
  const resetView = useRef<(() => void) | null>(null);
  const usePmtiles = station.stationId === "HUBKGX" && pmtilesOk;

  useEffect(() => {
    if (station.stationId !== "HUBKGX") return;
    let cancelled = false;
    fetch(PMTILES_URL, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setPmtilesOk(res.ok);
      })
      .catch(() => {
        if (!cancelled) setPmtilesOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [station.stationId]);
  const topology = useMemo(
    () => ({ nodes: station.nodes, edges: station.edges }),
    [station.nodes, station.edges],
  );
  const levels = depthLegend(station);
  const hasMap = !!(surface || usePmtiles);
  const chromeBtn =
    "cursor-pointer whitespace-nowrap rounded-[7px] border px-2.5 py-1.5 text-[12px] font-medium no-underline sm:px-[13px] sm:py-2 sm:text-[12.5px]";
  const chromeBtnStyle = {
    color: "#d5dbe6",
    background: "rgba(12, 14, 18, 0.82)",
    borderColor: "#2a313c",
  } as const;
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: SCENE_BACKGROUND, color: "#e8edf4" }}
    >
      <StationScene3D
        topology={topology}
        resetRef={resetView}
        surface={surface}
        showSurface={showMap}
        showSchematic={showSchematic}
        usePmtiles={usePmtiles}
        panMode={panMode}
      />

      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-3 sm:gap-5 sm:px-6 sm:pt-[18px]"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <div
            className="w-fit rounded-md px-2 py-0.5 font-[family-name:var(--font-ibm-plex-mono)] text-[10.5px] font-medium uppercase tracking-[0.12em]"
            style={{
              color: "#ffe7a8",
              background: "rgba(255, 196, 72, 0.12)",
              border: "1px solid rgba(255, 196, 72, 0.45)",
            }}
          >
            Schematic — not to scale, not for wayfinding
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="text-[18px] font-bold tracking-[-0.02em] sm:text-[21px]">
              {station.name}
            </div>
            <div className="pointer-events-auto">
              <StationPicker currentId={station.stationId} stations={stations} />
            </div>
          </div>
          {showLegend ? (
            <>
              <div
                className="max-w-[42rem] text-[12.5px] leading-normal"
                style={{ color: "#8b93a0" }}
              >
                Visualisation aid, not a blueprint. Connecting lines indicate
                level access; only lift shafts change elevation.
              </div>
              <div
                className="hidden font-[family-name:var(--font-ibm-plex-mono)] text-[11px] sm:block"
                style={{ color: "#6f7681" }}
              >
                <a
                  href={station.entrance.source}
                  target="_blank"
                  rel="noreferrer"
                  className="pointer-events-auto underline decoration-[#3a4250] underline-offset-2 hover:decoration-[#8b93a0]"
                  style={{ color: "#8b93a0" }}
                >
                  {fmtCoord(station.entrance.lat)}, {fmtCoord(station.entrance.lon)}
                </a>
                {" · "}
                {station.entrance.label}
              </div>
            </>
          ) : null}
        </div>
        <div className="pointer-events-auto flex flex-none flex-col items-end gap-2">
          <div className="flex gap-2">
            <Link href="/" className={chromeBtn} style={chromeBtnStyle}>
              Plan a route
            </Link>
            <Link href="/explore" className={chromeBtn} style={chromeBtnStyle}>
              Graph
            </Link>
            <button
              type="button"
              onClick={() => resetView.current?.()}
              className={chromeBtn}
              style={chromeBtnStyle}
            >
              Reset view
            </button>
          </div>
        </div>
      </header>

      {showLegend ? (
      <aside
        className="absolute bottom-[max(52px,calc(env(safe-area-inset-bottom)+44px))] left-3 right-3 z-10 flex max-h-[42%] flex-col gap-2.5 overflow-auto rounded-[10px] border px-3 py-2.5 sm:right-auto sm:bottom-[22px] sm:left-6 sm:max-h-none sm:max-w-[320px] sm:gap-3 sm:px-4 sm:py-3.5"
        style={{
          background: "rgba(8, 10, 14, 0.82)",
          borderColor: "#2a313c",
          backdropFilter: "blur(8px)",
        }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#8b93a0" }}
        >
          Depth tiers (TfL colours)
        </div>
        <div className="flex flex-col gap-1">
          {levels.map((row) => (
            <div
              key={row.key}
              className="flex items-baseline justify-between gap-4 text-[12px]"
              style={{ color: "#c5ccd6" }}
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-[8px] w-[8px] rounded-full"
                  style={{
                    background: row.color,
                    boxShadow: `0 0 6px ${row.color}`,
                  }}
                />
                {row.label}
              </span>
              <span
                className="font-[family-name:var(--font-ibm-plex-mono)] text-[11px]"
                style={{ color: "#8b93a0" }}
              >
                {row.level}
              </span>
            </div>
          ))}
        </div>
        <div className="h-px" style={{ background: "#2a313c" }} />
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#8b93a0" }}
        >
          Volumes
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {TYPE_KEY.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-[7px] text-xs"
              style={{ color: "#c5ccd6" }}
            >
              <TypeGlyph shape={row.shape} />
              {row.name}
            </div>
          ))}
        </div>
        <div className="text-[11px] leading-snug" style={{ color: "#8b93a0" }}>
          {panMode
            ? "Drag to pan, pinch or scroll to zoom."
            : "Drag to orbit, pinch or scroll to zoom."}{" "}
          Hover or tap a volume for its name; lifts highlight the whole shaft.
          Click the compass to face north.
        </div>
        {usePmtiles ? (
          <div className="text-[11px] leading-snug" style={{ color: "#8b93a0" }}>
            OSM building footprints via PMTiles ({PMTILES_ATTRIBUTION}). Not a
            surveyed basement.
          </div>
        ) : surface ? (
          <div className="text-[11px] leading-snug" style={{ color: "#8b93a0" }}>
            OSM building footprints, {surface.attribution}. {surface.sizeM} m
            box around the TfL station point — not a surveyed basement.
          </div>
        ) : null}
      </aside>
      ) : null}

      <div
        className="absolute z-20 flex flex-col items-stretch gap-1.5 right-3 bottom-[max(12px,env(safe-area-inset-bottom))] sm:right-6 sm:bottom-[22px]"
      >
        {hasMap ? (
          <>
            <ChromeCheck
              checked={showMap}
              onChange={setShowMap}
              label="Map"
            />
            <ChromeCheck
              checked={showSchematic}
              onChange={setShowSchematic}
              label="Schematic"
            />
            <ChromeCheck
              checked={panMode}
              onChange={setPanMode}
              label="Pan"
            />
          </>
        ) : null}
        <ChromeCheck
          checked={showLegend}
          onChange={setShowLegend}
          label="Show legend"
        />
      </div>
    </div>
  );
}
