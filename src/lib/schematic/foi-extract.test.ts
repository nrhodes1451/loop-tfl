import { describe, expect, it } from "vitest";
import {
  applyExtractOverrides,
  attachLineIds,
  lineIdFromCaption,
  lineIdsFromCaption,
  foiSheetStem,
  mergeNorthDeg,
  mergeStationLayouts,
  parseObservedLayout,
  parseObservedPlacement,
  reviewExtract,
  type FoiPageExtract,
} from "./foi-extract";

describe("lineIdFromCaption", () => {
  it("maps a printed depth-table caption to a schematic line id", () => {
    expect(lineIdFromCaption("Northern Line Platforms")).toBe("northern");
    expect(lineIdFromCaption("Bakerloo line")).toBe("bakerloo");
    expect(lineIdFromCaption("H&C")).toBe("hammersmith-city");
    expect(lineIdFromCaption("East London Line Platforms")).toBe(
      "london-overground",
    );
  });

  it("returns null for unknown or mixed captions", () => {
    expect(lineIdFromCaption("LMS")).toBeNull();
    expect(lineIdFromCaption("Network Rail")).toBeNull();
    expect(lineIdFromCaption("Circle / District / H&C")).toBeNull();
  });

  it("splits mixed captions into several line ids", () => {
    expect(lineIdsFromCaption("Circle / District / H&C")).toEqual([
      "hammersmith-city",
      "circle",
      "district",
    ]);
  });
});

describe("attachLineIds", () => {
  it("expands a mixed caption into one row per line", () => {
    const rows = attachLineIds([
      { label: "Circle / H&C / Met", metres: 8, lineId: null },
    ]);
    expect(rows.map((r) => r.lineId).sort()).toEqual([
      "circle",
      "hammersmith-city",
      "metropolitan",
    ]);
    expect(rows.every((r) => r.metres === 8)).toBe(true);
  });
});

describe("foiSheetStem", () => {
  it("joins the sheet filename and page into one stem", () => {
    expect(foiSheetStem("3d bakerloo stations Redacted.pdf", 10)).toBe(
      "3d_bakerloo_stations_Redacted-10",
    );
  });
});

describe("parseObservedLayout", () => {
  it("reads an observation body and metres aliases", () => {
    const hit = parseObservedLayout({
      northDeg: 42.5,
      depths: [{ label: "Northern Line Platforms", meters: "19.5m" }],
      confidence: "high",
      raw: "ok",
    });
    expect(hit.northDeg).toBe(42.5);
    expect(hit.depths).toEqual([
      { label: "Northern Line Platforms", metres: 19.5, lineId: "northern" },
    ]);
    expect(hit.confidence).toBe("high");
  });

  it("defaults missing fields without inventing depths", () => {
    const hit = parseObservedLayout({ confidence: "low", raw: "no table" });
    expect(hit.northDeg).toBeNull();
    expect(hit.depths).toEqual([]);
    expect(hit.confidence).toBe("low");
  });

  it("treats an absent observation as empty rather than throwing", () => {
    const hit = parseObservedLayout({});
    expect(hit.northDeg).toBeNull();
    expect(hit.depths).toEqual([]);
  });
});

const bakerloo: FoiPageExtract = {
  file: "3d bakerloo stations Redacted.pdf",
  page: 4,
  stationId: "940GZZLUEMB",
  northDeg: 10,
  depths: [{ label: "Bakerloo Line Platforms", metres: 16, lineId: "bakerloo" }],
  platforms: [],
  confidence: "high",
  raw: "",
};

const northern: FoiPageExtract = {
  file: "3d northern line stations Redacted.pdf",
  page: 8,
  stationId: "940GZZLUEMB",
  northDeg: 12,
  depths: [{ label: "Northern Line Platforms", metres: 19.5, lineId: "northern" }],
  platforms: [],
  confidence: "high",
  raw: "",
};

