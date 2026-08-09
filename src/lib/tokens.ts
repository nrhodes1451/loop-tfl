/** Design tokens from the Stepfree handoff. */

export const colors = {
  canvas: "#0b0d10",
  sidebar: "#101318",
  panel: "#13161b",
  row: "#14171d",
  control: "#16191f",
  controlAlt: "#171b21",
  hover: "#1a1f26",
  borderSubtle: "#1e222a",
  borderCard: "#1f242b",
  border: "#232830",
  borderDivider: "#23272f",
  borderControl: "#262b33",
  borderStrong: "#303743",
  borderDanger: "#3a2226",
  nodeStroke: "#576070",
  textPrimary: "#e9ecf1",
  textSecondary: "#c3c9d2",
  textMuted: "#838a95",
  textFaint: "#6f7681",
  textHint: "#5c626c",
  label: "#aeb5c0",
  ok: "#35c77b",
  disrupted: "#f2565c",
  unknown: "#5f6672",
  noInfra: "#576070",
  platformFill: "#2b3037",
  platformStroke: "#454c57",
  liftDot: "#8b929c",
  white: "#ffffff",
} as const;

/** Official TfL line colours; Northern rendered darker on canvas. */
export const LINE_COLORS: Record<string, string> = {
  bakerloo: "#B36305",
  central: "#E32017",
  circle: "#FFD300",
  district: "#00782A",
  "hammersmith-city": "#F3A9BB",
  jubilee: "#A0A5A9",
  metropolitan: "#9B0056",
  northern: "#000000",
  piccadilly: "#003688",
  victoria: "#0098D4",
  "waterloo-city": "#95CDBA",
  "elizabeth-line": "#6950A1",
  elizabeth: "#6950A1",
  dlr: "#00A4A7",
  "london-overground": "#EE7C0E",
  overground: "#EE7C0E",
  liberty: "#EE7C0E",
  lioness: "#EE7C0E",
  mildmay: "#EE7C0E",
  suffragette: "#EE7C0E",
  windrush: "#EE7C0E",
  weaver: "#EE7C0E",
  tram: "#84B817",
};

export function lineColorForCanvas(lineId: string): string {
  const c = LINE_COLORS[lineId] ?? "#A0A5A9";
  return c === "#000000" ? "#1c1f25" : c;
}

export const MODES = [
  "tube",
  "elizabeth-line",
  "dlr",
  "overground",
  "tram",
] as const;
