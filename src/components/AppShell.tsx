"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ForceGraph } from "@/components/graph/ForceGraph";
import { Legend } from "@/components/Legend";
import type { DisruptionPayload, NetworkData } from "@/lib/types";

const MAX_EXPANDED = 3;
const POLL_MS = 60_000;

export function AppShell({ network }: { network: NetworkData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [disruptions, setDisruptions] = useState<DisruptionPayload | null>(null);
  const [resetToken, setResetToken] = useState(0);
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
    } catch (err) {
      setDisruptions({
        updatedAt: new Date().toISOString(),
        byLiftId: {},
        byStationId: {},
        ok: false,
        error: (err as Error).message,
      });
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

  const feedNote = useMemo(() => {
    if (!disruptions) return "Fetching live lift status…";
    if (!disruptions.ok) return "Live feed error — statuses shown as unknown";
    return `Updated ${new Date(disruptions.updatedAt).toLocaleTimeString()}`;
  }, [disruptions]);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: "#ffffff", color: "#1a1d23" }}
    >
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

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-5 px-6 pt-[18px] pb-3.5">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex flex-wrap items-baseline gap-[9px]">
            <div className="text-[21px] font-bold tracking-[-0.02em]">Stepfree</div>
            <div
              className="whitespace-nowrap font-[family-name:var(--font-ibm-plex-mono)] text-xs"
              style={{ color: "#5c626c" }}
            >
              london · live lift status
            </div>
          </div>
          <div
            className="text-[12.5px] leading-normal text-pretty"
            style={{ color: "#5c626c" }}
          >
            Unofficial accessibility tool. Not affiliated with any transport operator.
          </div>
          <div
            className="font-[family-name:var(--font-ibm-plex-mono)] text-[11px]"
            style={{ color: "#6f7681" }}
          >
            {feedNote}
          </div>
        </div>
        <div className="pointer-events-auto flex flex-none gap-2">
          <button
            type="button"
            onClick={() => setResetToken((n) => n + 1)}
            className="cursor-pointer whitespace-nowrap rounded-[7px] border px-[13px] py-2 text-[12.5px] font-medium"
            style={{
              color: "#2a2f37",
              background: "#ffffff",
              borderColor: "#cfd3d9",
            }}
          >
            Reset view
          </button>
        </div>
      </header>

      <Legend />
    </div>
  );
}
