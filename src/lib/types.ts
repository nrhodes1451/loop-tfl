export type LiftStatus = "ok" | "partial" | "bad" | "unknown" | "none";

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
  /** Physical/composite platform ids same-level adjacent to this lift's areas. */
  platformIds: string[];
};

export type PlatformAccess = "lifts" | "level" | "none";

export type PlatformLiftChain = {
  platformId: string;
  /** Ordered lifts platform→street; empty unless `access` is `"lifts"`. */
  liftIds: string[];
  /** Absent in legacy data — consumers must treat missing as `"none"`. */
  access?: PlatformAccess;
};

/** Directed hop from Route/Sequence order. `lineId` is normalised to match platforms. */
export type NetworkRide = {
  from: string;
  to: string;
  lineId: string;
};

/** Step-free path between two service platforms on different lines at one station. */
export type InterchangeChain = {
  fromPlatformId: string;
  toPlatformId: string;
  /** Ordered lifts from → to; empty when `access` is `"level"`. */
  liftIds: string[];
  access: "lifts" | "level";
};

export type NetworkData = {
  generatedAt: string;
  lines: NetworkLine[];
  stations: NetworkStation[];
  edges: NetworkEdge[];
  rides: NetworkRide[];
  platforms: NetworkPlatform[];
  lifts: NetworkLift[];
  platformLiftChains: PlatformLiftChain[];
  interchangeChains: InterchangeChain[];
};

export type DisruptionPayload = {
  updatedAt: string;
  byLiftId: Record<string, string>;
  byStationId: Record<string, string[]>;
  ok: boolean;
  error?: string;
};
