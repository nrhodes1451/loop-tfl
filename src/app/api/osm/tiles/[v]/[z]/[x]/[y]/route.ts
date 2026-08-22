import { gzipSync } from "node:zlib";
import { MAX_TILE_ZOOM, readTile } from "@/lib/schematic/pmtiles-archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPE = "application/vnd.mapbox-vector-tile";
/**
 * `v` is the archive version, so a URL always names the same bytes and the
 * client never revalidates. It is a cache key only, never checked against the
 * current archive — a tab opened before a redeploy keeps working.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

function tileInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ v: string; z: string; x: string; y: string }> },
) {
  const params = await context.params;
  const z = tileInt(params.z);
  const x = tileInt(params.x);
  const y = tileInt(params.y);
  if (z == null || x == null || y == null || z > MAX_TILE_ZOOM) {
    return new Response("Bad tile coordinates", { status: 400 });
  }
  const span = 2 ** z;
  if (x >= span || y >= span) {
    return new Response("Tile outside zoom bounds", { status: 400 });
  }

  const etag = `"${params.v}/${z}/${x}/${y}"`;
  const bytes = await readTile(z, x, y);
  if (!bytes) {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": IMMUTABLE, ETag: etag },
    });
  }

  const headers = new Headers({
    "Cache-Control": IMMUTABLE,
    "Content-Type": CONTENT_TYPE,
    ETag: etag,
    Vary: "Accept-Encoding",
  });
  // Next does not compress this content type, and an MVT still halves.
  if (request.headers.get("accept-encoding")?.includes("gzip")) {
    const gz = gzipSync(bytes);
    headers.set("Content-Encoding", "gzip");
    return new Response(new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength), {
      headers,
    });
  }
  return new Response(bytes, { headers });
}
