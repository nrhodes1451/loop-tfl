import { describe, expect, it } from "vitest";
import {
  evaluatePath,
  findStructuralPath,
  groupDisruptedLifts,
  indexNetwork,
  listDisruptedLifts,
  nearestStepFree,
  planJourney,
  STALE_MS,
} from "./plan";
import type { DisruptionPayload, NetworkData } from "./types";

function plat(
  id: string,
  stationId: string,
  lineId: string,
  direction: string,
): NetworkData["platforms"][number] {
  return {
    id,
    stationId,
    lineId,
    direction,
    label: `${lineId} ${direction}`,
  };
}

function lift(id: string, stationId: string, name: string): NetworkData["lifts"][number] {
  return {
    id,
    stationId,
    name,
    fromAreas: [],
    toAreas: [],
    platformIds: [],
  };
}

/**
 * A --victoria--> B --victoria--> C
 * B --jubilee--> E
 * A --piccadilly--> G --piccadilly--> D (D has no street access)
 *
 * Interchange at B: victoria south → jubilee east via Lift-X
 */
const network: NetworkData = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  lines: [
    { id: "victoria", name: "Victoria", color: "#0098D4", mode: "tube" },
    { id: "jubilee", name: "Jubilee", color: "#A0A5A9", mode: "tube" },
    { id: "piccadilly", name: "Piccadilly", color: "#003688", mode: "tube" },
  ],
  stations: [
    { id: "A", name: "Alpha", lat: 51.5, lon: -0.1, lineIds: ["victoria", "piccadilly"] },
    { id: "B", name: "Bravo", lat: 51.5, lon: -0.12, lineIds: ["victoria", "jubilee"] },
    { id: "C", name: "Charlie", lat: 51.5, lon: -0.14, lineIds: ["victoria"] },
    { id: "D", name: "Delta", lat: 51.5, lon: -0.16, lineIds: ["piccadilly"] },
    { id: "E", name: "Echo", lat: 51.501, lon: -0.161, lineIds: ["jubilee"] },
    { id: "G", name: "Golf", lat: 51.5, lon: -0.13, lineIds: ["piccadilly"] },
  ],
  edges: [],
  rides: [
    { from: "A", to: "B", lineId: "victoria" },
    { from: "B", to: "C", lineId: "victoria" },
    { from: "B", to: "A", lineId: "victoria" },
    { from: "C", to: "B", lineId: "victoria" },
    { from: "B", to: "E", lineId: "jubilee" },
    { from: "E", to: "B", lineId: "jubilee" },
    { from: "A", to: "G", lineId: "piccadilly" },
    { from: "G", to: "D", lineId: "piccadilly" },
    { from: "G", to: "A", lineId: "piccadilly" },
    { from: "D", to: "G", lineId: "piccadilly" },
  ],
  platforms: [
    plat("A-v-s", "A", "victoria", "south"),
    plat("A-p-s", "A", "piccadilly", "east"),
    plat("B-v-s", "B", "victoria", "south"),
    plat("B-v-n", "B", "victoria", "north"),
    plat("B-j-e", "B", "jubilee", "east"),
    plat("C-v-s", "C", "victoria", "south"),
    plat("D-p-e", "D", "piccadilly", "east"),
    plat("E-j-e", "E", "jubilee", "east"),
    plat("G-p-e", "G", "piccadilly", "east"),
  ],
  lifts: [
    lift("L-A", "A", "Lift A"),
    lift("L-A-x", "A", "Lift AX"),
    lift("L-B-street", "B", "Lift B street"),
    lift("L-X", "B", "Lift X"),
    lift("L-C", "C", "Lift C"),
    lift("L-C2", "C", "Lift C2"),
    lift("L-A2", "A", "Lift A2"),
    lift("L-E", "E", "Lift E"),
  ],
  platformLiftChains: [
    { platformId: "A-v-s", liftIds: ["L-A", "L-A-x"], access: "lifts" },
    { platformId: "A-p-s", liftIds: ["L-A2"], access: "lifts" },
    { platformId: "B-v-s", liftIds: ["L-B-street"], access: "lifts" },
    { platformId: "B-v-n", liftIds: ["L-B-street"], access: "lifts" },
    { platformId: "B-j-e", liftIds: ["L-X"], access: "lifts" },
    { platformId: "C-v-s", liftIds: ["L-C", "L-C2"], access: "lifts" },
    { platformId: "D-p-e", liftIds: [], access: "none" },
    { platformId: "E-j-e", liftIds: ["L-E"], access: "lifts" },
    { platformId: "G-p-e", liftIds: [], access: "level" },
  ],
  interchangeChains: [
    {
      fromPlatformId: "B-v-s",
      toPlatformId: "B-j-e",
      liftIds: ["L-X"],
      access: "lifts",
    },
    {
      fromPlatformId: "B-j-e",
      toPlatformId: "B-v-s",
      liftIds: ["L-X"],
      access: "lifts",
    },
  ],
};

