const BASE = "https://api.tfl.gov.uk";

export function tflUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const key = process.env.TFL_APP_KEY;
  if (key) url.searchParams.set("app_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export async function tflFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(tflUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`TfL ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export type TflLine = {
  id: string;
  name: string;
  modeName: string;
};

export type TflStopPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  parentId?: string;
  stationId?: string;
  topMostParentId?: string;
};

export type TflStopPointSequence = {
  lineId: string;
  direction: string;
  branchId: number;
  stopPoint: TflStopPoint[];
};

export type TflRouteSequence = {
  lineId: string;
  lineName: string;
  mode: string;
  stopPointSequences: TflStopPointSequence[];
  stations: TflStopPoint[];
};

export type TflLiftDisruptionV2 = {
  stationUniqueId: string;
  disruptedLiftUniqueIds: string[];
  message: string;
};
