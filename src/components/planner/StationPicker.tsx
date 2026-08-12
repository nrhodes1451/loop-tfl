"use client";

import { useEffect, useMemo, useState } from "react";
import { haversineMeters, stationHasStepFree, type NetworkIndex } from "@/lib/plan";
import { stationAggregateStatus } from "@/lib/status";
import { lineColorForCanvas, loop } from "@/lib/tokens";
import type { DisruptionPayload, NetworkStation } from "@/lib/types";
import { StatusChip } from "./StatusChip";

type Filter = "all" | "stepFreeOnly" | "nearby";

export function StationPicker({
  index,
  disruptions,
  slot,
  onSelect,
  onBack,
}: {
  index: NetworkIndex;
  disruptions: DisruptionPayload | null;
  slot: "from" | "to";
  onSelect: (stationId: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [geoError, setGeoError] = useState(false);

  useEffect(() => {
    if (filter !== "nearby" || here) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeoError(true),
      { maximumAge: 60_000, timeout: 8_000 },
    );
  }, [filter, here]);

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of index.network.stations) {
      counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    }
    return counts;
  }, [index]);

  const rows = useMemo(() => {
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
    return list.slice(0, 80);
  }, [index, query, filter, here]);

  return (
    <div className="flex min-h-full flex-col" style={{ background: loop.page }}>
      <header
        className="flex items-center"
        style={{ padding: "12px 16px 8px", gap: 12 }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="cursor-pointer"
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: loop.raised,
            border: "none",
            fontSize: 20,
            color: loop.text,
          }}
        >
          ‹
        </button>
        <div style={{ fontSize: 17, fontWeight: 600, color: loop.text }}>
          {slot === "from" ? "Start" : "Destination"}
        </div>
      </header>

      <div style={{ padding: "0 20px" }}>
        <label
          className="flex items-center"
          style={{
            background: loop.panel,
            border: `1px solid ${loop.strong}`,
            borderRadius: 14,
            minHeight: 50,
            padding: "0 15px",
            gap: 11,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 13,
              height: 13,
              borderRadius: 99,
              border: `2px solid ${loop.label}`,
              boxSizing: "border-box",
              flexShrink: 0,
            }}
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Station name"
            className="min-w-0 flex-1"
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 16,
              fontWeight: 500,
              color: loop.text,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="cursor-pointer"
              style={{
                border: "none",
                background: "transparent",
                fontSize: 12,
                color: loop.label,
                minHeight: 44,
              }}
            >
              Clear
            </button>
          )}
        </label>

        <div className="flex flex-wrap" style={{ gap: 8, marginTop: 10 }}>
          <Chip
            label="All stations"
            selected={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <Chip
            label="Step-free only"
            selected={filter === "stepFreeOnly"}
            onClick={() => setFilter("stepFreeOnly")}
          />
          <Chip
            label="Nearby"
            selected={filter === "nearby"}
            onClick={() => setFilter("nearby")}
          />
        </div>
        {filter === "nearby" &&
          (geoError ||
            (typeof navigator !== "undefined" && !navigator.geolocation)) && (
          <p className="m-0" style={{ marginTop: 8, fontSize: 12.5, color: loop.muted }}>
            Location permission is needed to sort by nearby. Showing A–Z instead.
          </p>
        )}
        <p className="m-0" style={{ marginTop: 12, fontSize: 11.5, color: loop.faint }}>
          Status from TfL open data
          {disruptions?.ok
            ? `, refreshed ${freshness(disruptions.updatedAt)}.`
            : ". Live feed unavailable — treat statuses with care."}{" "}
          “Partial” means some platforms only.
        </p>
      </div>

      <ul
        className="m-0 flex flex-1 flex-col overflow-auto p-0"
        style={{ gap: 6, padding: "12px 20px 24px" }}
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