const okFeed: DisruptionPayload = {
  updatedAt: "2026-08-12T09:40:00.000Z",
  byLiftId: {},
  byStationId: {},
  ok: true,
};

const NOW = Date.parse("2026-08-12T09:41:00.000Z");

describe("findStructuralPath", () => {
  const index = indexNetwork(network);

  it("finds a same-line path and does not require pass-through street lifts", () => {
    const path = findStructuralPath(index, "A", "C");
    expect(path).not.toBeNull();
    expect(path!.destUnreachable).toBe(false);
    expect(path!.nodes[0]!.event.kind).toBe("board");
    expect(path!.nodes.some((n) => n.event.kind === "change")).toBe(false);
    const result = evaluatePath(index, path!, okFeed, NOW);
    const liftIds = result.legs.flatMap((l) => l.liftIds);
    expect(liftIds).toContain("L-A");
    expect(liftIds).toContain("L-A-x");
    expect(liftIds).toContain("L-C");
    expect(liftIds).toContain("L-C2");
    expect(liftIds).not.toContain("L-B-street");
    expect(result.status).toBe("ok");
    expect(result.legs.map((l) => l.kind)).toEqual([
      "start",
      "lift",
      "lift",
      "ride",
      "lift",
      "lift",
      "arrive",
    ]);
    expect(result.legs[0]).toMatchObject({
      title: "Start · street level at Alpha",
      fromNode: { type: "street" },
      toNode: { type: "lift" },
    });
    expect(result.legs[1]).toMatchObject({
      kind: "lift",
      title: "Lift AX.",
      liftIds: ["L-A-x"],
      fromNode: { type: "lift" },
      toNode: { type: "lift" },
    });
    expect(result.legs[2]).toMatchObject({
      kind: "lift",
      title: "Lift A to Victoria south platform.",
      liftIds: ["L-A"],
      fromNode: { type: "lift" },
      toNode: { type: "line", lineId: "victoria" },
    });
    expect(result.legs[3]).toMatchObject({
      kind: "ride",
      title: "Take the Victoria to Charlie",
      detail: "2 stops through Bravo.",
      fromNode: { type: "line", lineId: "victoria" },
      toNode: { type: "line", lineId: "victoria" },
    });
    expect(result.legs[4]).toMatchObject({
      kind: "lift",
      title: "Lift C.",
      liftIds: ["L-C"],
      fromNode: { type: "lift" },
      toNode: { type: "lift" },
    });
    expect(result.legs[5]).toMatchObject({
      kind: "lift",
      title: "Lift C2 to street.",
      liftIds: ["L-C2"],
      fromNode: { type: "lift" },
      toNode: { type: "lift" },
    });
    expect(result.legs[6]).toMatchObject({
      kind: "arrive",
      title: "Arrive · street level at Charlie",
      fromNode: { type: "street" },
      toNode: { type: "street" },
    });
  });

  it("uses an interchange chain when changing lines", () => {
    const path = findStructuralPath(index, "A", "E");
    expect(path).not.toBeNull();
    const change = path!.nodes.find((n) => n.event.kind === "change");
    expect(change?.event).toMatchObject({ kind: "change", liftIds: ["L-X"] });
  });

  it("marks destUnreachable when the destination has no street access", () => {
    const path = findStructuralPath(index, "A", "D");
    expect(path).not.toBeNull();
    expect(path!.destUnreachable).toBe(true);
  });

  it("returns null when the interchange station is excluded", () => {
    const path = findStructuralPath(index, "A", "E", ["B"]);
    expect(path).toBeNull();
  });

  it("returns null for the same station", () => {
    expect(findStructuralPath(index, "A", "A")).toBeNull();
  });
});

