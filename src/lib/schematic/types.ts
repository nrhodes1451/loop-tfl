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
  /** TfL LiftUniqueId when type is lift. */
  liftId?: string;
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
};

export type SchematicStationRef = {
  id: string;
  name: string;
};

export type SchematicIndex = {
  generatedAt: string;
  stations: SchematicStationRef[];
};
