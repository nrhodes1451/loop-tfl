import { describe, expect, it } from "vitest";
import kgxJson from "../../../data/schematic/HUBKGX.json";
import {
  LEVEL_SPACING,
  buildSceneGeometry,
  cameraFrame,
  hoverHighlight,
  levelT,
  schematicEdgeColor,
  toWorld,
} from "./scene";
import type { SchematicEdge, SchematicStation } from "./types";

const station = kgxJson as SchematicStation;
const topology = { nodes: station.nodes, edges: station.edges };

describe("toWorld", () => {
  it("maps a deeper (more negative) level to a smaller world Y", () => {
    const shallow = toWorld(2, 3, -1);
    const deep = toWorld(2, 3, -6);
    expect(deep[1]).toBeLessThan(shallow[1]);
    expect(deep[1]).toBe(-6 * LEVEL_SPACING);
    expect(deep[0]).toBe(shallow[0]);
    expect(deep[2]).toBe(shallow[2]);
  });
});

describe("levelT", () => {
  it("is 0 at street and 1 at the deepest tier", () => {
    expect(levelT(0, -6, 0)).toBe(0);
    expect(levelT(-6, -6, 0)).toBe(1);
    expect(levelT(-3, -6, 0)).toBeCloseTo(0.5);
  });
});

describe("schematicEdgeColor", () => {
  it("uses TfL yellow for Circle, not for Northern", () => {
    expect(schematicEdgeColor("platform", "circle").toLowerCase()).toBe(
      "#ffd300",
    );
    expect(schematicEdgeColor("platform", "northern").toLowerCase()).toBe(
      "#ffffff",
    );
  });

  it("gives street, ticket hall, and mezzanine distinct colours", () => {
    const street = schematicEdgeColor("street", undefined, 0).toLowerCase();
    const hall = schematicEdgeColor("concourse", undefined, -1).toLowerCase();
    const mezz = schematicEdgeColor("concourse", undefined, -3).toLowerCase();
    expect(street).not.toBe(hall);
    expect(hall).not.toBe(mezz);
    expect(street).not.toBe(mezz);
    expect(street).toBe("#84b817");
  });
});

describe("buildSceneGeometry HUBKGX", () => {
  const geom = buildSceneGeometry(topology, { quality: "high" });
  const byId = new Map(station.nodes.map((n) => [n.id, n]));

  it("emits one shaft volume and shaft line per lift", () => {
    const liftIds = new Set(
      station.nodes.filter((n) => n.type === "lift" && n.liftId).map((n) => n.liftId!),
    );
    expect(liftIds.size).toBe(8);
    const shafts = geom.volumes.filter((v) => v.id.startsWith("shaft::"));
    expect(shafts).toHaveLength(liftIds.size);
    const shaftLines = geom.polylines.filter((p) => p.mode === "shaft");
    expect(shaftLines).toHaveLength(liftIds.size);
  });

  it("synthesizes extra cabins at every served level", () => {
    const cabins = geom.volumes.filter((v) => v.id.includes("::cabin::"));
    expect(cabins).toHaveLength(7);
    expect(cabins.every((c) => c.kind === "cylinder" && c.type === "lift")).toBe(
      true,
    );
  });

  it("represents every topology edge", () => {
    for (const edge of station.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      expect(from && to).toBeTruthy();
      if (edge.mode === "level") {
        expect(
          geom.polylines.some(
            (p) => p.id === `corridor::${edge.from}::${edge.to}`,
          ),
        ).toBe(true);
        continue;
      }
      expect(edge.liftId).toBeTruthy();
      expect(
        geom.volumes.some((v) => v.id === `shaft::${edge.liftId}`),
      ).toBe(true);
      const lift =
        from!.type === "lift"
          ? from!
          : to!.type === "lift"
            ? to!
            : station.nodes.find((n) => n.liftId === edge.liftId);
      expect(lift).toBeTruthy();
      const other = from!.id === lift!.id ? to! : from!;
      if (other.x !== lift!.x || other.y !== lift!.y) {
        expect(
          geom.polylines.some(
            (p) =>
              p.id ===
              `landing::${edge.liftId}::${edge.from}::${edge.to}`,
          ),
        ).toBe(true);
      }
    }
  });

  it("keeps world Y monotonic with schematic level", () => {
    const boxes = geom.volumes.filter((v) => v.type === "platform");
    const sorted = [...boxes].sort((a, b) => b.level - a.level);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.level < sorted[i - 1]!.level) {
        expect(sorted[i]!.position[1]).toBeLessThan(sorted[i - 1]!.position[1]);
      }
    }
  });

  it("colours platforms with TfL line colours (Northern white on dark)", () => {
    const northern = geom.volumes.find((v) => v.id === "plat-7");
    const circle = geom.volumes.find((v) => v.id === "plat-1");
    const victoria = geom.volumes.find((v) => v.id === "plat-3");
    expect(northern?.edgeColor.toLowerCase()).toBe("#ffffff");
    expect(circle?.edgeColor.toLowerCase()).toBe("#ffd300");
    expect(victoria?.edgeColor.toLowerCase()).toBe("#0098d4");
  });

  it("distinguishes node types by silhouette", () => {
    const concourse = geom.volumes.find((v) => v.type === "concourse");
    const platform = geom.volumes.find((v) => v.type === "platform");
    const lift = geom.volumes.find((v) => v.type === "lift");
    const shaft = geom.volumes.find((v) => v.id.startsWith("shaft::"));
    expect(concourse?.kind).toBe("box");
    expect(platform?.kind).toBe("box");
    expect(lift?.kind).toBe("cylinder");
    expect(shaft?.kind).toBe("cylinder");
    expect(platform!.size[0] !== platform!.size[2]).toBe(true);
    expect(shaft!.size[1]).toBeGreaterThan(lift!.size[1]);
    expect(shaft!.size[0]).toBeLessThan(lift!.size[0]);
  });

  it("outlines every volume with meshline segment pairs", () => {
    const outlines = geom.polylines.filter((p) => p.role === "outline");
    expect(outlines).toHaveLength(geom.volumes.length);
    for (const line of outlines) {
      expect(line.segments).toBe(true);
      expect(line.points.length).toBeGreaterThan(0);
      expect(line.points.length % 2).toBe(0);
    }
  });

  it("uses fewer cylinder segments on low quality", () => {
    const low = buildSceneGeometry(topology, { quality: "low" });
    const highVol = geom.volumes.find((v) => v.kind === "cylinder")!;
    const lowVol = low.volumes.find((v) => v.kind === "cylinder")!;
    expect(lowVol.radialSegments).toBeLessThan(highVol.radialSegments);
  });

  it("emits stairs and escalator diagonals when present", () => {
    const extra: SchematicEdge[] = [
      { from: "wth", to: "plat-1", mode: "stairs" },
      { from: "nth", to: "npe", mode: "escalator" },
    ];
    const g = buildSceneGeometry(
      { nodes: station.nodes, edges: extra },
      { quality: "low" },
    );
    expect(g.polylines.some((p) => p.mode === "stairs")).toBe(true);
    expect(g.polylines.some((p) => p.mode === "escalator")).toBe(true);
    const stairs = g.polylines.find((p) => p.mode === "stairs")!;
    expect(stairs.points[0]![1]).not.toBe(stairs.points[1]![1]);
  });
});

