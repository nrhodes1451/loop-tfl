export type LiftStatus = "ok" | "bad" | "unknown" | "none";

export type NetworkLine = {
  id: string;
  name: string;
  color: string;
  mode: string;
};

export type NetworkStation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lineIds: string[];
};

export type NetworkEdge = {
  from: string;
  to: string;
  lineId: string;
};

export type NetworkPlatform = {
  id: string;
  stationId: string;
  lineId: string;
  direction: string;
  label: string;
};

export type NetworkLift = {
  id: string;
  stationId: string;
  name: string;
  fromAreas: string[];
  toAreas: string[];
};

export type PlatformLiftChain = {
  platformId: string;
  liftIds: string[];
};

export type NetworkData = {
  generatedAt: string;
  lines: NetworkLine[];
  stations: NetworkStation[];
  edges: NetworkEdge[];
  platforms: NetworkPlatform[];
  lifts: NetworkLift[];
  platformLiftChains: PlatformLiftChain[];
};

export type DisruptionPayload = {
  updatedAt: string;
  byLiftId: Record<string, string>;
  byStationId: Record<string, string[]>;
  ok: boolean;
  error?: string;
};
