import { describe, expect, it } from "vitest";
import { schematicLevelWorldY } from "./geo";
import {
  foiDepthM,
  formatDepthBelowStreet,
  hoverDepthLabel,
  hoverFoiExtractLabel,
  platformWorldY,
} from "./foi-layout";

describe("FOI platform depths", () => {
  it("reads KGX Northern at 27 m and Circle at 7 m", () => {
    expect(foiDepthM("HUBKGX", "northern")).toBe(27);
    expect(foiDepthM("HUBKGX", "circle")).toBe(7);
    expect(platformWorldY("HUBKGX", "northern")).toBeCloseTo(-27);
    expect(platformWorldY("HUBKGX", "circle")).toBeCloseTo(-7);
  });

  it("uses typical depth when a station has no FOI row, not ~68 m", () => {
    expect(foiDepthM("NO_SUCH_STATION", "northern")).toBeNull();
    expect(platformWorldY("NO_SUCH_STATION", "northern")).toBeCloseTo(-25);
    expect(platformWorldY("NO_SUCH_STATION", "northern")).not.toBeCloseTo(
      schematicLevelWorldY(-6),
      0,
    );
  });

  it("formats hover copy from FOI metres, not schematic level", () => {
    expect(formatDepthBelowStreet(27)).toBe("27 m below street");
    expect(formatDepthBelowStreet(15.7)).toBe("15.7 m below street");
    expect(
      hoverDepthLabel("HUBKGX", {
        type: "platform",
        lineId: "northern",
        level: -6,
      }),
    ).toBe("27 m below street");
    expect(
      hoverDepthLabel("HUBKGX", { type: "street", level: 0 }),
    ).toBeNull();
    expect(
      hoverFoiExtractLabel({
        confidence: "low",
        caption: "BAKERLOO LINE PLATFORMS",
        eastM: 0,
        northM: 0,
        grid: "G7",
      }),
    ).toBe("FOI low · G7 · BAKERLOO LINE PLATFORMS");
  });
});
