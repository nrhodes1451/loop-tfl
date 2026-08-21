import {
  loadSchematic,
  SchematicNotFoundError,
} from "@/lib/schematic/load";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ stationId: string }> },
) {
  const { stationId: raw } = await context.params;
  const stationId = decodeURIComponent(raw);
  try {
    const station = await loadSchematic(stationId);
    return Response.json(station, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    if (err instanceof SchematicNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
