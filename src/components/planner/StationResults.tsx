"use client";

import { useMemo } from "react";
import { haversineMeters, stationHasStepFree, type NetworkIndex } from "@/lib/plan";
import { stationAggregateStatus } from "@/lib/status";
import { lineColorForCanvas, loop } from "@/lib/tokens";
import type { DisruptionPayload, NetworkStation } from "@/lib/types";
import { StatusChip } from "./StatusChip";

export type StationFilter = "all" | "stepFreeOnly" | "nearby";

export function StationResults({
  index,
  disruptions,
  query,
  filter,
  onFilter,
  here,
  geoError,
  slot,
  onSelect,
}: {
  index: NetworkIndex;
  disruptions: DisruptionPayload | null;
  query: string;
  filter: StationFilter;
  onFilter: (filter: StationFilter) => void;
  here: { lat: number; lon: number } | null;
  geoError: boolean;
  slot: "from" | "to";
  onSelect: (stationId: string) => void;
}) {
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of index.network.stations) {
      counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    }
    return counts;
  }, [index]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = index.network.stations.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (filter === "stepFreeOnly" && !stationHasStepFree(index, s.id)) return false;
      return true;
    });
    if (filter === "nearby" && here) {
      list = [...list].sort(
        (a, b) => haversineMeters(here, a) - haversineMeters(here, b),
      );
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [index, query, filter, here]);

  const rows = filtered.slice(0, 80);
  const matchCount = filtered.length;
  const noun = matchCount === 1 ? "MATCH" : "MATCHES";
  const liftStatus = !disruptions
    ? "Lift status · checking"
    : disruptions.ok
      ? `Lift status · ${freshness(disruptions.updatedAt)}`
      : "Lift status · unavailable";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <Chip
          label="All stations"
          selected={filter === "all"}
          onClick={() => onFilter("all")}
        />
        <Chip
          label="Step-free only"
          selected={filter === "stepFreeOnly"}
          onClick={() => onFilter("stepFreeOnly")}
        />
        <Chip
          label="Nearby"
          selected={filter === "nearby"}
          onClick={() => onFilter("nearby")}
        />
      </div>
      {filter === "nearby" &&
        (geoError ||
          (typeof navigator !== "undefined" && !navigator.geolocation)) && (
        <p className="m-0" style={{ marginTop: 8, fontSize: 12.5, color: loop.muted }}>
          Location permission is needed to sort by nearby. Showing A–Z instead.
        </p>
      )}
      <div
        className="flex items-baseline justify-between"
        style={{ marginTop: 12, gap: 12 }}
      >
        <span
          className="font-[family-name:var(--font-ibm-plex-mono)]"
          style={{
            fontSize: 9.5,
            color: loop.label,
            letterSpacing: "0.08em",
          }}
        >
          {matchCount} {noun}
        </span>
        <span style={{ fontSize: 11.5, color: loop.faint }}>{liftStatus}</span>
      </div>
      <ul
        className="m-0 flex min-h-0 flex-1 flex-col overflow-auto p-0"
        style={{ gap: 6, padding: "12px 0 0", overflowAnchor: "none" }}
      >
        {rows.map((s) => (
          <StationRow
            key={s.id}
            station={s}
            index={index}
            disruptions={disruptions}
            qualifier={
              (nameCounts.get(s.name) ?? 0) > 1
                ? lineQualifier(index, s)
                : undefined
            }
            onSelect={() => onSelect(s.id)}
          />
        ))}
      </ul>
      <p
        className="m-0"
        style={{
          marginTop: 12,
          paddingBottom: "max(24px, env(safe-area-inset-bottom))",
          fontSize: 11.5,
          color: loop.faint,
          lineHeight: 1.5,
        }}
      >
        “Partial” means some platforms only. Tap a station to set it as your{" "}
        {slot === "from" ? "start" : "destination"}.
      </p>
    </div>
  );
}

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer"
      style={{
        padding: "8px 12px",
        borderRadius: 9,
        fontSize: 12.5,
        fontWeight: 600,
        minHeight: 44,
        border: selected ? "none" : `1px solid ${loop.hairline}`,
        background: selected ? loop.text : loop.raised,
        color: selected ? "#ffffff" : loop.muted,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

function StationRow({
  station,
  index,
  disruptions,
  qualifier,
  onSelect,
}: {
  station: NetworkStation;
  index: NetworkIndex;
  disruptions: DisruptionPayload | null;
  qualifier?: string;
  onSelect: () => void;
}) {
  const status = stationAggregateStatus(station.id, index.network, disruptions);
  const lineIds = station.lineIds.filter((id) => id !== "national-rail");
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center text-left"
        style={{
          background: loop.panel,
          border: `1px solid ${loop.hairline}`,
          borderRadius: 14,
          minHeight: 74,
          padding: "13px 15px",
          gap: 12,
        }}
      >
        <span className="min-w-0 flex-1">
          <span
            className="block"
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: loop.text,
            }}
          >
            {station.name}
            {qualifier && (
              <span style={{ fontWeight: 500, color: loop.label }}> {qualifier}</span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center" style={{ gap: 6 }}>
            {lineIds.slice(0, 6).map((id) => (
              <span key={id} className="flex items-center" style={{ gap: 5 }}>
                <span
                  style={{
                    width: 22,
                    height: 4,
                    borderRadius: 2,
                    background: lineColorForCanvas(id),
                  }}
                />
                <span style={{ fontSize: 11.5, color: loop.label }}>
                  {index.lineById.get(id)?.name ?? id}
                </span>
              </span>
            ))}
          </span>
        </span>
        <StatusChip status={status} />
      </button>
    </li>
  );
}

function lineQualifier(index: NetworkIndex, station: NetworkStation): string {
  const names = station.lineIds
    .filter((id) => id !== "national-rail")
    .slice(0, 2)
    .map((id) => index.lineById.get(id)?.name ?? id);
  return names.length ? `(${names.join(", ")})` : "";
}

function freshness(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "recently";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "just now";
  if (min === 1) return "1 min ago";
  return `${min} min ago`;
}
