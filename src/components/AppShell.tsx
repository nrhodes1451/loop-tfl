"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { Legend } from "@/components/Legend";
import { Sidebar } from "@/components/sidebar/Sidebar";
import type { DisruptionPayload, NetworkData } from "@/lib/types";

const MAX_EXPANDED = 3;
const POLL_MS = 60_000;

export function AppShell({ network }: { network: NetworkData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [disruptions, setDisruptions] = useState<DisruptionPayload | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const loadDisruptions = useCallback(async () => {
    try {
      const res = await fetch("/api/disruptions", { cache: "no-store" });
      const data = (await res.json()) as DisruptionPayload;
      setDisruptions(data);
      if (data.ok) {
        const n = Object.keys(data.byLiftId).length;
        setLiveMessage(
          n === 0
            ? "Live lift feed updated. No disruptions reported."
            : `Live lift feed updated. ${n} lifts disrupted.`,
        );
      } else {
        setLiveMessage(
          `Live lift feed failed${data.error ? `: ${data.error}` : ""}.`,
        );
      }
    } catch (err) {
      const payload: DisruptionPayload = {
        updatedAt: new Date().toISOString(),
        byLiftId: {},
        byStationId: {},
        ok: false,
        error: (err as Error).message,
      };
      setDisruptions(payload);
      setLiveMessage(`Live lift feed failed: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void loadDisruptions();
    const id = window.setInterval(() => void loadDisruptions(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadDisruptions]);

  const onToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id];
      if (next.length > MAX_EXPANDED) next.shift();
      return next;
    });
  }, []);

  const onExpandStation = useCallback((id: string) => {
    setExpanded((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      if (next.length > MAX_EXPANDED) next.shift();
      return next;
    });
  }, []);

  const feedNote = useMemo(() => {
    if (!disruptions) return "Fetching live lift status…";
    if (!disruptions.ok) return "Live feed error — statuses shown as unknown";
    return `Updated ${new Date(disruptions.updatedAt).toLocaleTimeString()}`;
  }, [disruptions]);

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{ background: "#0b0d10", color: "#e9ecf1" }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-none items-start justify-between gap-5 px-6 pt-[18px] pb-3.5">
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="flex flex-wrap items-baseline gap-[9px]">
              <div className="text-[21px] font-bold tracking-[-0.02em]">Stepfree</div>
              <div
                className="whitespace-nowrap font-[family-name:var(--font-ibm-plex-mono)] text-xs"
                style={{ color: "#7d848f" }}
              >
                london · live lift status
              </div>
            </div>
            <div
              className="text-[12.5px] leading-normal text-pretty"
              style={{ color: "#7d848f" }}
            >
              Unofficial accessibility tool. Not affiliated with any transport operator.
            </div>
            <div
              className="font-[family-name:var(--font-ibm-plex-mono)] text-[11px]"
              style={{ color: "#5c626c" }}
            >
              {feedNote}
            </div>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => setResetToken((n) => n + 1)}
              className="cursor-pointer whitespace-nowrap rounded-[7px] border px-[13px] py-2 text-[12.5px] font-medium"
              style={{
                color: "#b7bdc7",
                background: "#16191f",
                borderColor: "#262b33",
              }}
            >
              Reset view
            </button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <ForceGraph
            network={network}
            disruptions={disruptions}
            selected={selected}
            expanded={expanded}
            onSelectStation={setSelected}
            onToggleExpand={onToggleExpand}
            resetToken={resetToken}
            reducedMotion={reducedMotion}
          />
          <Legend />
        </div>
      </div>

      <Sidebar
        network={network}
        disruptions={disruptions}
        selected={selected}
        onSelectStation={setSelected}
        onExpandStation={onExpandStation}
        liveMessage={liveMessage}
      />
    </div>
  );
}
