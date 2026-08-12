"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluatePath,
  findStructuralPath,
  indexNetwork,
  nearestStepFree,
  STALE_MS,
  type PlanResult as PlanView,
  type StructuralPath,
} from "@/lib/plan";
import type { DisruptionPayload, NetworkData } from "@/lib/types";
import { loop } from "@/lib/tokens";
import { DisruptionList } from "./DisruptionList";
import { PlanResult } from "./PlanResult";
import { RouteEntry } from "./RouteEntry";
import { StationPicker } from "./StationPicker";

const POLL_MS = 60_000;

export function PlannerShell({ network }: { network: NetworkData }) {
  const index = useMemo(() => indexNetwork(network), [network]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<"from" | "to" | null>(null);
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
        const alt = nearestStepFree(index, dest);
        setPlan({
          status: "none",
          legs: [],
          liftsChecked: 0,
          liftsTotal: 0,
          alternative: alt ?? undefined,
        });
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

  const onSelectStation = useCallback(
    (id: string) => {
      if (pickerOpen === "from") {
        setFromId(id);
        setPickerOpen(toId ? null : "to");
      } else if (pickerOpen === "to") {
        setToId(id);
        setPickerOpen(fromId ? null : "from");
      }
    },
    [pickerOpen, fromId, toId],
  );

  return (
    <div
      className="loop mx-auto flex min-h-full w-full flex-col"
      style={{
        maxWidth: 430,
        background: loop.page,
        color: loop.text,
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {pickerOpen ? (
        <StationPicker
          key={pickerOpen}
          index={index}
          disruptions={disruptions}
          slot={pickerOpen}
          onSelect={onSelectStation}
          onBack={() => setPickerOpen(null)}
        />
      ) : disruptionsOpen && disruptions?.ok ? (
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
          onPickDestination={() => {
            setScreen("entry");
            setPickerOpen("to");
          }}
        />
      ) : (
        <RouteEntry
          index={index}
          from={from}
          to={to}
          disruptions={disruptions}
          onOpenPicker={setPickerOpen}
          onSwap={() => {
            setFromId(toId);
            setToId(fromId);
          }}
          onPlan={() => void runPlan()}
          onOpenDisruptions={() => setDisruptionsOpen(true)}
        />
      )}
    </div>
  );
}
