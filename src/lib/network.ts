import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { NetworkData } from "./types";

let cache: { mtimeMs: number; data: NetworkData } | null = null;

export async function loadNetwork(): Promise<NetworkData> {
  const filePath = path.join(process.cwd(), "data", "network.json");
  const { mtimeMs } = await stat(filePath);
  if (cache && cache.mtimeMs === mtimeMs) return cache.data;
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as NetworkData;
  parsed.rides ??= [];
  parsed.interchangeChains ??= [];
  cache = { mtimeMs, data: parsed };
  return cache.data;
}

export function clearNetworkCache() {
  cache = null;
}
