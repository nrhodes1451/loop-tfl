import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NetworkData } from "./types";

let cache: NetworkData | null = null;

export async function loadNetwork(): Promise<NetworkData> {
  if (cache) return cache;
  const filePath = path.join(process.cwd(), "data", "network.json");
  const raw = await readFile(filePath, "utf8");
  cache = JSON.parse(raw) as NetworkData;
  return cache;
}

export function clearNetworkCache() {
  cache = null;
}
