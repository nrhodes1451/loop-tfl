import { describe, expect, it } from "vitest";
import {
  annotatePlatformFlags,
  applyExtractOverrides,
  attachLineIds,
  geographyIssues,
  lineIdFromCaption,
  lineIdsFromCaption,
  matchPlatformDepth,
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

  it("keeps both Northern depth rows when the labels differ", () => {
    const euston: FoiPageExtract = {
      ...northern,
      stationId: "HUBEUS",
      depths: [
        {
          label: "NORTHERN LINE (CHARING CROSS BRANCH) PLATFORMS",
          metres: 20.4,
          lineId: "northern",
        },
        {
          label: "NORTHERN LINE (CITY BRANCH) PLATFORMS",
          metres: 29.8,
          lineId: "northern",
        },
        {
          label: "VICTORIA LINE PLATFORMS",
          metres: 29.8,
          lineId: "victoria",
        },
      ],
    };
    const { stations } = mergeStationLayouts([euston]);
    const northernRows = stations[0]!.depths.filter((d) => d.lineId === "northern");
    expect(northernRows.map((d) => d.metres).sort()).toEqual([20.4, 29.8]);
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

describe("matchPlatformDepth", () => {
  const cx = {
    label: "NORTHERN LINE (CHARING CROSS BRANCH) PLATFORMS",
    metres: 20.4,
    lineId: "northern" as const,
  };
  const city = {
    label: "NORTHERN LINE (CITY BRANCH) PLATFORMS",
    metres: 29.8,
    lineId: "northern" as const,
  };
  const victoria = {
    label: "VICTORIA LINE PLATFORMS",
    metres: 29.8,
    lineId: "victoria" as const,
  };

  it("leaves CX marks unset and matches City captions at Euston", () => {
    const depths = [cx, city, victoria];
    expect(
      matchPlatformDepth(
        {
          lineId: "northern",
          caption: "PLATFORM 1 NORTHBOUND TO MORNINGTON CRESCENT",
          platformNumbers: [1],
        },
        depths,
      ),
    ).toEqual({ ambiguous: false });
    expect(
      matchPlatformDepth(
        {
          lineId: "northern",
          caption: "NORTHERN CITY SOUTHBOUND PLATFORM 6 TO KINGS CROSS",
          platformNumbers: [6],
        },
        depths,
      ),
    ).toEqual({ metres: 29.8, ambiguous: false });
  });

  it("matches a platform number in the table caption", () => {
    expect(
      matchPlatformDepth(
        { lineId: "central", caption: "PLATFORM 2", platformNumbers: [2] },
        [
          { label: "PLATFORM 1", metres: 29.9, lineId: "central" },
          { label: "PLATFORM 2", metres: 22.2, lineId: "central" },
        ],
      ),
    ).toEqual({ metres: 22.2, ambiguous: false });
  });

  it("flags two same-caption rows with different metres as ambiguous", () => {
    expect(
      matchPlatformDepth(
        {
          lineId: "piccadilly",
          caption: "PICCADILLY PLATFORM 1",
          platformNumbers: [1],
        },
        [
          { label: "PICCADILLY LINE PLATFORMS", metres: 33.8, lineId: "piccadilly" },
          { label: "PICCADILLY LINE PLATFORMS", metres: 39.6, lineId: "piccadilly" },
        ],
      ),
    ).toEqual({ ambiguous: true });
  });
});

describe("mergeStationLayouts placement", () => {
  it("attaches City depthM and leaves CX unset", () => {
    const page: FoiPageExtract = {
      ...northern,
      stationId: "HUBEUS",
      depths: [
        {
          label: "NORTHERN LINE (CHARING CROSS BRANCH) PLATFORMS",
          metres: 20.4,
          lineId: "northern",
        },
        {
          label: "NORTHERN LINE (CITY BRANCH) PLATFORMS",
          metres: 29.8,
          lineId: "northern",
        },
      ],
      platforms: [
        {
          ...northernMark,
          caption: "PLATFORM 1 NORTHBOUND TO MORNINGTON CRESCENT",
          platformNumbers: [1],
          a: [0.3, 0.2],
          b: [0.3, 0.6],
        },
        {
          ...northernMark,
          caption: "NORTHERN CITY SOUTHBOUND PLATFORM 6 TO KINGS CROSS",
          platformNumbers: [6],
          a: [0.4, 0.2],
          b: [0.4, 0.6],
        },
      ],
    };
    const { stations, placementIssues } = mergeStationLayouts([page]);
    const p1 = stations[0]!.platforms.find((p) => p.platformNumbers.includes(1));
    const p6 = stations[0]!.platforms.find((p) => p.platformNumbers.includes(6));
    expect(p1?.depthM).toBeUndefined();
    expect(p6?.depthM).toBe(29.8);
    expect(placementIssues.map((i) => i.reason)).not.toContain("depth-ambiguous");
  });

  it("reports depth-ambiguous when same-caption rows cannot be matched", () => {
    const page: FoiPageExtract = {
      ...northern,
      depths: [
        { label: "PICCADILLY LINE PLATFORMS", metres: 33.8, lineId: "piccadilly" },
        { label: "PICCADILLY LINE PLATFORMS", metres: 39.6, lineId: "piccadilly" },
      ],
      platforms: [
        {
          ...northernMark,
          caption: "PICCADILLY PLATFORM 1",
          lineId: "piccadilly",
          platformNumbers: [1],
        },
      ],
    };
    const { stations, placementIssues } = mergeStationLayouts([page]);
    expect(stations[0]!.platforms[0]!.depthM).toBeUndefined();
    expect(placementIssues.map((i) => i.reason)).toContain("depth-ambiguous");
    expect(
      reviewExtract([page], [], placementIssues)
        .flatMap((r) => r.reasons),
    ).toContain("depth-ambiguous");
  });

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
    const bakerlooMarkOut = stations[0]!.marks.find((m) => m.lineId === "bakerloo");
    expect(bakerlooMarkOut).toMatchObject({
      placed: false,
      confidence: "high",
      caption: "BAKERLOO LINE PLATFORMS",
    });
    expect(bakerlooMarkOut!.a).toEqual([0.2, 0.5]);
    expect(bakerlooMarkOut!.eastM).not.toBeNull();
  });

  it("keeps a low-confidence mark when the floor is 0", () => {
    const lowMark = {
      ...northernMark,
      confidence: "low" as const,
    };
    const { stations } = mergeStationLayouts([
      { ...northern, platforms: [lowMark] },
    ]);
    expect(stations[0]!.platforms).toHaveLength(1);
    expect(stations[0]!.platforms[0]!.confidence).toBe("low");
    expect(stations[0]!.platforms[0]!.caption).toBe(northernMark.caption);
    expect(stations[0]!.platforms[0]!.a).toEqual(northernMark.a);
    expect(stations[0]!.marks).toHaveLength(1);
    expect(stations[0]!.marks[0]).toMatchObject({
      confidence: "low",
      placed: true,
      caption: northernMark.caption,
    });
  });

  it("anchors on a low-residual sheet instead of the one with more marks", () => {
    const good: FoiPageExtract = {
      ...northern,
      page: 1,
      platforms: [
        northernMark,
        {
          caption: "VICTORIA LINE PLATFORMS",
          lineId: "victoria",
          platformNumbers: [1],
          end: null,
          bearingDeg: 90,
          a: [0.2, 0.5],
          b: [0.65, 0.5],
          grid: null,
          confidence: "high",
        },
      ],
    };
    const noisy: FoiPageExtract = {
      ...northern,
      page: 2,
      platforms: [
        northernMark,
        {
          caption: "NORTHERN LINE PLATFORMS 7 & 8 (SOUTH END)",
          lineId: "northern",
          platformNumbers: [7, 8],
          end: "south",
          bearingDeg: 90,
          a: [0.55, 0.2],
          b: [0.55, 0.55],
          grid: null,
          confidence: "high",
        },
        {
          caption: "VICTORIA LINE PLATFORMS",
          lineId: "victoria",
          platformNumbers: [1],
          end: null,
          bearingDeg: 90,
          a: [0.7, 0.2],
          b: [0.7, 0.55],
          grid: null,
          confidence: "high",
        },
      ],
    };
    const { stations } = mergeStationLayouts([good, noisy]);
    const northernPlat = stations[0]!.platforms.find(
      (p) => p.lineId === "northern",
    )!;
    expect(northernPlat.sources).toEqual([{ file: northern.file, page: 1 }]);
    expect(northernPlat.residual).toBeLessThan(0.35);
  });
});

describe("bearing review reasons", () => {
  it("flags a sheet whose bearings match the a→b pixel slope", () => {
    const page: FoiPageExtract = {
      ...northern,
      platforms: [
        {
          ...northernMark,
          bearingDeg: 0,
          a: [0.2, 0.4],
          b: [0.5, 0.4],
        },
      ],
    };
    const hit = reviewExtract([page]);
    expect(hit[0]!.reasons).toContain("bearing-from-slope");
  });

  it("does not flag a clean rose bearing that is not the pixel slope", () => {
    const page: FoiPageExtract = {
      ...northern,
      platforms: [northernMark],
    };
    const hit = reviewExtract([page]).find((r) => r.page === northern.page);
    expect(hit?.reasons ?? []).not.toContain("bearing-from-slope");
    expect(hit?.reasons ?? []).not.toContain("bearing-conflict");
  });

  it("flags parallel boxes that were given different bearings", () => {
    const page: FoiPageExtract = {
      ...northern,
      platforms: [
        {
          ...northernMark,
          platformNumbers: [7],
          bearingDeg: 0,
          a: [0.3, 0.2],
          b: [0.3, 0.6],
        },
        {
          ...northernMark,
          caption: "PLATFORM 8",
          platformNumbers: [8],
          bearingDeg: 40,
          a: [0.4, 0.2],
          b: [0.4, 0.6],
        },
      ],
    };
    const hit = reviewExtract([page]);
    expect(hit[0]!.reasons).toContain("bearing-conflict");
  });

  it("flags a merged platform more than 40° from every neighbour chord", () => {
    const { stations } = mergeStationLayouts([
      { ...northern, platforms: [northernMark] },
    ]);
    const chords = { [`${northern.stationId}\0northern`]: [90] };
    const issues = geographyIssues(stations, chords);
    expect(issues.map((i) => i.reason)).toContain("bearing-vs-geography");
    const flagged = annotatePlatformFlags(stations, issues, chords);
    expect(flagged[0]!.platforms[0]!.flags).toContain("bearing-vs-geography");
  });
});
