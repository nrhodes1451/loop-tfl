"use client";

import { useRouter } from "next/navigation";
import type { SchematicStationRef } from "@/lib/schematic/types";

export function StationPicker({
  currentId,
  stations,
}: {
  currentId: string;
  stations: SchematicStationRef[];
}) {
  const router = useRouter();

  return (
    <div className="min-w-0 max-w-[min(100%,24rem)]">
      <label className="sr-only" htmlFor="schematic-station">
        Station
      </label>
      <select
        id="schematic-station"
        value={currentId}
        onChange={(e) =>
          router.push(`/schematic/${encodeURIComponent(e.target.value)}`)
        }
        className="w-full min-w-[10rem] cursor-pointer rounded-[7px] px-2 py-1.5 text-[12px] outline-none sm:text-[12.5px]"
        style={{
          color: "#e8edf4",
          background: "rgba(12, 14, 18, 0.82)",
          border: "1px solid #2a313c",
        }}
      >
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
