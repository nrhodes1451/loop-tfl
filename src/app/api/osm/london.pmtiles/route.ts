import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE_PATH = path.join(process.cwd(), "data", "osm", "london.pmtiles");
const CONTENT_TYPE = "application/vnd.pmtiles";

function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return "unsatisfiable";
  const startRaw = m[1]!;
  const endRaw = m[2]!;
  if (startRaw === "" && endRaw === "") return "unsatisfiable";
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return "unsatisfiable";
  }
  const end =
    endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end };
}

async function fileSize(): Promise<number | null> {
  try {
    return (await stat(FILE_PATH)).size;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function streamRange(start: number, end: number): ReadableStream {
  const node = createReadStream(FILE_PATH, { start, end });
  return Readable.toWeb(node) as ReadableStream;
}

export async function HEAD() {
  const size = await fileSize();
  if (size == null) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Content-Type": CONTENT_TYPE,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function GET(request: Request) {
  const size = await fileSize();
  if (size == null) return new Response("Not found", { status: 404 });

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (!range) {
    return new Response(streamRange(0, size - 1), {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
        "Content-Type": CONTENT_TYPE,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const length = range.end - range.start + 1;
  return new Response(streamRange(range.start, range.end), {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(length),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Type": CONTENT_TYPE,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
