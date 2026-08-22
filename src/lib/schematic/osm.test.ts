import { describe, expect, it } from "vitest";
import type { Aabb2 } from "./geo";
import { clipPathToRect, clipRingToRect, pointInRing, ringAabb, ringCentroid, simplifyRing } from "./osm";

const RECT: Aabb2 = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

describe("simplifyRing", () => {
  it("drops vertices on short edges and keeps a usable polygon", () => {
    const ring: [number, number][] = [
      [0, 0],
      [0.4, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const simple = simplifyRing(ring, 2);
    expect(simple.length).toBeLessThan(ring.length);
    expect(simple.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves a four-corner box alone", () => {
    const box: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ];
    expect(simplifyRing(box, 2)).toEqual(box);
  });
});

describe("clipRingToRect", () => {
  it("leaves a ring that is already inside untouched", () => {
    const ring: [number, number][] = [
      [10, 10],
      [40, 10],
      [40, 40],
      [10, 40],
    ];
    expect(clipRingToRect(ring, RECT)).toEqual(ring);
  });

  it("trims a ring straddling one edge back to the boundary", () => {
    const ring: [number, number][] = [
      [80, 20],
      [130, 20],
      [130, 60],
      [80, 60],
    ];
    const aabb = ringAabb(clipRingToRect(ring, RECT));
    expect(aabb.minX).toBe(80);
    expect(aabb.maxX).toBe(100);
    expect(aabb.minZ).toBe(20);
    expect(aabb.maxZ).toBe(60);
  });

  it("drops a ring that sits entirely outside", () => {
    const ring: [number, number][] = [
      [120, 20],
      [160, 20],
      [160, 60],
      [120, 60],
    ];
    expect(clipRingToRect(ring, RECT)).toEqual([]);
  });

  it("splits a straddling ring between neighbouring rects with no overlap", () => {
    const right: Aabb2 = { minX: 100, maxX: 200, minZ: 0, maxZ: 100 };
    const ring: [number, number][] = [
      [80, 20],
      [130, 20],
      [130, 60],
      [80, 60],
    ];
    const left = ringAabb(clipRingToRect(ring, RECT));
    const east = ringAabb(clipRingToRect(ring, right));
    expect(left.maxX).toBe(100);
    expect(east.minX).toBe(100);
    expect(east.maxX).toBe(130);
  });
});

describe("clipPathToRect", () => {
  it("keeps a fully contained path as one piece", () => {
    const path: [number, number][] = [
      [10, 10],
      [50, 50],
      [90, 10],
    ];
    expect(clipPathToRect(path, RECT)).toEqual([path]);
  });

  it("cuts a crossing path at the boundary", () => {
    const path: [number, number][] = [
      [-40, 50],
      [140, 50],
    ];
    const pieces = clipPathToRect(path, RECT);
    expect(pieces).toEqual([
      [
        [0, 50],
        [100, 50],
      ],
    ]);
  });

  it("returns one sub-path per run inside, for a path that leaves and re-enters", () => {
    const path: [number, number][] = [
      [10, 50],
      [50, 50],
      [50, 150],
      [80, 150],
      [80, 50],
      [95, 50],
    ];
    const pieces = clipPathToRect(path, RECT);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]![0]).toEqual([10, 50]);
    expect(pieces[0]![pieces[0]!.length - 1]).toEqual([50, 100]);
    expect(pieces[1]![0]).toEqual([80, 100]);
    expect(pieces[1]![pieces[1]!.length - 1]).toEqual([95, 50]);
  });

  it("drops a path that misses the rect", () => {
    const path: [number, number][] = [
      [-40, 150],
      [140, 150],
    ];
    expect(clipPathToRect(path, RECT)).toEqual([]);
  });

  it("hands neighbouring rects abutting pieces that do not overlap", () => {
    const right: Aabb2 = { minX: 100, maxX: 200, minZ: 0, maxZ: 100 };
    const path: [number, number][] = [
      [-20, 50],
      [160, 50],
    ];
    const west = clipPathToRect(path, RECT);
    const east = clipPathToRect(path, right);
    expect(west[0]![west[0]!.length - 1]).toEqual([100, 50]);
    expect(east[0]![0]).toEqual([100, 50]);
  });
});

describe("pointInRing", () => {
  const box: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ];

  it("counts the centroid as inside and a corner-out point as outside", () => {
    expect(pointInRing(5, 4, box)).toBe(true);
    expect(pointInRing(-1, 4, box)).toBe(false);
    expect(pointInRing(5, 20, box)).toBe(false);
  });
});

describe("ringCentroid", () => {
  it("averages vertices of a rectangle", () => {
    expect(ringCentroid([
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ])).toEqual([5, 4]);
  });
});
