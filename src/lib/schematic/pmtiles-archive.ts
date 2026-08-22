/**
 * Server-side reader for the London PMTiles extract.
 * Node only — imports node:fs. Never import this from a client component.
 * Isolated from routing — do not import plan/status/topology.
 */

import { createHash } from "node:crypto";
import { open, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";

const FILE_PATH = path.join(process.cwd(), "data", "osm", "london.pmtiles");

/** Deepest zoom the tile id encoding supports. */
export const MAX_TILE_ZOOM = 26;

function versionOf(size: number, mtimeMs: number): string {
  return createHash("sha1")
    .update(`${size}:${mtimeMs}`)
    .digest("hex")
    .slice(0, 12);
}

/** Byte ranges straight off disk, so the client never range-fetches 143 MB. */
class ArchiveSource implements Source {
  private handle: Promise<FileHandle> | null = null;

  constructor(private readonly version: string) {}

  getKey() {
    return `${FILE_PATH}#${this.version}`;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.handle ??= open(FILE_PATH, "r");
    const fh = await this.handle;
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return {
      data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead),
      etag: this.version,
    };
  }

  async close() {
    const pending = this.handle;
    this.handle = null;
    if (pending) await (await pending).close();
  }
}

let current: { version: string; source: ArchiveSource; tiles: PMTiles } | null =
  null;

async function statArchive(): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(FILE_PATH);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Cache key for every tile URL. Null when the extract is absent. Changes
 * whenever it is rebuilt, which is what lets tiles be served `immutable`.
 */
export async function archiveVersion(): Promise<string | null> {
  const info = await statArchive();
  return info ? versionOf(info.size, info.mtimeMs) : null;
}

/** Reused across requests so the header and directory cache stay warm. */
async function archive(): Promise<PMTiles | null> {
  const version = await archiveVersion();
  const stale = current?.version === version ? null : current;
  if (stale) current = null;
  if (version == null) {
    void stale?.source.close().catch(() => {});
    return null;
  }
  if (current) return current.tiles;
  const source = new ArchiveSource(version);
  current = { version, source, tiles: new PMTiles(source) };
  void stale?.source.close().catch(() => {});
  return current.tiles;
}

/** Inflated MVT bytes, or null when the archive holds no such tile. */
export async function readTile(
  z: number,
  x: number,
  y: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const tiles = await archive();
  if (!tiles) return null;
  const result = await tiles.getZxy(z, x, y);
  if (!result) return null;
  return new Uint8Array(result.data);
}