describe("mergeStationLayouts", () => {
  it("prefers high-confidence depths when labels collide", () => {
    const low: FoiPageExtract = {
      ...bakerloo,
      page: 5,
      confidence: "low",
      depths: [{ label: "Bakerloo Line Platforms", metres: 99, lineId: "bakerloo" }],
    };
    const { stations } = mergeStationLayouts([low, bakerloo]);
    expect(stations[0]!.depths.find((d) => d.lineId === "bakerloo")?.metres).toBe(
      16,
    );
  });

  it("unions depths and averages agreeing north", () => {
    const { stations, northConflicts } = mergeStationLayouts([bakerloo, northern]);
    expect(northConflicts).toEqual([]);
    expect(stations).toHaveLength(1);
    expect(stations[0]!.stationId).toBe("940GZZLUEMB");
    expect(stations[0]!.northDeg).toBeCloseTo(11);
    expect(stations[0]!.depths.map((d) => d.lineId).sort()).toEqual([
      "bakerloo",
      "northern",
    ]);
  });

  it("flags north when high-confidence pages disagree", () => {
    const other: FoiPageExtract = { ...northern, northDeg: 90 };
    const { stations, northConflicts } = mergeStationLayouts([bakerloo, other]);
    expect(northConflicts).toEqual(["940GZZLUEMB"]);
    expect(stations[0]!.northDeg).toBeNull();
  });
});

describe("mergeNorthDeg", () => {
  it("wraps angles across 0°", () => {
    const pages: FoiPageExtract[] = [
      { ...bakerloo, northDeg: 350 },
      { ...northern, northDeg: 10 },
    ];
    expect(mergeNorthDeg(pages)).toBeCloseTo(0);
  });
});

describe("applyExtractOverrides and reviewExtract", () => {
  it("patches a page and clears review when complete", () => {
    const incomplete: FoiPageExtract = {
      file: "3d bakerloo stations Redacted.pdf",
      page: 1,
      stationId: "HUBCHX",
      northDeg: null,
      depths: [],
      platforms: [],
      confidence: "low",
      raw: "unclear",
    };
    expect(reviewExtract([incomplete]).map((r) => r.reasons).flat()).toEqual(
      expect.arrayContaining([
        "low-confidence",
        "no-depths",
        "no-north",
        "no-placement",
      ]),
    );
    const merged = applyExtractOverrides(
      [incomplete],
      [
        {
          file: incomplete.file,
          page: 1,
          northDeg: 45,
          depths: [{ label: "Bakerloo", metres: 12, lineId: "bakerloo" }],
          platforms: [
            {
              caption: "BAKERLOO LINE PLATFORMS",
              lineId: "bakerloo",
              platformNumbers: [1, 2],
              end: null,
              bearingDeg: 90,
              a: [0.2, 0.4],
              b: [0.6, 0.4],
              grid: null,
              confidence: "high",
            },
          ],
          confidence: "high",
          note: "hand",
        },
      ],
    );
    expect(reviewExtract(merged)).toEqual([]);
    expect(merged[0]!.northDeg).toBe(45);
    expect(merged[0]!.note).toBe("hand");
    expect(merged[0]!.platforms).toHaveLength(1);
  });

  it("skips reviewed pages even when the table is absent", () => {
    const empty: FoiPageExtract = {
      file: "3d circle stations Redacted.pdf",
      page: 12,
      stationId: "HUBKGX",
      northDeg: 135,
      depths: [],
      platforms: [],
      confidence: "high",
      raw: "no table",
    };
    const merged = applyExtractOverrides(
      [empty],
      [{ file: empty.file, page: 12, reviewed: true, note: "no table on sheet" }],
    );
    expect(reviewExtract(merged)).toEqual([]);
    expect(merged[0]!.reviewed).toBe(true);
  });
});