describe("evaluatePath / planJourney", () => {
  const index = indexNetwork(network);

  it("breaks at an interchange when its lift is disrupted", () => {
    const feed: DisruptionPayload = {
      ...okFeed,
      byLiftId: { "L-X": "Lift X out of service since 06:12" },
    };
    const result = planJourney(index, "A", "E", feed, { now: NOW });
    expect(result.status).toBe("break");
    expect(result.breakAt).toBe("B");
    const broken = result.legs.find((l) => l.status === "broken" && l.kind === "lift");
    expect(broken?.liftIds).toContain("L-X");
    expect(result.legs.some((l) => l.kind === "unreachable")).toBe(true);
  });

  it("offers a nearby alternative when the destination lift is out", () => {
    const feed: DisruptionPayload = {
      ...okFeed,
      byLiftId: { "L-C": "Lift C unavailable" },
    };
    const result = planJourney(index, "A", "C", feed, { now: NOW });
    expect(result.status).toBe("break");
    expect(result.breakAt).toBe("C");
    expect(result.alternative?.stationId).toBe("G");
    expect(result.alternative?.distanceM).toBeGreaterThan(0);
  });

  it("does not treat a pass-through station lift outage as a break", () => {
    const feed: DisruptionPayload = {
      ...okFeed,
      byLiftId: { "L-B-street": "street lift out" },
    };
    const result = planJourney(index, "A", "C", feed, { now: NOW });
    expect(result.status).toBe("ok");
  });

  it("returns none with a nearby step-free alternative", () => {
    const result = planJourney(index, "A", "D", okFeed, { now: NOW });
    expect(result.status).toBe("none");
    expect(result.noneAt).toBe("to");
    expect(result.legs.at(-1)).toMatchObject({
      kind: "arrive",
      status: "none",
      title: "Delta · no street↔platform step-free access",
    });
    expect(result.alternative?.stationId).toBe("E");
    expect(result.alternative?.distanceM).toBeGreaterThan(0);
  });

  it("blames the origin when the start station has no street access", () => {
    const result = planJourney(index, "D", "A", okFeed, { now: NOW });
    expect(result.status).toBe("none");
    expect(result.noneAt).toBe("from");
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toMatchObject({
      kind: "start",
      status: "none",
      title: "Delta · no street↔platform step-free access",
    });
    expect(result.alternative?.stationId).toBe("E");
  });

  it("does not blame the destination when stations are disconnected", () => {
    const result = planJourney(index, "A", "E", okFeed, {
      now: NOW,
      excludeStationIds: ["B"],
    });
    expect(result.status).toBe("none");
    expect(result.noneAt).toBeUndefined();
    expect(result.legs).toEqual([]);
  });

  it("downgrades to uncertain when the live feed is down", () => {
    const fail: DisruptionPayload = {
      updatedAt: "",
      byLiftId: {},
      byStationId: {},
      ok: false,
      error: "down",
    };
    const result = planJourney(index, "A", "C", fail, { now: NOW });
    expect(result.status).toBe("uncertain");
    expect(result.legs.some((l) => l.status === "unknown")).toBe(true);
  });

  it("downgrades to uncertain when the snapshot is stale", () => {
    const stale: DisruptionPayload = {
      ...okFeed,
      updatedAt: new Date(NOW - STALE_MS - 1000).toISOString(),
    };
    const result = planJourney(index, "A", "C", stale, { now: NOW });
    expect(result.status).toBe("uncertain");
  });

  it("nearestStepFree skips the destination itself", () => {
    const alt = nearestStepFree(index, "D");
    expect(alt?.stationId).not.toBe("D");
    expect(alt?.stationId).toBe("E");
  });

  it("splits interchange into a change step plus a lift step", () => {
    const result = planJourney(index, "A", "E", okFeed, { now: NOW });
    expect(result.legs.map((l) => l.kind)).toEqual([
      "start",
      "lift",
      "lift",
      "ride",
      "change",
      "lift",
      "ride",
      "lift",
      "arrive",
    ]);
    const change = result.legs.find((l) => l.kind === "change");
    expect(change).toMatchObject({
      title: "Change at Bravo · to Jubilee",
      fromNode: { type: "line", lineId: "victoria" },
      toNode: { type: "lift" },
    });
    const changeLift = result.legs.find((l) => l.kind === "lift" && l.liftIds.includes("L-X"));
    expect(changeLift).toMatchObject({
      title: "Lift X to Jubilee east platform.",
      fromNode: { type: "lift" },
      toNode: { type: "line", lineId: "jubilee" },
    });
    const secondRide = result.legs.filter((l) => l.kind === "ride")[1];
    expect(secondRide?.title).toBe("Take the Jubilee to Echo");
  });

  it("omits lift legs for level or ramp access", () => {
    const toGolf = planJourney(index, "A", "G", okFeed, { now: NOW });
    expect(toGolf.legs.at(-1)).toMatchObject({
      kind: "arrive",
      title: "Arrive · street level at Golf",
      fromNode: { type: "line", lineId: "piccadilly" },
      toNode: { type: "street" },
    });
    expect(toGolf.legs.some((l) => l.kind === "lift" && l.title.includes("to street"))).toBe(
      false,
    );

    const fromGolf = planJourney(index, "G", "A", okFeed, { now: NOW });
    expect(fromGolf.legs[0]).toMatchObject({
      kind: "start",
      fromNode: { type: "street" },
      toNode: { type: "line", lineId: "piccadilly" },
    });
    expect(fromGolf.legs[1]?.kind).not.toBe("lift");
  });
});

