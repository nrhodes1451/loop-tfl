import { describe, expect, it } from "vitest";
import { kgxStation } from "./kgx.fixture";
import {
  SCHEMATIC_METRES_PER_UNIT,
  placeSchematicAt,
  schematicLevelWorldY,
} from "./geo";
import {
  LEVEL_SPACING,
  PLATFORM_LONG,
  PLATFORM_THIN,
  VOLUME_BOTTOM_OPACITY,
  VOLUME_FACE_OPACITY,
  boxCorners,
  buildSceneGeometry,
  cameraFrame,
  hoverHighlight,
  levelT,
  makeHoverId,
  platformPlanSize,
  polylineTouchesVolumeIds,
  schematicEdgeColor,
  splitHoverId,
  streetVolumeIds,
  toWorld,
} from "./scene";
import type { SchematicEdge, SchematicNode } from "./types";

const station = kgxStation;
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

describe("platformPlanSize", () => {
  const plat = (
    id: string,
    lineId: string,
    x: number,
    y: number,
  ): SchematicNode => ({
    id,
    type: "platform",
    label: id,
    level: -2,
    x,
    y,
    lineId,
  });

  it("places a lone platform long in Y", () => {
    const a = plat("a", "victoria", 0, 0);
    expect(platformPlanSize(a, [a])).toEqual({
      wx: PLATFORM_THIN,
      wy: PLATFORM_LONG,
    });
  });

  it("orients a pair perpendicular to their offset so they sit in parallel", () => {
    const a = plat("a", "circle", 0, 0);
    const b = plat("b", "circle", 4, 0);
    expect(platformPlanSize(a, [a, b])).toEqual({
      wx: PLATFORM_THIN,
      wy: PLATFORM_LONG,
    });
    expect(platformPlanSize(b, [a, b])).toEqual({
      wx: PLATFORM_THIN,
      wy: PLATFORM_LONG,
    });

    const c = plat("c", "northern", 0, 0);
    const d = plat("d", "northern", 0, 4);
    expect(platformPlanSize(c, [c, d])).toEqual({
      wx: PLATFORM_LONG,
      wy: PLATFORM_THIN,
    });
    expect(platformPlanSize(d, [c, d])).toEqual({
      wx: PLATFORM_LONG,
      wy: PLATFORM_THIN,
    });
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
  const geom = buildSceneGeometry(topology, {
    quality: "high",
    stationId: "HUBKGX",
  });
  const byId = new Map(station.nodes.map((n) => [n.id, n]));

  it("emits one shaft volume and shaft line per lift", () => {
    const liftIds = new Set(
      station.nodes.filter((n) => n.type === "lift" && n.liftId).map((n) => n.liftId!),
    );
    expect(liftIds.size).toBeGreaterThanOrEqual(1);
    const shafts = geom.volumes.filter((v) => v.id.startsWith("shaft::"));
    expect(shafts).toHaveLength(liftIds.size);
    const shaftLines = geom.polylines.filter((p) => p.mode === "shaft");
    expect(shaftLines).toHaveLength(liftIds.size);
  });

  it("synthesizes extra cabins at every served level", () => {
    const cabins = geom.volumes.filter((v) => v.id.includes("::cabin::"));
    expect(cabins.length).toBeGreaterThanOrEqual(1);
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
    const northern = geom.volumes.find((v) => v.lineId === "northern");
    const circle = geom.volumes.find((v) => v.lineId === "circle");
    const victoria = geom.volumes.find((v) => v.lineId === "victoria");
    expect(northern?.edgeColor.toLowerCase()).toBe("#ffffff");
    expect(circle?.edgeColor.toLowerCase()).toBe("#ffd300");
    expect(victoria?.edgeColor.toLowerCase()).toBe("#0098d4");
  });

  it("fills volumes with the same colour at high transparency", () => {
    const circle = geom.volumes.find((v) => v.lineId === "circle")!;
    const northern = geom.volumes.find((v) => v.lineId === "northern")!;
    const hall = geom.volumes.find((v) => v.type === "concourse")!;
    expect(circle.faceColor.toLowerCase()).toBe(circle.edgeColor.toLowerCase());
    expect(northern.faceColor.toLowerCase()).toBe("#ffffff");
    expect(circle.opacity).toBe(VOLUME_FACE_OPACITY);
    expect(circle.bottomOpacity).toBe(VOLUME_BOTTOM_OPACITY);
    expect(hall.opacity).toBe(VOLUME_FACE_OPACITY);
    expect(hall.bottomOpacity).toBe(VOLUME_BOTTOM_OPACITY);
  });

  it("orients same-line platforms in parallel (long axis perpendicular to offset)", () => {
    const victoria = geom.volumes.filter(
      (v) => v.lineId === "victoria" && v.type === "platform",
    );
    expect(victoria.length).toBeGreaterThanOrEqual(2);
    const [a, b] = victoria;
    expect(a!.size[0]).toBeLessThan(a!.size[2]);
    expect(b!.size[0]).toBeLessThan(b!.size[2]);
    expect(a!.size[0]).toBeCloseTo(b!.size[0]);
    expect(a!.size[2]).toBeCloseTo(b!.size[2]);
    expect(a!.rotationY).toBeUndefined();
    expect(b!.rotationY).toBeUndefined();
  });

  it("aligns platforms to a supplied line bearing with the thin×long footprint", () => {
    const aligned = buildSceneGeometry(topology, {
      quality: "high",
      stationId: "HUBKGX",
      platformAngles: { circle: Math.PI / 4 },
    });
    const plat = aligned.volumes.find((v) => v.lineId === "circle")!;
    expect(plat.size[0]).toBeCloseTo(PLATFORM_THIN);
    expect(plat.size[2]).toBeCloseTo(PLATFORM_LONG);
    expect(plat.rotationY).toBeCloseTo(Math.PI / 4);
    const corners = boxCorners(plat);
    const xs = corners.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(plat.size[0] + 0.1);
    expect(aligned.bounds.min[0]).toBeLessThanOrEqual(Math.min(...xs));
    expect(aligned.bounds.max[0]).toBeGreaterThanOrEqual(Math.max(...xs));
    const victoria = aligned.volumes.find((v) => v.lineId === "victoria")!;
    expect(victoria.rotationY).toBeUndefined();
  });

  it("yaws each platform from its own bearingDeg even when the line angle differs", () => {
    const nodes: SchematicNode[] = [
      {
        id: "p12",
        type: "platform",
        label: "Platform 2",
        level: -1,
        x: 0,
        y: 0,
        lineId: "victoria",
        bearingDeg: 12,
      },
      {
        id: "p23",
        type: "platform",
        label: "Platform 1",
        level: -1,
        x: 2,
        y: 0,
        lineId: "victoria",
        bearingDeg: 23,
      },
    ];
    const out = buildSceneGeometry(
      { nodes, edges: [] },
      { platformAngles: { victoria: Math.PI / 2 } },
    );
    const a = out.volumes.find((v) => v.id === "p12")!;
    const b = out.volumes.find((v) => v.id === "p23")!;
    expect(a.rotationY).toBeCloseTo((-12 * Math.PI) / 180);
    expect(b.rotationY).toBeCloseTo((-23 * Math.PI) / 180);
    expect(a.size[0]).toBeCloseTo(PLATFORM_THIN);
    expect(a.size[2]).toBeCloseTo(PLATFORM_LONG);
  });

  it("falls back to the line angle when a platform has no bearingDeg", () => {
    const nodes: SchematicNode[] = [
      {
        id: "p-foi",
        type: "platform",
        label: "Platform 1",
        level: -1,
        x: 0,
        y: 0,
        lineId: "victoria",
        bearingDeg: 12,
      },
      {
        id: "p-geo",
        type: "platform",
        label: "Platform 2",
        level: -1,
        x: 2,
        y: 0,
        lineId: "victoria",
      },
    ];
    const line = Math.PI / 3;
    const out = buildSceneGeometry(
      { nodes, edges: [] },
      { platformAngles: { victoria: line } },
    );
    expect(out.volumes.find((v) => v.id === "p-foi")!.rotationY).toBeCloseTo(
      (-12 * Math.PI) / 180,
    );
    expect(out.volumes.find((v) => v.id === "p-geo")!.rotationY).toBeCloseTo(
      line,
    );
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

  it("draws three vertical bars on lift shafts", () => {
    const shaftWire = geom.polylines.find((p) => p.id.startsWith("wire::shaft::"));
    expect(shaftWire).toBeTruthy();
    const pts = shaftWire!.points;
    let verts = 0;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (a[0] === b[0] && a[2] === b[2] && a[1] !== b[1]) verts += 1;
    }
    expect(verts).toBe(3);
  });

  it("uses fewer cylinder segments on low quality", () => {
    const low = buildSceneGeometry(topology, { quality: "low" });
    const highVol = geom.volumes.find((v) => v.kind === "cylinder")!;
    const lowVol = low.volumes.find((v) => v.kind === "cylinder")!;
    expect(lowVol.radialSegments).toBeLessThan(highVol.radialSegments);
  });

  it("emits stairs and escalator diagonals when present", () => {
    const platform = station.nodes.find((n) => n.type === "platform")!;
    const extra: SchematicEdge[] = [
      { from: "concourse", to: platform.id, mode: "stairs" },
      { from: "street", to: platform.id, mode: "escalator" },
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

  it("does not draw walks to National Rail platforms", () => {
    const nodes: SchematicNode[] = [
      {
        id: "street",
        type: "street",
        label: "Street",
        level: 0,
        x: 0,
        y: 0,
      },
      {
        id: "concourse",
        type: "concourse",
        label: "Ticket hall",
        level: -1,
        x: 0,
        y: 0,
      },
      {
        id: "p-nr",
        type: "platform",
        label: "Platform 1",
        level: -2,
        x: 10,
        y: 0,
        lineId: "national-rail",
      },
    ];
    const edges: SchematicEdge[] = [
      { from: "street", to: "concourse", mode: "level" },
      { from: "concourse", to: "p-nr", mode: "level" },
    ];
    const g = buildSceneGeometry({ nodes, edges }, { quality: "low" });
    expect(g.polylines.some((p) => p.id.startsWith("corridor::") && p.id.includes("p-nr"))).toBe(
      false,
    );
    expect(
      g.polylines.some((p) => p.id === "corridor::street::concourse"),
    ).toBe(true);
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
    const plats = geom.volumes.filter((v) => v.type === "platform");
    const a = plats[0]!.id;
    const b = plats[1]!.id;
    const h = hoverHighlight(a, geom);
    expect([...h.volumeIds]).toEqual([a]);
    expect(h.polylineIds.has(`wire::${a}`)).toBe(true);
    expect(h.volumeIds.has(b)).toBe(false);
    expect(h.polylineIds.has(`wire::${b}`)).toBe(false);
  });

  it("highlights the whole lift shaft when hovering a cabin", () => {
    const cabin = geom.volumes.find((v) => v.id.includes("::cabin::"))!;
    const h = hoverHighlight("lift-1", geom);
    expect(h.volumeIds.has("lift-1")).toBe(true);
    expect(h.volumeIds.has(cabin.id)).toBe(true);
    expect(h.volumeIds.has("shaft::HUBKGX-Lift-1")).toBe(true);
    expect(h.polylineIds.has("shaft-line::HUBKGX-Lift-1")).toBe(true);
    expect(h.polylineIds.has("wire::lift-1")).toBe(true);
    expect(h.volumeIds.has("concourse")).toBe(false);
  });

  it("highlights the whole lift when hovering the shaft", () => {
    const h = hoverHighlight("shaft::HUBKGX-Lift-1", geom);
    expect(h.volumeIds.has("shaft::HUBKGX-Lift-1")).toBe(true);
    expect(h.volumeIds.has("lift-1")).toBe(true);
    expect(h.polylineIds.has("shaft-line::HUBKGX-Lift-1")).toBe(true);
  });

  it("lets derived shafts be picked", () => {
    const shaft = geom.volumes.find((v) => v.id === "shaft::HUBKGX-Lift-1");
    expect(shaft?.pickable).toBe(true);
    expect(geom.volumes.find((v) => v.id === "lift-1")?.pickable).toBe(true);
  });
});

describe("makeHoverId", () => {
  it("round-trips volume ids that themselves contain ::", () => {
    const volumeId = "shaft::HUBKGX-Lift-1";
    const id = makeHoverId("HUBKGX", volumeId);
    expect(splitHoverId(id)).toEqual({
      stationId: "HUBKGX",
      volumeId,
    });
  });

  it("keeps two stations' street volumes distinct", () => {
    const a = makeHoverId("940GZZLUEUS", "street");
    const b = makeHoverId("HUBKGX", "street");
    expect(a).not.toBe(b);
    expect(splitHoverId(a).stationId).toBe("940GZZLUEUS");
    expect(splitHoverId(b).stationId).toBe("HUBKGX");
    expect(splitHoverId(a).volumeId).toBe("street");
  });

  it("does not let one station's highlight include another station's volume id", () => {
    const geom = buildSceneGeometry(topology, { quality: "high" });
    const hovered = splitHoverId(makeHoverId("940GZZLUEUS", "concourse"));
    expect(hovered.stationId).not.toBe("HUBKGX");
    const h = hoverHighlight(hovered.volumeId, geom);
    expect(h.volumeIds.has("concourse")).toBe(true);
    const other = hoverHighlight(null, geom);
    expect(other.volumeIds.size).toBe(0);
  });
});

describe("street overlay hiding", () => {
  it("matches street outlines and walks that touch a street node", () => {
    const geom = buildSceneGeometry(topology, { stationId: "HUBKGX" });
    const hidden = streetVolumeIds(geom);
    expect(hidden.has("street")).toBe(true);
    const wires = geom.polylines.filter(
      (p) => p.volumeId && hidden.has(p.volumeId),
    );
    expect(wires.length).toBe(hidden.size);
    const walks = geom.polylines.filter(
      (p) => p.role === "connection" && polylineTouchesVolumeIds(p, hidden),
    );
    expect(walks.length).toBeGreaterThan(0);
    expect(
      geom.polylines.some((p) => !polylineTouchesVolumeIds(p, hidden)),
    ).toBe(true);
    expect(polylineTouchesVolumeIds(wires[0]!, hidden)).toBe(true);
  });
});

describe("cameraFrame", () => {
  it("looks at the bounds center from the south (facing north)", () => {
    const geom = buildSceneGeometry(topology);
    const frame = cameraFrame(geom.bounds);
    expect(frame.target).toEqual(geom.bounds.center);
    expect(frame.position[1]).toBeGreaterThan(frame.target[1]);
    expect(frame.position[0]).toBeCloseTo(frame.target[0], 6);
    expect(frame.position[2]).toBeLessThan(frame.target[2]);
    expect(frame.minPolarAngle).toBe(0);
    expect(frame.maxPolarAngle).toBe(Math.PI);
    expect(frame.minDistance).toBeLessThan(frame.maxDistance);
  });

  it("can keep a smaller minDistance than the framed radius", () => {
    const geom = buildSceneGeometry(topology);
    const frame = cameraFrame(geom.bounds, { minDistance: 4 });
    expect(frame.minDistance).toBe(4);
    expect(frame.maxDistance).toBeGreaterThan(4);
  });

  it("can raise maxDistance and far past the framed radius", () => {
    const geom = buildSceneGeometry(topology);
    const frame = cameraFrame(geom.bounds, {
      maxDistance: 25_000,
      far: 80_000,
    });
    expect(frame.maxDistance).toBe(25_000);
    expect(frame.far).toBe(80_000);
  });
});

describe("dollhouse scale and FOI depth", () => {
  const geom = buildSceneGeometry(topology, {
    quality: "high",
    stationId: "HUBKGX",
  });
  const placed = placeSchematicAt(geom, { x: 0, z: 0 });

  it("makes platform boxes 115 m × 3.5 m after scale", () => {
    const plat = geom.volumes.find((v) => v.type === "platform")!;
    const thin = Math.min(plat.size[0], plat.size[2]) * placed.scale;
    const long = Math.max(plat.size[0], plat.size[2]) * placed.scale;
    expect(thin).toBeCloseTo(3.5, 5);
    expect(long).toBeCloseTo(115, 5);
    expect(PLATFORM_THIN * SCHEMATIC_METRES_PER_UNIT).toBeCloseTo(3.5);
    expect(PLATFORM_LONG * SCHEMATIC_METRES_PER_UNIT).toBeCloseTo(115);
  });

  it("places KGX Northern around −27 m and Circle around −7 m", () => {
    const worldY = (lineId: string) => {
      const vol = geom.volumes.find((v) => v.lineId === lineId)!;
      return vol.position[1] * placed.scale + placed.position[1];
    };
    expect(worldY("northern")).toBeCloseTo(-27, 5);
    expect(worldY("circle")).toBeCloseTo(-7, 5);
  });

  it("uses typical depth when the station has no FOI row, not ~68 m", () => {
    const nodes: SchematicNode[] = [
      {
        id: "street",
        type: "street",
        label: "Street",
        level: 0,
        x: 0,
        y: 0,
      },
      {
        id: "p",
        type: "platform",
        label: "Northern",
        level: -6,
        x: 0,
        y: 0,
        lineId: "northern",
      },
    ];
    const g = buildSceneGeometry(
      { nodes, edges: [] },
      { stationId: "NO_SUCH_STATION" },
    );
    const at = placeSchematicAt(g, { x: 0, z: 0 });
    const plat = g.volumes.find((v) => v.type === "platform")!;
    const worldY = plat.position[1] * at.scale + at.position[1];
    expect(worldY).toBeCloseTo(-25, 5);
    expect(worldY).not.toBeCloseTo(schematicLevelWorldY(-6), 0);
    expect(Math.abs(worldY)).toBeLessThan(40);
  });

  it("puts depthM 0 National Rail at street, not typical NR depth", () => {
    const nodes: SchematicNode[] = [
      {
        id: "street",
        type: "street",
        label: "Street",
        level: 0,
        x: 0,
        y: 0,
      },
      {
        id: "p",
        type: "platform",
        label: "Platform 1",
        level: -2,
        x: 0,
        y: 0,
        lineId: "national-rail",
        depthM: 0,
      },
    ];
    const g = buildSceneGeometry({ nodes, edges: [] }, { stationId: "HUBTEST" });
    const at = placeSchematicAt(g, { x: 0, z: 0 });
    const plat = g.volumes.find((v) => v.type === "platform")!;
    const worldY = plat.position[1] * at.scale + at.position[1];
    expect(worldY).toBeCloseTo(0, 5);
    expect(worldY).not.toBeCloseTo(-8, 0);
  });
});
