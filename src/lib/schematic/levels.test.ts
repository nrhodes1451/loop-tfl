import { describe, expect, it } from "vitest";
import {
  SCHEMATIC_LINE_LEVEL,
  normalizeSchematicLineId,
  schematicLevelForLine,
} from "./levels";

describe("normalizeSchematicLineId", () => {
  it("maps elizabeth to elizabeth-line", () => {
    expect(normalizeSchematicLineId("elizabeth")).toBe("elizabeth-line");
    expect(normalizeSchematicLineId("Elizabeth")).toBe("elizabeth-line");
  });

  it("leaves already-normalised ids alone", () => {
    expect(normalizeSchematicLineId("victoria")).toBe("victoria");
    expect(normalizeSchematicLineId("hammersmith-city")).toBe(
      "hammersmith-city",
    );
  });
});

describe("schematicLevelForLine", () => {
  it("uses King's Cross-style tiers", () => {
    expect(schematicLevelForLine("circle")).toBe(-2);
    expect(schematicLevelForLine("elizabeth")).toBe(-3);
    expect(schematicLevelForLine("elizabeth-line")).toBe(-3);
    expect(schematicLevelForLine("victoria")).toBe(-4);
    expect(schematicLevelForLine("piccadilly")).toBe(-5);
    expect(schematicLevelForLine("northern")).toBe(-6);
  });

  it("falls back to -7 for unknown lines", () => {
    expect(schematicLevelForLine("not-a-line")).toBe(-7);
  });

  it("covers every table entry", () => {
    for (const [id, level] of Object.entries(SCHEMATIC_LINE_LEVEL)) {
      expect(schematicLevelForLine(id)).toBe(level);
    }
  });
});
