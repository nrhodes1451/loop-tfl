import { describe, expect, it } from "vitest";
import {
  buildNetworkFromSources,
  orderStopsNearestNeighbor,
  routeSequenceFromStopPoints,
} from "./build-network";
import type { TopologyInputs } from "./topology";

describe("orderStopsNearestNeighbor", () => {
  it("orders Bakerloo-like stops north to south", () => {
    const stops = [
      { id: "oxc", name: "Oxford Circus", lat: 51.515, lon: -0.142 },
      { id: "haw", name: "Harrow & Wealdstone", lat: 51.592, lon: -0.335 },
      { id: "eac", name: "Elephant & Castle", lat: 51.495, lon: -0.101 },
      { id: "wmb", name: "Wembley Central", lat: 51.552, lon: -0.297 },
      { id: "wat", name: "Waterloo", lat: 51.503, lon: -0.115 },
    ];
    const ordered = orderStopsNearestNeighbor(stops).map((s) => s.id);
    expect(ordered[0]).toBe("haw");
    expect(ordered.at(-1)).toBe("eac");
    expect(ordered).toEqual(["haw", "wmb", "oxc", "wat", "eac"]);
  });
});

describe("routeSequenceFromStopPoints", () => {
  it("builds a single sequence branch", () => {
    const seq = routeSequenceFromStopPoints(
      { id: "bakerloo", name: "Bakerloo", modeName: "tube" },
      [
        {
          id: "a",
          commonName: "Alpha Underground Station",
          lat: 51.6,
          lon: -0.3,
        },
        {
          id: "b",
          commonName: "Beta Underground Station",
          lat: 51.5,
          lon: -0.2,
        },
      ],
    );
    expect(seq.lineId).toBe("bakerloo");
    expect(seq.stopPointSequences).toHaveLength(1);
    expect(seq.stopPointSequences[0]!.stopPoint.map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
    expect(seq.stopPointSequences[0]!.stopPoint[0]!.name).toBe(
      "Alpha Underground Station",
    );
  });
});

describe("buildNetworkFromSources rides", () => {
  const emptyTopo: TopologyInputs = {
    stations: [],
    platforms: [],
    platformServices: [],
    lifts: [],
    sameLevelPaths: [],
    rampRoutes: [],
  };

  it("stores directed rides and normalises elizabeth line ids", () => {
    const network = buildNetworkFromSources({
      lines: [
        { id: "elizabeth", name: "Elizabeth line", modeName: "elizabeth-line" },
      ],
      sequences: [
        {
          lineId: "elizabeth",
          lineName: "Elizabeth line",
          mode: "elizabeth-line",
          stations: [],
          stopPointSequences: [
            {
              lineId: "elizabeth",
              direction: "outbound",
              branchId: 0,
              stopPoint: [
                {
                  id: "A",
                  name: "Alpha",
                  lat: 51.5,
                  lon: -0.1,
                },
                {
                  id: "B",
                  name: "Beta",
                  lat: 51.51,
                  lon: -0.11,
                },
              ],
            },
          ],
        },
      ],
      topology: emptyTopo,
    });
    expect(network.rides).toEqual([
      { from: "A", to: "B", lineId: "elizabeth-line" },
    ]);
    expect(network.edges).toEqual([{ from: "A", to: "B", lineId: "elizabeth" }]);
    expect(network.interchangeChains).toEqual([]);
  });
});
