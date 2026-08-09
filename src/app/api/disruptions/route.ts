import { tflFetch, type TflLiftDisruptionV2 } from "@/lib/tfl/client";
import type { DisruptionPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;

let cached: { at: number; payload: DisruptionPayload } | null = null;

function empty(error: string): DisruptionPayload {
  return {
    updatedAt: new Date().toISOString(),
    byLiftId: {},
    byStationId: {},
    ok: false,
    error,
  };
}

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return Response.json(cached.payload);
  }

  try {
    const rows = await tflFetch<TflLiftDisruptionV2[]>("/Disruptions/Lifts/v2");
    const byLiftId: Record<string, string> = {};
    const byStationId: Record<string, string[]> = {};

    for (const row of rows) {
      const stationId = (row.stationUniqueId ?? "").trim();
      const message = row.message ?? "";
      const ids = (row.disruptedLiftUniqueIds ?? []).map((id) => id.trim());
      if (stationId) {
        byStationId[stationId] = [...(byStationId[stationId] ?? []), ...ids];
      }
      for (const id of ids) {
        if (!id) continue;
        byLiftId[id] = message;
      }
    }

    const payload: DisruptionPayload = {
      updatedAt: new Date().toISOString(),
      byLiftId,
      byStationId,
      ok: true,
    };
    cached = { at: Date.now(), payload };
    return Response.json(payload);
  } catch (err) {
    const payload = empty((err as Error).message);
    // Cache errors briefly so we don't hammer a failing endpoint
    cached = { at: Date.now(), payload };
    return Response.json(payload, { status: 502 });
  }
}
