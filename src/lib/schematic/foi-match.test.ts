import { describe, expect, it } from "vitest";
import {
  applyFoiOverrides,
  extractOcrTitle,
  lineIdFromFilename,
  matchFoiPage,
  normalizeFoiName,
  unresolvedFoiPages,
  type FoiPage,
  type FoiStation,
} from "./foi-match";

const stations: FoiStation[] = [
  {
    id: "HUBKGX",
    name: "King's Cross St Pancras",
    lineIds: ["circle", "northern", "piccadilly", "victoria"],
  },
  {
    id: "940GZZLUKBY",
    name: "Kingsbury",
    lineIds: ["jubilee"],
  },
  {
    id: "HUBEPH",
    name: "Elephant & Castle",
    lineIds: ["bakerloo", "northern"],
  },
  {
    id: "940GZZLUEGW",
    name: "Edgware",
    lineIds: ["northern"],
  },
  {
    id: "940GZZLUERB",
    name: "Edgware Road",
    lineIds: ["bakerloo"],
  },
  {
    id: "940GZZLUERC",
    name: "Edgware Road",
    lineIds: ["circle", "district", "hammersmith-city"],
  },
  {
    id: "HUBCHX",
    name: "Charing Cross",
    lineIds: ["bakerloo", "northern"],
  },
  {
    id: "HUBBAN",
    name: "Bank",
    lineIds: ["central", "northern"],
  },
  {
    id: "940GZZLUBNK",
    name: "Bank",
    lineIds: ["central"],
  },
  {
    id: "HUBSPB",
    name: "Shepherd's Bush",
    lineIds: ["central"],
  },
  {
    id: "940GZZLUSBM",
    name: "Shepherd's Bush Market",
    lineIds: ["circle", "hammersmith-city"],
  },
  {
    id: "HUBPAD",
    name: "Paddington",
    lineIds: ["bakerloo", "circle", "district"],
  },
  {
    id: "940GZZLURGP",
    name: "Regent's Park",
    lineIds: ["bakerloo"],
  },
  {
    id: "HUBWAT",
    name: "Waterloo",
    lineIds: ["bakerloo", "jubilee", "northern"],
  },
  {
    id: "940GZZLUTWH",
    name: "Tower Hill",
    lineIds: ["circle", "district"],
  },
  {
    id: "940GZZLUTCR",
    name: "Tottenham Court Road",
    lineIds: ["central", "northern"],
  },
];

describe("normalizeFoiName", () => {
  it("strips punctuation, expands &, and drops a trailing station", () => {
    expect(normalizeFoiName("KING'S CROSS ST. PANCRAS STATION")).toBe(
      "kings cross st pancras",
    );
    expect(normalizeFoiName("Elephant & Castle Station")).toBe(
      "elephant and castle",
    );
  });
});

describe("extractOcrTitle", () => {
  it("prefers a STATION title line over body text", () => {
    const ocr = [
      "LONDON UNDERGROUND",
      "BAKERLOO LINE",
      "REGENT'S PARK STATION",
      "Platform 1 northbound",
    ].join("\n");
    expect(extractOcrTitle(ocr)).toBe("REGENT'S PARK STATION");
  });
});

describe("lineIdFromFilename", () => {
  it("reads the line from the FOI filename", () => {
    expect(lineIdFromFilename("3d bakerloo stations Redacted.pdf")).toBe(
      "bakerloo",
    );
    expect(
      lineIdFromFilename("3d northern line stations Redacted.pdf"),
    ).toBe("northern");
    expect(lineIdFromFilename("3d circle stations Redacted.pdf")).toBe(
      "circle",
    );
  });
});

