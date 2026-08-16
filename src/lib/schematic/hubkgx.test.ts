import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SchematicStation } from "./types";
import kgxJson from "../../../data/schematic/HUBKGX.json";

const KNOWN_LIFTS = [
  "HUBKGX-Lift-1",
  "HUBKGX-Lift-2",
  "HUBKGX-Lift-3",
  "HUBKGX-Lift-5",
  "HUBKGX-Lift-6",
  "HUBKGX-Lift-7",
  "HUBKGX-Lift-8",
  "HUBKGX-Lift-11",
] as const;

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
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("HUBKGX schematic JSON", () => {
  const station = kgxJson as SchematicStation;

  it("parses as King's Cross tube-only schematic", () => {
    expect(station.stationId).toBe("HUBKGX");
    expect(station.name).toBe("King's Cross St Pancras");
    expect(station.disclaimer.toLowerCase()).toMatch(/schematic/);
    expect(station.nodes.length).toBeGreaterThan(0);
    expect(station.edges.length).toBeGreaterThan(0);
  });

  it("anchors the entrance to a real OSM subway entrance", () => {
    expect(station.entrance.source).toMatch(/^https:\/\/www\.openstreetmap\.org\/node\/\d+$/);
    expect(station.entrance.lat).toBeCloseTo(51.53041, 4);
    expect(station.entrance.lon).toBeCloseTo(-0.12374, 4);
  });

  it("has unique node ids and every edge endpoint exists", () => {
    const ids = station.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const idSet = new Set(ids);
    for (const edge of station.edges) {
      expect(idSet.has(edge.from), `missing from ${edge.from}`).toBe(true);
      expect(idSet.has(edge.to), `missing to ${edge.to}`).toBe(true);
    }
  });

  it("only uses known TfL HUBKGX lift ids", () => {
    const known = new Set<string>(KNOWN_LIFTS);
    for (const node of station.nodes) {
      if (node.liftId) expect(known.has(node.liftId)).toBe(true);
    }
    for (const edge of station.edges) {
      if (edge.liftId) expect(known.has(edge.liftId)).toBe(true);
      if (edge.mode === "lift") expect(edge.liftId).toBeTruthy();
    }
  });

  it("does not include National Rail platforms", () => {
    expect(station.nodes.some((n) => n.lineId === "national-rail")).toBe(false);
    expect(station.notes ?? "").toMatch(/Tube only/i);
  });

  it("connects street-wth and joins the two lift trees with level walks", () => {
    expect(
      station.edges.some(
        (e) =>
          e.mode === "level" &&
          ((e.from === "street-wth" && e.to === "wth") ||
            (e.from === "wth" && e.to === "street-wth")),
      ),
    ).toBe(true);
    expect(
      station.edges.some(
        (e) =>
          e.mode === "level" &&
          ((e.from === "tth" && e.to === "nth") ||
            (e.from === "nth" && e.to === "tth")),
      ),
    ).toBe(true);

    const adj = new Map<string, string[]>();
    for (const n of station.nodes) adj.set(n.id, []);
    for (const e of station.edges) {
      adj.get(e.from)?.push(e.to);
      adj.get(e.to)?.push(e.from);
    }
    const seen = new Set<string>();
    const stack = [station.nodes[0]!.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const nxt of adj.get(id) ?? []) stack.push(nxt);
    }
    expect(seen.size).toBe(station.nodes.length);
  });
});

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
