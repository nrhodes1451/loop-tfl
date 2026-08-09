import { describe, expect, it } from "vitest";
import {
  buildAdjacency,
  buildTopology,
  findLiftChain,
  type TopologyInputs,
} from "./topology";

describe("findLiftChain", () => {
  it("returns empty chain for same-level only path", () => {
    const adjacency = new Map([
      ["OUT", [{ to: "A" }]],
      ["A", [{ to: "PLAT" }]],
    ]);
    expect(findLiftChain("OUT", "PLAT", adjacency)).toEqual([]);
  });

  it("collects lifts in series", () => {
    const adjacency = new Map([
      ["OUT", [{ to: "L1A", liftId: "Lift-1" }]],
      ["L1A", [{ to: "OUT", liftId: "Lift-1" }, { to: "MID" }]],
      ["MID", [{ to: "L1A" }, { to: "L2A", liftId: "Lift-2" }]],
      ["L2A", [{ to: "MID", liftId: "Lift-2" }, { to: "PLAT" }]],
      ["PLAT", [{ to: "L2A" }]],
    ]);
    expect(findLiftChain("OUT", "PLAT", adjacency)).toEqual([
      "Lift-1",
      "Lift-2",
    ]);
  });

  it("returns null when unreachable", () => {
    const adjacency = new Map([["OUT", [{ to: "A" }]]]);
    expect(findLiftChain("OUT", "PLAT", adjacency)).toBeNull();
  });
});

describe("buildTopology", () => {
  const inputs: TopologyInputs = {
    stations: [
      {
        UniqueId: "HUBTEST",
        Name: "Test Station",
        OutsideStationUniqueId: "HUBTEST-Outside",
      },
    ],
    platforms: [
      {
        UniqueId: "HUBTEST-Plat01",
        StationUniqueId: "HUBTEST",
        FriendlyName: "Northbound Platform 1",
        CardinalDirection: "Northbound",
      },
      {
        UniqueId: "HUBTEST-Plat02",
        StationUniqueId: "HUBTEST",
        FriendlyName: "Southbound Platform 2",
        CardinalDirection: "Southbound",
      },
    ],
    platformServices: [
      {
        PlatformUniqueId: "HUBTEST-Plat01",
        Line: "victoria",
        DirectionTowards: "Walthamstow",
      },
      {
        PlatformUniqueId: "HUBTEST-Plat02",
        Line: "victoria",
        DirectionTowards: "Brixton",
      },
    ],
    lifts: [
      {
        StationUniqueId: "HUBTEST",
        LiftUniqueId: "HUBTEST-Lift-1",
        LiftName: "A",
        FriendlyName: "Lift A",
        FromAreas: "HUBTEST-Outside",
        ToAreas: "HUBTEST-Plat01",
        IntermediateAreas: "",
      },
    ],
    sameLevelPaths: [],
    rampRoutes: [],
  };

  it("marks platform with lift chain and orphan with empty chain", () => {
    const topo = buildTopology(inputs);
    expect(topo.platforms).toHaveLength(2);
    const chain1 = topo.platformLiftChains.find(
      (c) => c.platformId === "HUBTEST-Plat01::victoria::Walthamstow",
    );
    const chain2 = topo.platformLiftChains.find(
      (c) => c.platformId === "HUBTEST-Plat02::victoria::Brixton",
    );
    expect(chain1?.liftIds).toEqual(["HUBTEST-Lift-1"]);
    expect(chain2?.liftIds).toEqual([]);
  });

  it("builds bidirectional lift adjacency", () => {
    const { adjacency } = buildAdjacency(inputs);
    const fromOutside = adjacency.get("HUBTEST-Outside") ?? [];
    expect(fromOutside.some((e) => e.liftId === "HUBTEST-Lift-1")).toBe(true);
  });
});
