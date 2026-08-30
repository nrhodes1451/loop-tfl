/**
 * Illustrative station geometry only. Do not import from plan/status/topology.
 * Depth `level` is a schematic tier, never metres used for access decisions.
 */

export type SchematicNodeType =
  | "street"
  | "concourse"
  | "platform"
  | "lift"
  | "shaft";

export type SchematicEdgeMode = "lift" | "stairs" | "escalator" | "level";

export type SchematicEntrance = {
  lat: number;
  lon: number;
  source: string;
  label: string;
};

export type SchematicNode = {
  id: string;
  type: SchematicNodeType;
  label: string;
  /** Relative depth tier, not metres. 0 = street, negative = below. */
  level: number;
  /** Schematic plan coordinates; no relation to real-world scale. */
  x: number;
  y: number;
  /** Platforms only. */
  lineId?: string;
  /** Platforms only. TfL cardinal, e.g. North / South. */
  direction?: string;
  /**
   * Platforms only. Undirected compass bearing in degrees clockwise from
   * north (0–180), from FOI sheets when present.
   */
  bearingDeg?: number;
  /** Platforms only. Metres below street; overrides FOI/typical when set. */
  depthM?: number;
  /** Platforms only. FOI mark that produced x/y/bearingDeg, when present. */
  foi?: SchematicFoiPlacement;
  /** Platforms only. OSM way that produced x/y/bearingDeg, when present. */
  osm?: SchematicOsmPlacement;
  /** TfL LiftUniqueId when type is lift. */
  liftId?: string;
};

export type SchematicOsmPlacement = {
  wayId: number;
  eastM: number;
  northM: number;
  ref?: string;
};

export type SchematicFoiPlacement = {
  confidence: "high" | "low";
  caption: string;
  eastM: number;
  northM: number;
  end?: "north" | "south" | "east" | "west" | null;
  a?: [number, number];
  b?: [number, number];
  grid?: string | null;
  residual?: number;
  flags?: string[];
};

/** Every FOI sheet mark for this station, including those not used for x/y. */
export type SchematicFoiMark = {
  file: string;
  page: number;
  caption: string;
  lineId: string | null;
  platformNumbers: number[];
  end: "north" | "south" | "east" | "west" | null;
  bearingDeg: number | null;
  a: [number, number];
  b: [number, number];
  grid: string | null;
  confidence: "high" | "low";
  eastM: number | null;
  northM: number | null;
  residual: number | null;
  placed: boolean;
};

export type SchematicEdge = {
  from: string;
  to: string;
  mode: SchematicEdgeMode;
  liftId?: string;
};

export type SchematicStation = {
  stationId: string;
  name: string;
  disclaimer: string;
  entrance: SchematicEntrance;
  nodes: SchematicNode[];
  edges: SchematicEdge[];
  /** Optional layout notes (CULG sanity-check, etc.). Not for routing. */
  notes?: string;
  /** All FOI marks for this station, including unused / low-confidence. */
  foiMarks?: SchematicFoiMark[];
};

export type SchematicStationRef = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type SchematicIndex = {
  generatedAt: string;
  stations: SchematicStationRef[];
};