describe("listDisruptedLifts", () => {
  const index = indexNetwork(network);

  it("lists every outage with station, lift name, and TfL message", () => {
    const feed: DisruptionPayload = {
      ...okFeed,
      byLiftId: {
        "L-X": "Lift X out of service since 06:12",
        "L-C": "Lift C unavailable",
      },
      byStationId: { B: ["L-X"], C: ["L-C"] },
    };
    const rows = listDisruptedLifts(index, feed);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.liftId).sort()).toEqual(["L-C", "L-X"]);
    const x = rows.find((r) => r.liftId === "L-X");
    expect(x).toMatchObject({
      liftName: "Lift X",
      stationName: "Bravo",
      message: "Lift X out of service since 06:12",
    });
    const groups = groupDisruptedLifts(rows);
    expect(groups.map((g) => g.stationName)).toEqual(["Bravo", "Charlie"]);
  });

  it("keeps unmatched lift ids instead of dropping them", () => {
    const feed: DisruptionPayload = {
      ...okFeed,
      byLiftId: { "missing-lift": "Closed for repair" },
      byStationId: {},
    };
    const rows = listDisruptedLifts(index, feed);
    expect(rows).toEqual([
      {
        liftId: "missing-lift",
        liftName: "Lift",
        stationId: undefined,
        stationName: "Unknown station",
        message: "Closed for repair",
      },
    ]);
  });
});
