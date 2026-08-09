"use client";

import {
  disruptedStations,
  platformStatus,
  platformSubLabel,
  statusColor,
  statusLabel,
  workingPlatformCount,
} from "@/lib/status";
import { lineColorForCanvas } from "@/lib/tokens";
import type { DisruptionPayload, NetworkData } from "@/lib/types";

type Props = {
  network: NetworkData;
  disruptions: DisruptionPayload | null;
  selected: string | null;
  onSelectStation: (id: string | null) => void;
  onExpandStation: (id: string) => void;
  liveMessage: string;
};

export function Sidebar({
  network,
  disruptions,
  selected,
  onSelectStation,
  onExpandStation,
  liveMessage,
}: Props) {
  const station = selected
    ? network.stations.find((s) => s.id === selected) ?? null
    : null;

  const kicker = station ? "Station" : "Network overview";
  const title = station
    ? station.name
    : `${network.stations.length} stations · ${network.lines.length} lines`;
  const counts = station
    ? workingPlatformCount(station.id, network, disruptions)
    : null;
  const subtitle = station
    ? `${counts!.total} platforms · ${counts!.working} with a working step-free route right now`
    : "Live lift status across the graph, updated as feeds report in.";

  const disrupted = disruptedStations(network, disruptions).slice(0, 9);

  return (
    <aside
      className="flex h-full w-[372px] flex-none flex-col overflow-hidden border-l"
      style={{ background: "#101318", borderColor: "#1e222a" }}
      aria-label="Station details"
    >
      <div
        className="border-b px-[22px] pb-[18px] pt-[22px]"
        style={{ borderColor: "#1e222a" }}
      >
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "#6f7681" }}
        >
          {kicker}
        </div>
        <h1
          className="mt-2 text-[21px] font-semibold tracking-[-0.02em] text-pretty"
          style={{ fontWeight: 650, color: "#e9ecf1" }}
        >
          {title}
        </h1>
        <p className="mt-1.5 text-[13px] leading-normal text-pretty" style={{ color: "#838a95" }}>
          {subtitle}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-[22px] pb-7 pt-[18px]">
        {station ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => onSelectStation(null)}
              className="self-start rounded-md border px-2.5 py-1.5 text-[12.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                color: "#b7bdc7",
                background: "#16191f",
                borderColor: "#262b33",
                outlineColor: "#e9ecf1",
              }}
            >
              ← Network overview
            </button>
            <StationDetail
              network={network}
              disruptions={disruptions}
              stationId={station.id}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] leading-relaxed text-pretty" style={{ color: "#838a95" }}>
              Click any station to expand it into its platform and lift nodes. The halo
              around a station is its worst-case step-free status right now.
            </p>
            <div className="h-px" style={{ background: "#1e222a" }} />
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#6f7681" }}
            >
              Currently disrupted
            </div>

            {!disruptions ? (
              <p className="text-[13px]" style={{ color: "#838a95" }}>
                Loading live lift disruptions…
              </p>
            ) : !disruptions.ok ? (
              <p className="text-[13px]" style={{ color: "#f2565c" }}>
                Live disruption feed unavailable
                {disruptions.error ? `: ${disruptions.error}` : "."} Status colours may
                show as unknown until the feed recovers.
              </p>
            ) : disrupted.length === 0 ? (
              <p className="text-[13px]" style={{ color: "#838a95" }}>
                No lift disruptions reported right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-[7px]" role="list">
                {disrupted.map(({ station: st, count }) => (
                  <li key={st.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectStation(st.id);
                        onExpandStation(st.id);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-[11px] py-[9px] text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9ecf1]"
                      style={{
                        background: "#14171d",
                        borderColor: "#232830",
                        color: "#dde2e9",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#1a1f26";
                        e.currentTarget.style.borderColor = "#303743";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#14171d";
                        e.currentTarget.style.borderColor = "#232830";
                      }}
                    >
                      <span
                        className="h-2 w-2 flex-none rounded-full"
                        style={{ background: "#f2565c" }}
                      />
                      <span className="min-w-0 flex-1 text-[13px] font-medium">
                        {st.name}
                      </span>
                      <span
                        className="font-[family-name:var(--font-ibm-plex-mono)] text-[11.5px]"
                        style={{ color: "#7d848f" }}
                      >
                        {count} {count === 1 ? "lift" : "lifts"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="h-px" style={{ background: "#1e222a" }} />
            <StationList
              network={network}
              selected={selected}
              onSelect={(id) => {
                onSelectStation(id);
                onExpandStation(id);
              }}
            />
          </div>
        )}
      </div>

      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveMessage}
      </div>
    </aside>
  );
}

function StationList({
  network,
  selected,
  onSelect,
}: {
  network: NetworkData;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div
        className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "#6f7681" }}
      >
        All stations
      </div>
      <ul
        className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto"
        role="listbox"
        aria-label="Stations"
      >
        {network.stations.map((st) => (
          <li key={st.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected === st.id}
              onClick={() => onSelect(st.id)}
              className="w-full rounded-md px-2 py-1.5 text-left text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                color: selected === st.id ? "#ffffff" : "#cfd5de",
                background: selected === st.id ? "#1a1f26" : "transparent",
                outlineColor: "#e9ecf1",
              }}
            >
              {st.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StationDetail({
  network,
  disruptions,
  stationId,
}: {
  network: NetworkData;
  disruptions: DisruptionPayload | null;
  stationId: string;
}) {
  const station = network.stations.find((s) => s.id === stationId)!;
  const lines = station.lineIds
    .map((id) => network.lines.find((l) => l.id === id))
    .filter(Boolean);
  const platforms = network.platforms.filter((p) => p.stationId === stationId);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="mb-1 flex flex-wrap gap-1.5">
        {lines.map((l) =>
          l ? (
            <div
              key={l.id}
              className="flex items-center gap-1.5 rounded-full border py-1 pr-[9px] pl-[7px] text-[11.5px]"
              style={{
                background: "#171b21",
                borderColor: "#232830",
                color: "#cfd5de",
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: lineColorForCanvas(l.id) }}
              />
              {l.name}
            </div>
          ) : null,
        )}
      </div>

      {platforms.length === 0 ? (
        <p className="text-[13px]" style={{ color: "#838a95" }}>
          No platform topology available for this station in the TfL detailed dataset.
        </p>
      ) : (
        platforms.map((p) => {
          const status = platformStatus(p.id, network, disruptions);
          const chain = network.platformLiftChains.find(
            (c) => c.platformId === p.id,
          );
          const hasLifts = (chain?.liftIds.length ?? 0) > 0;
          const border =
            status === "bad" || status === "none" ? "#3a2226" : "#1f242b";
          const sc = statusColor(status);

          return (
            <article
              key={p.id}
              className="rounded-[10px] border px-3.5 py-[13px]"
              style={{ background: "#13161b", borderColor: border }}
            >
              <div className="flex items-center gap-[9px]">
                <span
                  className="h-[26px] w-1 flex-none rounded"
                  style={{ background: lineColorForCanvas(p.lineId) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px]" style={{ fontWeight: 550, color: "#e9ecf1" }}>
                    {p.label}
                  </div>
                  <div className="mt-0.5 text-[11.5px]" style={{ color: "#7d848f" }}>
                    {platformSubLabel(p, network)}
                  </div>
                </div>
                <div
                  className="whitespace-nowrap rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                  style={{
                    color: sc,
                    borderColor: `${sc}33`,
                    background: `${sc}14`,
                  }}
                >
                  {statusLabel(status)}
                </div>
              </div>

              {hasLifts ? (
                <ul
                  className="mt-3 flex flex-col gap-2 border-t pt-[11px]"
                  style={{ borderColor: "#23272f" }}
                >
                  {chain!.liftIds.map((lid) => {
                    const lift = network.lifts.find((l) => l.id === lid);
                    const message = disruptions?.byLiftId[lid];
                    const color = !disruptions?.ok
                      ? "#5f6672"
                      : message
                        ? "#f2565c"
                        : "#35c77b";
                    return (
                      <li key={lid} className="flex items-start gap-[9px]">
                        <span
                          className="mt-[5px] h-2 w-2 flex-none rounded-full"
                          style={{ background: color }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium" style={{ color: "#d5dae1" }}>
                            {lift?.name ?? lid}
                          </div>
                          <div
                            className="mt-0.5 text-xs leading-[1.55] text-pretty"
                            style={{ color: "#838a95" }}
                          >
                            {message ??
                              (disruptions?.ok
                                ? "Operational"
                                : "No live status for this lift")}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div
                  className="mt-[11px] border-t pt-[11px] text-xs leading-[1.55]"
                  style={{ borderColor: "#2c1f22", color: "#f2565c" }}
                >
                  No lift or ramp exists between this platform and street level. There is
                  no step-free route here even when every lift is working.
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