describe("hoverHighlight", () => {
  const geom = buildSceneGeometry(topology, { quality: "high" });

  it("returns empty sets when nothing is hovered", () => {
    const h = hoverHighlight(null, geom);
    expect(h.volumeIds.size).toBe(0);
    expect(h.polylineIds.size).toBe(0);
  });

  it("highlights a platform volume and its outline only", () => {
    const h = hoverHighlight("plat-1", geom);
    expect([...h.volumeIds]).toEqual(["plat-1"]);
    expect(h.polylineIds.has("wire::plat-1")).toBe(true);
    expect(h.volumeIds.has("plat-2")).toBe(false);
    expect(h.polylineIds.has("wire::plat-2")).toBe(false);
  });

  it("highlights the whole lift shaft when hovering a cabin", () => {
    const h = hoverHighlight("lift-1", geom);
    expect(h.volumeIds.has("lift-1")).toBe(true);
    expect(h.volumeIds.has("lift-1::cabin::-2")).toBe(true);
    expect(h.volumeIds.has("shaft::HUBKGX-Lift-1")).toBe(true);
    expect(h.polylineIds.has("shaft-line::HUBKGX-Lift-1")).toBe(true);
    expect(h.polylineIds.has("wire::lift-1")).toBe(true);
    expect(h.volumeIds.has("wth")).toBe(false);
  });

  it("does not pick derived shafts", () => {
    const shaft = geom.volumes.find((v) => v.id === "shaft::HUBKGX-Lift-1");
    expect(shaft?.pickable).toBe(false);
    expect(geom.volumes.find((v) => v.id === "lift-1")?.pickable).toBe(true);
  });
});

describe("cameraFrame", () => {
  it("looks at the bounds center from above-front", () => {
    const geom = buildSceneGeometry(topology);
    const frame = cameraFrame(geom.bounds);
    expect(frame.target).toEqual(geom.bounds.center);
    expect(frame.position[1]).toBeGreaterThan(frame.target[1]);
    expect(frame.maxPolarAngle).toBeLessThan(Math.PI / 2);
    expect(frame.minDistance).toBeLessThan(frame.maxDistance);
  });
});
