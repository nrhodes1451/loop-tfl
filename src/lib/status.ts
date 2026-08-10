import type {
  DisruptionPayload,
  LiftStatus,
  NetworkData,
  NetworkPlatform,
  NetworkStation,
  PlatformAccess,
} from "./types";

/** Legacy data has no `access`; anything unrecognised means no step-free route. */
export function platformAccess(
  platformId: string,
  network: NetworkData,
): PlatformAccess {
  const chain = network.platformLiftChains.find((c) => c.platformId === platformId);
  if (chain?.access === "level" || chain?.access === "lifts") return chain.access;
  return "none";
}

export function platformStatus(
  platformId: string,
  network: NetworkData,
  disruptions: DisruptionPayload | null,
): LiftStatus {
  const access = platformAccess(platformId, network);
  if (access === "none") return "none";
  if (access === "level") return "ok";

  if (!disruptions || !disruptions.ok) return "unknown";

  const chain = network.platformLiftChains.find((c) => c.platformId === platformId);
  for (const liftId of chain?.liftIds ?? []) {
    if (disruptions.byLiftId[liftId]) return "bad";
  }
  return "ok";
}

export function stationAggregateStatus(
  stationId: string,
  network: NetworkData,
  disruptions: DisruptionPayload | null,
): LiftStatus {
  const platforms = network.platforms.filter((p) => p.stationId === stationId);
  if (platforms.length === 0) {
    // Station in graph but no topology platforms — treat as unknown infrastructure detail
    const lifts = network.lifts.filter((l) => l.stationId === stationId);
    if (lifts.length === 0) return "none";
    if (!disruptions || !disruptions.ok) return "unknown";
    return lifts.some((l) => disruptions.byLiftId[l.id]) ? "bad" : "ok";
  }

  const statuses = platforms.map((p) => platformStatus(p.id, network, disruptions));
  if (statuses.some((s) => s === "bad")) return "bad";
  if (statuses.every((s) => s === "none")) return "none";
  // Some platforms step-free, others not (e.g. one direction only).
  if (statuses.some((s) => s === "ok") && statuses.some((s) => s === "none")) {
    return "partial";
  }
  if (statuses.some((s) => s === "unknown")) return "unknown";
  return "ok";
}

export function statusLabel(status: LiftStatus): string {
  switch (status) {
    case "ok":
      return "Step-free";
    case "partial":
      return "Partial";
    case "bad":
      return "Blocked";
    case "unknown":
      return "Unknown";
    case "none":
      return "No route";
  }
}

export function statusColor(status: LiftStatus): string {
  switch (status) {
    case "ok":
    case "partial":
      return "#35c77b";
    case "bad":
      return "#f2565c";
    case "unknown":
      return "#5f6672";
    case "none":
      return "#576070";
  }
}

export function workingPlatformCount(
  stationId: string,
  network: NetworkData,
  disruptions: DisruptionPayload | null,
): { total: number; working: number } {
  const platforms = network.platforms.filter((p) => p.stationId === stationId);
  const working = platforms.filter(
    (p) => platformStatus(p.id, network, disruptions) === "ok",
  ).length;
  return { total: platforms.length, working };
}

export function disruptedStations(
  network: NetworkData,
  disruptions: DisruptionPayload | null,
): { station: NetworkStation; count: number }[] {
  if (!disruptions?.ok) return [];

  const out: { station: NetworkStation; count: number }[] = [];
  for (const station of network.stations) {
    const liftIds = new Set(
      network.lifts.filter((l) => l.stationId === station.id).map((l) => l.id),
    );
    // Also count lifts on platform chains for this station
    for (const p of network.platforms.filter((x) => x.stationId === station.id)) {
      const chain = network.platformLiftChains.find((c) => c.platformId === p.id);
      chain?.liftIds.forEach((id) => liftIds.add(id));
    }
    let count = 0;
    for (const id of liftIds) {
      if (disruptions.byLiftId[id]) count += 1;
    }
    if (count > 0 || stationAggregateStatus(station.id, network, disruptions) === "bad") {
      if (count === 0) {
        // Aggregate bad from chain even if lift stationId mapping differs
        count = 1;
      }
      out.push({ station, count });
    }
  }
  out.sort((a, b) => b.count - a.count || a.station.name.localeCompare(b.station.name));
  return out;
}

export function platformSubLabel(
  platform: NetworkPlatform,
  network: NetworkData,
): string {
  const access = platformAccess(platform.id, network);
  if (access === "none") return "no lift route";
  if (access === "level") return "level or ramp access";
  const chain = network.platformLiftChains.find((c) => c.platformId === platform.id);
  const count = chain?.liftIds.length ?? 0;
  if (count === 1) return "1 lift to concourse";
  return `${count} lifts in sequence`;
}
