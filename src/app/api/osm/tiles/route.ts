import { archiveVersion } from "@/lib/schematic/pmtiles-archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Availability probe and cache key for the tile URLs. Never cached, so a
 * redeploy with a rebuilt extract is picked up on the next page load.
 */
export async function GET() {
  const version = await archiveVersion();
  if (version == null) {
    return Response.json(
      { error: "No PMTiles extract" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
