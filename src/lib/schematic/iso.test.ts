import { describe, expect, it } from "vitest";
import { DEFAULT_ISO, projectIso } from "./iso";

describe("projectIso", () => {
  it("maps a deeper (more negative) level to a larger screenY", () => {
    const shallow = projectIso(2, 3, -1, DEFAULT_ISO);
    const deep = projectIso(2, 3, -6, DEFAULT_ISO);
    expect(deep.y).toBeGreaterThan(shallow.y);
    expect(deep.x).toBe(shallow.x);
  });

  it("swapping x/y reflects across the screen vertical (iso axes)", () => {
    const a = projectIso(1, 0, 0, DEFAULT_ISO);
    const b = projectIso(0, 1, 0, DEFAULT_ISO);
    expect(a.y).toBe(b.y);
    expect(a.x).toBe(-b.x);
    expect(a.x).toBe(DEFAULT_ISO.tileW / 2);
  });

  it("uses 2:1 tile aspect", () => {
    expect(DEFAULT_ISO.tileH).toBe(DEFAULT_ISO.tileW / 2);
  });
});
