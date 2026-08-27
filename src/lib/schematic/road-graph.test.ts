import { describe, expect, it } from "vitest";
import { stitchRoads } from "./road-graph";

describe("stitchRoads", () => {
  it("merges two colinear ways that share a snapped node, even across kinds", () => {
    const { ways, wedges } = stitchRoads([
      {
        path: [
          [0, 0],
          [10.1, 0],
        ],
        widthM: 14,
      },
      {
        path: [
          [10.2, 0],
          [20, 0],
        ],
        widthM: 14,
      },
    ]);
    expect(ways).toHaveLength(1);
    expect(ways[0]!.path).toHaveLength(3);
    expect(ways[0]!.path[0]).toEqual([0, 0]);
    expect(ways[0]!.path[2]).toEqual([20, 0]);
    expect(wedges).toHaveLength(0);
  });

  it("keeps a through-road as one ribbon at a T and fills two outer wedges", () => {
    const { ways, wedges } = stitchRoads([
      {
        path: [
          [-10, 0],
          [0, 0],
          [10, 0],
        ],
        widthM: 14,
      },
      {
        path: [
          [0, 0],
          [0, -10],
        ],
        widthM: 14,
      },
    ]);
    expect(ways).toHaveLength(2);
    const through = ways.find((w) => w.path.length === 3);
    expect(through).toBeTruthy();
    expect(wedges).toHaveLength(2);
  });

  it("does not merge a width change at a 2-way node", () => {
    const { ways, wedges } = stitchRoads([
      {
        path: [
          [0, 0],
          [10, 0],
        ],
        widthM: 22,
      },
      {
        path: [
          [10, 0],
          [10, 10],
        ],
        widthM: 14,
      },
    ]);
    expect(ways).toHaveLength(2);
    expect(ways.map((w) => w.widthM).sort()).toEqual([14, 22]);
    expect(wedges.length).toBeGreaterThanOrEqual(1);
    for (const w of wedges) {
      const area =
        (w.a[0] - w.node[0]) * (w.b[1] - w.node[1]) -
        (w.a[1] - w.node[1]) * (w.b[0] - w.node[0]);
      expect(area).not.toBe(0);
    }
  });
});