describe("matchFoiPage", () => {
  it("matches an exact network name", () => {
    const hit = matchFoiPage("REGENT'S PARK STATION", stations, "bakerloo");
    expect(hit.match).toBe("exact");
    expect(hit.stationId).toBe("940GZZLURGP");
    expect(hit.ocrTitle).toBe("REGENT'S PARK STATION");
  });

  it("aliases King's Cross / St Pancras to HUBKGX", () => {
    const a = matchFoiPage("KING'S CROSS STATION", stations, "northern");
    expect(a.stationId).toBe("HUBKGX");
    expect(a.match).toBe("exact");
    const b = matchFoiPage("ST. PANCRAS STATION", stations, "victoria");
    expect(b.stationId).toBe("HUBKGX");
  });

  it("does not confuse Kingsbury with King's Cross", () => {
    const hit = matchFoiPage("KINGSBURY STATION", stations, "jubilee");
    expect(hit.stationId).toBe("940GZZLUKBY");
  });

  it("prefers a HUB id when names match", () => {
    const hit = matchFoiPage("BANK STATION", stations, "central");
    expect(hit.stationId).toBe("HUBBAN");
    expect(hit.match).toBe("exact");
  });

  it("uses the PDF line to split the two Edgware Roads", () => {
    const bakerloo = matchFoiPage("EDGWARE ROAD STATION", stations, "bakerloo");
    expect(bakerloo.stationId).toBe("940GZZLUERB");
    expect(bakerloo.match).toBe("exact");
    const circle = matchFoiPage("EDGWARE ROAD STATION", stations, "circle");
    expect(circle.stationId).toBe("940GZZLUERC");
  });

  it("keeps Shepherd's Bush distinct from the Market", () => {
    const bush = matchFoiPage("SHEPHERD'S BUSH STATION", stations, "central");
    expect(bush.stationId).toBe("HUBSPB");
    const market = matchFoiPage(
      "SHEPHERD'S BUSH MARKET STATION",
      stations,
      "circle",
    );
    expect(market.stationId).toBe("940GZZLUSBM");
  });

  it("matches Elephant & Castle through normalisation", () => {
    const hit = matchFoiPage("ELEPHANT AND CASTLE STATION", stations, "northern");
    expect(hit.stationId).toBe("HUBEPH");
    expect(hit.match).toBe("exact");
  });

  it("maps Edgware Rd on the Bakerloo PDF to Edgware Road, not Edgware", () => {
    const hit = matchFoiPage(
      "Edgware Rd (Bakerloo)\nAxonometric",
      stations,
      "bakerloo",
    );
    expect(hit.stationId).toBe("940GZZLUERB");
  });

  it("matches a truncated title from a rotated title-block crop", () => {
    const ocr = [
      "STATION LAYOUT",
      "Charing Cro",
      "Plotted by : mikedavies1 LUL MStnV8 (fsu)",
    ].join("\n");
    const hit = matchFoiPage(ocr, stations, "bakerloo");
    expect(hit.stationId).toBe("HUBCHX");
    expect(hit.match).toBe("fuzzy");
  });

  it("returns unmatched when nothing is close", () => {
    const hit = matchFoiPage("VENT SHAFT SCHEDULE", stations, "bakerloo");
    expect(hit.match).toBe("unmatched");
    expect(hit.stationId).toBeNull();
  });

  it("returns ambiguous when two stations score equally", () => {
    const twins: FoiStation[] = [
      { id: "A", name: "West Acton", lineIds: ["central"] },
      { id: "B", name: "East Acton", lineIds: ["central"] },
    ];
    const hit = matchFoiPage("ACTON STATION", twins, null);
    expect(hit.match).toBe("ambiguous");
    expect(hit.stationId).toBeNull();
    expect(hit.candidates.map((c) => c.id).sort()).toEqual(["A", "B"]);
  });
});

describe("applyFoiOverrides", () => {
  const pages: FoiPage[] = [
    {
      file: "3d bakerloo stations Redacted.pdf",
      page: 1,
      stationId: null,
      stationName: null,
      match: "unmatched",
      ocrTitle: "",
      candidates: [],
    },
    {
      file: "3d bakerloo stations Redacted.pdf",
      page: 2,
      stationId: "940GZZLURGP",
      stationName: "Regent's Park",
      match: "exact",
      ocrTitle: "REGENT'S PARK STATION",
      candidates: [],
    },
  ];

  it("fills a cover page so it is no longer unresolved", () => {
    const merged = applyFoiOverrides(
      pages,
      [
        {
          file: "3d bakerloo stations Redacted.pdf",
          page: 1,
          stationId: null,
          note: "cover",
        },
      ],
      stations,
    );
    expect(merged[0]!.match).toBe("override");
    expect(merged[0]!.stationId).toBeNull();
    expect(merged[0]!.note).toBe("cover");
    expect(unresolvedFoiPages(merged)).toHaveLength(0);
  });

  it("can force a station id and looks up the network name", () => {
    const merged = applyFoiOverrides(
      pages,
      [
        {
          file: "3d bakerloo stations Redacted.pdf",
          page: 2,
          stationId: "HUBWAT",
          note: "misread OCR",
        },
      ],
      stations,
    );
    expect(merged[1]).toMatchObject({
      match: "override",
      stationId: "HUBWAT",
      stationName: "Waterloo",
    });
  });
});
