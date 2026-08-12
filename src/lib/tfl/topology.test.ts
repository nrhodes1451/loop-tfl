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
        ToAreas: "HUBTEST-Mid",
        IntermediateAreas: "",
      },
      {
        StationUniqueId: "HUBTEST",
        LiftUniqueId: "HUBTEST-Lift-2",
        LiftName: "B",
        FriendlyName: "Lift B",
        FromAreas: "HUBTEST-Mid",
        ToAreas: "HUBTEST-Plat01",
        IntermediateAreas: "",
      },
    ],
    sameLevelPaths: [],
    rampRoutes: [],
  };

  it("marks platform with lift chain and orphan as unreachable", () => {
    const topo = buildTopology(inputs);
    expect(topo.platforms).toHaveLength(2);
    const chain1 = topo.platformLiftChains.find(
      (c) => c.platformId === "HUBTEST-Plat01::victoria::Walthamstow",
    );
    const chain2 = topo.platformLiftChains.find(
      (c) => c.platformId === "HUBTEST-Plat02::victoria::Brixton",
    );
    // Stored platform → street: platform-end lift first.
    expect(chain1?.liftIds).toEqual(["HUBTEST-Lift-2", "HUBTEST-Lift-1"]);
    expect(chain1?.access).toBe("lifts");
    expect(chain2?.liftIds).toEqual([]);
    expect(chain2?.access).toBe("none");
  });

  it("marks same-level path as level access with no lifts", () => {
    const topo = buildTopology({
      ...inputs,
      lifts: [],
      sameLevelPaths: [
        { From: "HUBTEST-Outside", To: "HUBTEST-Plat02" },
      ],
    });
    const chain = topo.platformLiftChains.find(
      (c) => c.platformId === "HUBTEST-Plat02::victoria::Brixton",
    );
    expect(chain?.liftIds).toEqual([]);
    expect(chain?.access).toBe("level");
  });

  it("marks platforms as unreachable when the station has no Outside area", () => {
    const topo = buildTopology({
      ...inputs,
      stations: [{ UniqueId: "HUBTEST", Name: "Test Station" }],
    });
    expect(
      topo.platformLiftChains.every((c) => c.access === "none"),
    ).toBe(true);
  });

  it("attaches platforms same-level to a lift's areas", () => {
    const topo = buildTopology(inputs);
    const lift2 = topo.lifts.find((l) => l.id === "HUBTEST-Lift-2");
    expect(lift2?.platformIds).toContain(
      "HUBTEST-Plat01::victoria::Walthamstow",
    );
  });

  it("builds bidirectional lift adjacency", () => {
    const { adjacency } = buildAdjacency(inputs);
    const fromOutside = adjacency.get("HUBTEST-Outside") ?? [];
    expect(fromOutside.some((e) => e.liftId === "HUBTEST-Lift-1")).toBe(true);
  });

  it("records a level interchange when two lines share a physical platform", () => {
    const topo = buildTopology({
      ...inputs,
      platformServices: [
        ...inputs.platformServices,
        {
          PlatformUniqueId: "HUBTEST-Plat01",
          Line: "jubilee",
          DirectionTowards: "Stratford",
        },
      ],
    });
    const chain = topo.interchangeChains.find(
      (c) =>
        c.fromPlatformId === "HUBTEST-Plat01::victoria::Walthamstow" &&
        c.toPlatformId === "HUBTEST-Plat01::jubilee::Stratford",
    );
    expect(chain?.access).toBe("level");
    expect(chain?.liftIds).toEqual([]);
  });

  it("records a lift interchange between platforms on different lines", () => {
    const topo = buildTopology({
      ...inputs,
      platforms: [
        ...inputs.platforms,
        {
          UniqueId: "HUBTEST-Plat03",
          StationUniqueId: "HUBTEST",
          FriendlyName: "Northern southbound",
          CardinalDirection: "Southbound",
        },
      ],
      platformServices: [
        ...inputs.platformServices,
        {
          PlatformUniqueId: "HUBTEST-Plat03",
          Line: "northern",
          DirectionTowards: "Morden",
        },
      ],
      lifts: [
        ...inputs.lifts,
        {
          StationUniqueId: "HUBTEST",
          LiftUniqueId: "HUBTEST-Lift-3",
          LiftName: "C",
          FriendlyName: "Lift C",
          FromAreas: "HUBTEST-Plat01",
          ToAreas: "HUBTEST-Plat03",
          IntermediateAreas: "",
        },
      ],
    });
    const chain = topo.interchangeChains.find(
      (c) =>
        c.fromPlatformId === "HUBTEST-Plat01::victoria::Walthamstow" &&
        c.toPlatformId === "HUBTEST-Plat03::northern::Morden",
    );
    expect(chain?.access).toBe("lifts");
    expect(chain?.liftIds).toEqual(["HUBTEST-Lift-3"]);
  });
});
