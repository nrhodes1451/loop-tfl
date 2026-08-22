import { loadLineNetwork } from "@/lib/schematic/load";

export const runtime = "nodejs";

export async function GET() {
  const network = await loadLineNetwork();
  return Response.json(network, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
