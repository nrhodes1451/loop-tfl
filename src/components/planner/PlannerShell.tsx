"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluatePath,
  findStructuralPath,
  indexNetwork,
  planJourney,
  STALE_MS,
  type PlanResult as PlanView,
  type StructuralPath,
} from "@/lib/plan";
import type { DisruptionPayload, NetworkData } from "@/lib/types";
import { loop } from "@/lib/tokens";
import { DisruptionList } from "./DisruptionList";
import { PlanResult } from "./PlanResult";
import { RouteEntry } from "./RouteEntry";
import { ScreenSwap, type SwapDirection } from "./ScreenSwap";

const POLL_MS = 60_000;

export function PlannerShell({ network }: { network: NetworkData }) {
  const index = useMemo(() => indexNetwork(network), [network]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<"from" | "to" | null>(null);
  const [disruptionsOpen, setDisruptionsOpen] = useState(false);
  const [screen, setScreen] = useState<"entry" | "result">("entry");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [path, setPath] = useState<StructuralPath | null>(null);
  const [liftsChecked, setLiftsChecked] = useState(0);
  const [liftsTotal, setLiftsTotal] = useState(0);
  const [disruptions, setDisruptions] = useState<DisruptionPayload | null>(null);
  const lastOk = useRef<DisruptionPayload | null>(null);
  const gen = useRef(0);

  const from = fromId ? (index.stationById.get(fromId) ?? null) : null;
  const to = toId ? (index.stationById.get(toId) ?? null) : null;

  const applyFeed = useCallback((data: DisruptionPayload) => {
    if (data.ok) {
      lastOk.current = data;
      setDisruptions(data);
      return data;
    }
    const prev = lastOk.current;
    if (prev?.ok) {
      const t = Date.parse(prev.updatedAt);
      if (!Number.isNaN(t) && Date.now() - t < STALE_MS) {
        setDisruptions(prev);
        return prev;
      }
    }
    setDisruptions(data);
    return data;
  }, []);

  const loadDisruptions = useCallback(async (): Promise<DisruptionPayload> => {
    try {
      const res = await fetch("/api/disruptions", { cache: "no-store" });
      const data = (await res.json()) as DisruptionPayload;
      return applyFeed(data);
    } catch (err) {
      const data: DisruptionPayload = {
        updatedAt: new Date().toISOString(),
        byLiftId: {},
        byStationId: {},
        ok: false,
        error: (err as Error).message,
      };
      return applyFeed(data);
    }
  }, [applyFeed]);

  useEffect(() => {
    const kick = window.setTimeout(() => void loadDisruptions(), 0);
    const id = window.setInterval(() => void loadDisruptions(), POLL_MS);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(id);
    };
  }, [loadDisruptions]);

  const runPlan = useCallback(
    async (opts: {
      exclude?: string[];
      reusePath?: boolean;
      from?: string;
      to?: string;
    } = {}) => {
      const origin = opts.from ?? fromId;
      const dest = opts.to ?? toId;
      if (!origin || !dest) return;
      const token = ++gen.current;
      setScreen("result");
      setActiveSlot(null);
      setPlanning(true);
      setLiftsChecked(0);
      setLiftsTotal(0);

      const found =
        opts.reusePath && path && !opts.exclude
          ? path
          : findStructuralPath(index, origin, dest, opts.exclude ?? []);
      if (token !== gen.current) return;
      setPath(found);

      let feed = disruptions;
      if (!feed) {
        feed = await loadDisruptions();
        if (token !== gen.current) return;
      }

      if (!found) {
        setPlan(planJourney(index, origin, dest, feed));
        setPlanning(false);
        return;
      }

      const preview = evaluatePath(index, found, feed);
      setLiftsTotal(preview.liftsTotal);
      setLiftsChecked(preview.liftsChecked);
      setPlan(preview);
      setPlanning(false);
    },
    [fromId, toId, path, index, disruptions, loadDisruptions],
  );

  const cancel = useCallback(() => {
    gen.current += 1;
    setPlanning(false);
    setScreen("entry");
  }, []);

  const refresh = useCallback(async () => {
    const token = ++gen.current;
    setPlanning(true);
    const feed = await loadDisruptions();
    if (token !== gen.current) return;
    if (path) {
      const next = evaluatePath(index, path, feed);
      setPlan(next);
      setLiftsTotal(next.liftsTotal);
      setLiftsChecked(next.liftsChecked);
    } else {
      await runPlan({ reusePath: false });
      return;
    }
    setPlanning(false);
  }, [loadDisruptions, path, index, runPlan]);

  const onExitSearch = useCallback(() => setActiveSlot(null), []);

  const onSelectStation = useCallback(
    (id: string) => {
      if (activeSlot === "from") {
        setFromId(id);
        setActiveSlot(toId ? null : "to");
      } else if (activeSlot === "to") {
        setToId(id);
        setActiveSlot(fromId ? null : "from");
      }
    },
    [activeSlot, fromId, toId],
  );

  const screenId =
    disruptionsOpen && disruptions?.ok
      ? "disruptions"
      : screen === "result" && from && to
        ? "result"
        : "entry";
  const [swap, setSwap] = useState({ id: screenId, direction: "fade" as SwapDirection });
  let direction = swap.direction;
  if (screenId !== swap.id) {
    direction = swapDirection(swap.id, screenId);
    setSwap({ id: screenId, direction });
  }

  return (
    <div
      className="loop mx-auto flex h-full min-h-0 w-full flex-col"
      style={{
        maxWidth: 430,
        background: loop.page,
        color: loop.text,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <ScreenSwap id={screenId} direction={direction}>
        {disruptionsOpen && disruptions?.ok ? (
          <DisruptionList
            index={index}
            disruptions={disruptions}
            onBack={() => setDisruptionsOpen(false)}
          />
        ) : screen === "result" && from && to ? (
          <PlanResult
            index={index}
            from={from}
            to={to}
            plan={plan}
            planning={planning}
            liftsChecked={liftsChecked}
            liftsTotal={liftsTotal}
            onBack={() => {
              cancel();
            }}
            onEdit={() => {
              gen.current += 1;
              setPlanning(false);
              setScreen("entry");
            }}
            onCancel={cancel}
            onRefresh={() => void refresh()}
            onReplanAvoiding={(stationId) => void runPlan({ exclude: [stationId] })}
            onPlanToAlternative={(stationId) => {
              setToId(stationId);
              void runPlan({ to: stationId });
            }}
            onPlanFromAlternative={(stationId) => {
              setFromId(stationId);
              void runPlan({ from: stationId });
            }}
            onPickDestination={() => {
              setScreen("entry");
              setActiveSlot("to");
            }}
            onPickOrigin={() => {
              setScreen("entry");
              setActiveSlot("from");
            }}
          />
        ) : (
          <RouteEntry
            index={index}
            from={from}
            to={to}
            disruptions={disruptions}
            activeSlot={activeSlot}
            onFocusSlot={setActiveSlot}
            onExitSearch={onExitSearch}
            onSelect={onSelectStation}
            onClearSlot={(slot) => {
              if (slot === "from") setFromId(null);
              else setToId(null);
            }}
            onSwap={() => {
              setFromId(toId);
              setToId(fromId);
            }}
            onPlan={() => void runPlan()}
            onOpenDisruptions={() => setDisruptionsOpen(true)}
          />
        )}
      </ScreenSwap>
    </div>
  );
}

function swapDirection(fromId: string, toId: string): SwapDirection {
  if (fromId === toId) return "fade";
  if (toId === "entry") return "back";
  return "forward";
}
