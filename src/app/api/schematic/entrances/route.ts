import { loadEntranceOverlay } from "@/lib/schematic/load";

export const runtime = "nodejs";

export async function GET() {
  const overlay = await loadEntranceOverlay();
  if (!overlay) {
    return Response.json(
      { error: "No entrance overlay" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(overlay, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
