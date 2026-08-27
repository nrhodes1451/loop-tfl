import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_IMPORT = /from\s+["'](@\/lib\/(plan|status|tfl\/topology)|\.\.\/(plan|status|tfl\/topology))/;

function sourceFilesUnder(relDir: string): string[] {
  const dir = path.join(process.cwd(), relDir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      if (name.endsWith(".fixture.ts")) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("schematic module isolation", () => {
  it("does not import plan, status, or topology", () => {
    const files = [
      ...sourceFilesUnder("src/lib/schematic"),
      ...sourceFilesUnder("src/components/schematic"),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(FORBIDDEN_IMPORT);
    }
  });
});
