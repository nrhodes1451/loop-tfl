import { describe, expect, it } from "vitest";
import {
  platformStatus,
  stationAggregateStatus,
} from "./status";
import type { DisruptionPayload, NetworkData } from "./types";

const network: NetworkData = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  lines: [{ id: "victoria", name: "Victoria", color: "#0098D4", mode: "tube" }],
  stations: [
    { id: "S1", name: "Alpha", lat: 51.5, lon: -0.1, lineIds: ["victoria"] },
  ],
  edges: [],
  platforms: [
    {
      id: "p1",
      stationId: "S1",
      lineId: "victoria",
      direction: "N",
      label: "Victoria northbound",
    },
    {
      id: "p2",
      stationId: "S1",
      lineId: "victoria",
      direction: "S",
      label: "Victoria southbound",
    },
  ],
  lifts: [
    {
      id: "L1",
      stationId: "S1",
      name: "Lift A",
      fromAreas: [],
      toAreas: [],
    },
  ],
  platformLiftChains: [
    { platformId: "p1", liftIds: ["L1"], access: "lifts" },
    { platformId: "p2", liftIds: [], access: "none" },
    { platformId: "p3", liftIds: [], access: "level" },
    // Legacy shape: pre-`access` data used [] for unreachable platforms.
    { platformId: "p4", liftIds: [] },
  ],
};

const okFeed: DisruptionPayload = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  byLiftId: {},
  byStationId: {},
  ok: true,
};

describe("status derivation", () => {
  it("marks no-route platforms as none", () => {
    expect(platformStatus("p2", network, okFeed)).toBe("none");
  });

  it("marks level/ramp platforms as ok", () => {
    expect(platformStatus("p3", network, okFeed)).toBe("ok");
  });

  it("treats chains without an access field as no route", () => {
    expect(platformStatus("p4", network, okFeed)).toBe("none");
  });

  it("treats unknown platforms as no route", () => {
    expect(platformStatus("nope", network, okFeed)).toBe("none");
  });

  it("marks working chain as ok when feed is healthy", () => {
    expect(platformStatus("p1", network, okFeed)).toBe("ok");
  });

  it("marks bad when any lift in chain is disrupted", () => {
    const bad: DisruptionPayload = {
      ...okFeed,
      byLiftId: { L1: "Out of service" },
    };
    expect(platformStatus("p1", network, bad)).toBe("bad");
    expect(stationAggregateStatus("S1", network, bad)).toBe("bad");
  });

  it("uses unknown when feed failed", () => {
    const fail: DisruptionPayload = {
      updatedAt: "",
      byLiftId: {},
      byStationId: {},
      ok: false,
      error: "down",
    };
    expect(platformStatus("p1", network, fail)).toBe("unknown");
  });

  it("station aggregate prefers bad over none", () => {
    const bad: DisruptionPayload = {
      ...okFeed,
      byLiftId: { L1: "x" },
    };
    expect(stationAggregateStatus("S1", network, bad)).toBe("bad");
  });
});