const northernMark = {
  caption: "NORTHERN LINE PLATFORMS 7 & 8 (NORTH END)",
  lineId: "northern" as const,
  platformNumbers: [7, 8],
  end: "north" as const,
  bearingDeg: 0,
  a: [0.4, 0.2],
  b: [0.4, 0.55],
  grid: "G4",
  confidence: "high" as const,
};

describe("parseObservedPlacement", () => {
  it("reads endpoints, numbers, and a ticket-hall reference", () => {
    const hit = parseObservedPlacement(`{
      "platforms": [{
        "caption": "PLATFORMS 7 & 8 (NORTH END)",
        "lineId": "northern",
        "platformNumbers": [7, 8],
        "end": "north",
        "bearingDeg": 0,
        "a": [0.40, 0.20],
        "b": [0.40, 0.55],
        "grid": "G4",
        "confidence": "high"
      }],
      "reference": { "label": "Western Ticket Hall", "at": [0.2, 0.3] },
      "confidence": "high",
      "raw": "ok"
    }`);
    expect(hit.platforms).toHaveLength(1);
    expect(hit.platforms[0]!.lineId).toBe("northern");
    expect(hit.platforms[0]!.platformNumbers).toEqual([7, 8]);
    expect(hit.platforms[0]!.a).toEqual([0.4, 0.2]);
    expect(hit.reference?.label).toBe("Western Ticket Hall");
  });

  it("drops marks without endpoints rather than inventing them", () => {
    const hit = parseObservedPlacement({
      platforms: [{ caption: "guess", bearingDeg: 90 }],
      confidence: "low",
      raw: "redacted",
    });
    expect(hit.platforms).toEqual([]);
    expect(hit.confidence).toBe("low");
  });

  it("reads an observation with no platforms key as unrecorded", () => {
    const hit = parseObservedPlacement({ northDeg: 90, depths: [] });
    expect(hit.platforms).toEqual([]);
    expect(hit.reference).toBeUndefined();
  });
});

describe("mergeStationLayouts placement", () => {
  it("folds a second sheet in when a platform is shared", () => {
    const bakerlooMark = {
      caption: "BAKERLOO LINE PLATFORMS",
      lineId: "bakerloo" as const,
      platformNumbers: [3, 4],
      end: null,
      bearingDeg: 90,
      a: [0.2, 0.5],
      b: [0.55, 0.5],
      grid: null,
      confidence: "high" as const,
    };
    const pageA: FoiPageExtract = {
      ...northern,
      platforms: [northernMark],
    };
    const pageB: FoiPageExtract = {
      ...bakerloo,
      platforms: [northernMark, bakerlooMark],
    };
    const { stations } = mergeStationLayouts([pageA, pageB]);
    expect(stations[0]!.platforms.map((p) => p.lineId).sort()).toEqual([
      "bakerloo",
      "northern",
    ]);
  });

  it("skips a sheet with no overlapping platform", () => {
    const victoriaMark = {
      caption: "VICTORIA LINE PLATFORMS",
      lineId: "victoria" as const,
      platformNumbers: [3, 4],
      end: null,
      bearingDeg: 90,
      a: [0.25, 0.45],
      b: [0.7, 0.45],
      grid: null,
      confidence: "high" as const,
    };
    const bakerlooOnly: FoiPageExtract = {
      ...bakerloo,
      platforms: [
        {
          caption: "BAKERLOO LINE PLATFORMS",
          lineId: "bakerloo",
          platformNumbers: [3],
          end: null,
          bearingDeg: 90,
          a: [0.2, 0.5],
          b: [0.55, 0.5],
          grid: null,
          confidence: "high",
        },
      ],
    };
    const pageN: FoiPageExtract = {
      ...northern,
      platforms: [northernMark, victoriaMark],
    };
    const { stations } = mergeStationLayouts([pageN, bakerlooOnly]);
    expect(stations[0]!.platforms.map((p) => p.lineId).sort()).toEqual([
      "northern",
      "victoria",
    ]);
  });
});
