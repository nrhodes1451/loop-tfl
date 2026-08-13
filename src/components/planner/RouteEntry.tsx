"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { disruptionStationSummary, type NetworkIndex } from "@/lib/plan";
import { loop } from "@/lib/tokens";
import type { DisruptionPayload, NetworkStation } from "@/lib/types";
import { StationResults, type StationFilter } from "./StationResults";

export function RouteEntry({
  index,
  from,
  to,
  disruptions,
  activeSlot,
  onFocusSlot,
  onExitSearch,
  onSelect,
  onSwap,
  onPlan,
  onOpenDisruptions,
}: {
  index: NetworkIndex;
  from: NetworkStation | null;
  to: NetworkStation | null;
  disruptions: DisruptionPayload | null;
  activeSlot: "from" | "to" | null;
  onFocusSlot: (slot: "from" | "to") => void;
  onExitSearch: () => void;
  onSelect: (stationId: string) => void;
  onSwap: () => void;
  onPlan: () => void;
  onOpenDisruptions: () => void;
}) {
  const canPlan = Boolean(from && to && from.id !== to.id);
  const summary = disruptionStationSummary(index, disruptions);
  const searching = activeSlot !== null;

  const [query, setQuery] = useState("");
  const [querySlot, setQuerySlot] = useState(activeSlot);
  const [filter, setFilter] = useState<StationFilter>("all");
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [geoError, setGeoError] = useState(false);

  if (querySlot !== activeSlot) {
    setQuerySlot(activeSlot);
    setQuery("");
  }

  useEffect(() => {
    if (!searching) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExitSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searching, onExitSearch]);

  useEffect(() => {
    if (filter !== "nearby" || here) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeoError(true),
      { maximumAge: 60_000, timeout: 8_000 },
    );
  }, [filter, here]);

  return (
    <div className="flex min-h-full flex-col">
      <header style={{ padding: "22px 20px 0" }}>
        <div className="flex flex-wrap items-baseline gap-[9px]">
          <div
            style={{
              fontSize: 27,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: loop.text,
            }}
          >
            Loop
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)]"
            style={{ fontSize: 10, color: loop.label, letterSpacing: "0.04em" }}
          >
            london · live lift status
          </div>
        </div>
        <p
          className="m-0"
          style={{ marginTop: 6, fontSize: 11.5, color: loop.faint }}
        >
          Unofficial. Not affiliated with TfL.
        </p>
      </header>

      <div
        className="flex flex-1 flex-col"
        style={{ padding: "26px 20px 0", gap: 14 }}
      >
        <h2
          className="m-0"
          style={{
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: loop.text,
          }}
        >
          Plan a step-free journey
        </h2>

        <div
          className="flex"
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 16,
            padding: "6px 6px 6px 0",
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <StationSlot
              slot="from"
              station={from}
              active={activeSlot === "from"}
              searchMode={searching}
              query={query}
              onQuery={setQuery}
              onFocus={() => onFocusSlot("from")}
              onExit={onExitSearch}
            />
            <div
              style={{
                height: 1,
                background: loop.hairline,
                marginLeft: 46,
              }}
            />
            <StationSlot
              slot="to"
              station={to}
              active={activeSlot === "to"}
              searchMode={searching}
              query={query}
              onQuery={setQuery}
              onFocus={() => onFocusSlot("to")}
              onExit={onExitSearch}
            />
          </div>
          <button
            type="button"
            aria-label="Swap start and destination"
            onClick={onSwap}
            className="cursor-pointer self-stretch"
            style={{
              width: 46,
              background: loop.raised,
              border: `1px solid ${loop.hairline}`,
              borderRadius: 12,
              fontSize: 17,
              color: loop.text,
            }}
          >
            ⇅
          </button>
        </div>

        {searching && activeSlot ? (
          <StationResults
            index={index}
            disruptions={disruptions}
            query={query}
            filter={filter}
            onFilter={setFilter}
            here={here}
            geoError={geoError}
            slot={activeSlot}
            onSelect={onSelect}
          />
        ) : (
          <>
            {!from && !to ? (
              <div
                className="text-center"
                style={{
                  border: "1px dashed rgba(0,0,0,.13)",
                  borderRadius: 14,
                  padding: "20px 18px",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
                  No journeys yet
                </div>
                <p
                  className="m-0"
                  style={{
                    marginTop: 6,
                    fontSize: 12.5,
                    color: loop.label,
                    lineHeight: 1.5,
                  }}
                >
                  Pick a destination and Loop checks every lift and ramp on the way —
                  street to street.
                </p>
              </div>
            ) : null}

            <DisruptionCard summary={summary} onOpen={onOpenDisruptions} />

            <div className="mt-auto" />
          </>
        )}
      </div>

      {searching ? null : (
        <div
          style={{
            padding: "14px 20px 12px",
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            background: "linear-gradient(to top, #f7f8f9 60%, rgba(247,248,249,0))",
          }}
        >
          {!canPlan && (
            <p
              className="m-0 text-center"
              style={{ marginBottom: 8, fontSize: 12, color: loop.label }}
            >
              Choose a destination to continue
            </p>
          )}
          <button
            type="button"
            disabled={!canPlan}
            onClick={onPlan}
            className="w-full"
            style={{
              minHeight: 54,
              borderRadius: 15,
              border: "none",
              background: canPlan ? loop.text : loop.disabled,
              color: canPlan ? "#ffffff" : loop.label,
              fontSize: 16.5,
              fontWeight: 600,
              cursor: canPlan ? "pointer" : "not-allowed",
            }}
          >
            Plan step-free route
          </button>
          <div className="mt-3 text-center">
            <Link
              href="/explore"
              style={{
                fontSize: 12.5,
                color: loop.muted,
                borderBottom: "1px solid rgba(0,0,0,.15)",
                textDecoration: "none",
              }}
            >
              Explore the network graph
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StationSlot({
  slot,
  station,
  active,
  searchMode,
  query,
  onQuery,
  onFocus,
  onExit,
}: {
  slot: "from" | "to";
  station: NetworkStation | null;
  active: boolean;
  searchMode: boolean;
  query: string;
  onQuery: (value: string) => void;
  onFocus: () => void;
  onExit: () => void;
}) {
  const rowStyle = {
    minHeight: searchMode ? 56 : 60,
    padding: "0 8px 0 18px",
    gap: 14,
    borderRadius: 12,
    border: "none",
    background: "transparent" as const,
    color: loop.text,
    boxShadow: active ? loop.focus : undefined,
  };

  const marker = (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        boxSizing: "border-box",
        border: `3px solid ${active ? loop.text : loop.label}`,
        borderRadius: slot === "from" ? 99 : 3,
      }}
    />
  );

  const label = (
    <span
      className="block font-[family-name:var(--font-ibm-plex-mono)]"
      style={{
        fontSize: 9.5,
        color: loop.label,
        letterSpacing: "0.08em",
      }}
    >
      {slot === "from" ? "FROM" : "TO"}
    </span>
  );

  if (active) {
    return (
      <div className="flex w-full items-center text-left" style={rowStyle}>
        {marker}
        <span className="min-w-0 flex-1">
          {label}
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onExit();
              }
            }}
            placeholder="Choose a station"
            aria-label={slot === "from" ? "From station" : "To station"}
            className="min-w-0 w-full placeholder:text-[#7b828c]"
            style={{
              display: "block",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 16,
              fontWeight: 600,
              color: loop.text,
              padding: 0,
              caretColor: loop.text,
            }}
          />
        </span>
        <button
          type="button"
          onClick={onExit}
          className="cursor-pointer"
          style={{
            border: "none",
            background: "transparent",
            fontSize: 12,
            color: loop.label,
            minHeight: 44,
            flexShrink: 0,
          }}
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onFocus}
      className="flex w-full cursor-pointer items-center text-left"
      style={rowStyle}
    >
      {marker}
      <span className="min-w-0">
        {label}
        <span
          className="block truncate"
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: station ? loop.text : loop.placeholder,
          }}
        >
          {station?.name ?? "Choose a station"}
        </span>
      </span>
    </button>
  );
}

