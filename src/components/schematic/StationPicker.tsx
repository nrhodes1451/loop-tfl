"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SchematicStationRef } from "@/lib/schematic/types";

export function StationPicker({
  currentId,
  stations,
}: {
  currentId: string;
  stations: SchematicStationRef[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = n
      ? stations.filter(
          (s) =>
            s.name.toLowerCase().includes(n) ||
            s.id.toLowerCase().includes(n),
        )
      : stations;
    if (!list.some((s) => s.id === currentId)) {
      const cur = stations.find((s) => s.id === currentId);
      return cur ? [cur, ...list] : list;
    }
    return list;
  }, [q, stations, currentId]);

  const control = {
    color: "#e8edf4",
    background: "rgba(12, 14, 18, 0.82)",
    border: "1px solid #2a313c",
  } as const;

  return (
    <div className="flex min-w-0 max-w-[min(100%,24rem)] flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor="schematic-station-filter">
        Filter stations
      </label>
      <input
        id="schematic-station-filter"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter stations"
        className="min-w-[8rem] flex-1 rounded-[7px] px-2 py-1.5 font-[family-name:var(--font-ibm-plex-mono)] text-[12px] outline-none sm:text-[12.5px]"
        style={control}
      />
      <label className="sr-only" htmlFor="schematic-station">
        Station
      </label>
      <select
        id="schematic-station"
        value={currentId}
        onChange={(e) =>
          router.push(`/schematic/${encodeURIComponent(e.target.value)}`)
        }
        className="min-w-[10rem] flex-[2] cursor-pointer rounded-[7px] px-2 py-1.5 text-[12px] outline-none sm:text-[12.5px]"
        style={control}
      >
        {filtered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
