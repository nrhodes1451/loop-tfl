import { describe, expect, it } from "vitest";
import { simplifyRing } from "./osm";

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