function DisruptionCard({
  summary,
  onOpen,
}: {
  summary: ReturnType<typeof disruptionStationSummary>;
  onOpen: () => void;
}) {
  const clickable = Boolean(summary && !("error" in summary) && summary.count > 0);
  const body = (
    <>
      {!summary ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: loop.label }}>
          Checking live lift status…
        </div>
      ) : "error" in summary ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: loop.brk }}>
          Live feed unavailable
          <div
            style={{
              marginTop: 4,
              fontSize: 12.5,
              fontWeight: 400,
              color: loop.muted,
            }}
          >
            {summary.error}. Statuses will be marked unknown.
          </div>
        </div>
      ) : summary.count === 0 ? (
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: loop.ok,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
              No lift outages reported
            </div>
            <div style={{ fontSize: 12.5, color: loop.muted }}>
              Live feed is up. Outages appear here as TfL reports them.
            </div>
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center" style={{ gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: loop.brk,
              flexShrink: 0,
            }}
          />
          <div className="min-w-0 flex-1 text-left">
            <div style={{ fontSize: 14, fontWeight: 600, color: loop.text }}>
              {summary.count} lift{summary.count === 1 ? "" : "s"} out of service
            </div>
            <div style={{ fontSize: 12.5, color: loop.muted }}>
              {formatNames(summary.names)}
            </div>
          </div>
          <span aria-hidden style={{ fontSize: 20, color: loop.label, lineHeight: 1 }}>
            ›
          </span>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div
        className="font-[family-name:var(--font-ibm-plex-mono)]"
        style={{
          fontSize: 9.5,
          color: loop.label,
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        LIFT DISRUPTIONS NOW
      </div>
      {clickable ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Show all ${summary && !("error" in summary) ? summary.count : ""} lifts out of service`}
          className="w-full cursor-pointer text-left"
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 14,
            padding: "14px 16px",
            minHeight: 44,
            color: loop.text,
          }}
        >
          {body}
        </button>
      ) : (
        <div
          style={{
            background: loop.panel,
            border: `1px solid ${loop.hairline}`,
            borderRadius: 14,
            padding: "14px 16px",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function formatNames(names: string[]): string {
  if (names.length === 0) return "Stations updating…";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}
