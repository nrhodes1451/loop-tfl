---
name: foi-sheet-reading
description: Read TfL FOI axonometric station sheets and record platform depths, compass north, and platform placement into data/foi/observations/. Use when filling or correcting FOI observations, when npm run foi:build reports no-observation or no-placement, or when the user asks to read FOI sheets or drawings.
disable-model-invocation: true
---

# Reading FOI axonometric sheets

The sheets are ~2015 TfL FOI scans in `data/pdf/` (gitignored). Reading them is a
step in the loop that only the agent can do; the scripts either side of it are
deterministic and offline.

```
npm run foi:render          # pdftoppm + 270° rotate → data/pdf/.pages/<sheet>-read.png and -read.jpg
  read sheets, write data/foi/observations/<sheet>.json
npm run foi:build           # merge → data/foi/extract.json + layout.json
npm run foi:build -- --todo # what still needs reading
```

Read `data/pdf/.pages/<sheet>-read.jpg` (1536px long edge, landscape reading pose)
rather than the 200-dpi PNG unless you need to zoom into a table or a compass
rose. Do not use a leftover `-view.jpg`; that file is the unrotated raster.

The raster **is** the reading pose. `a`, `b`, `reference.at`, and `northDeg` are
all measured on that one image. North is up on many sheets (Pimlico) but not
all, so the rose still has to be read.

## Observation file

One file per sheet at `data/foi/observations/<sheet>.json`, where `<sheet>` is
the PDF filename with spaces as underscores, `.pdf` dropped, and `-<page>`
appended: `3d bakerloo stations Redacted.pdf` page 10 becomes
`3d_bakerloo_stations_Redacted-10.json`.

```json
{
  "northDeg": 135,
  "depths": [{ "label": "VICTORIA LINE PLATFORMS", "metres": 15.7 }],
  "platforms": [
    {
      "caption": "NORTHERN LINE PLATFORMS 7 & 8 (NORTH END)",
      "lineId": "northern",
      "platformNumbers": [7, 8],
      "end": "north",
      "bearingDeg": 0,
      "a": [0.4, 0.2],
      "b": [0.4, 0.55],
      "grid": "G4",
      "confidence": "high"
    }
  ],
  "reference": { "label": "Western Ticket Hall", "at": [0.2, 0.3] },
  "confidence": "high",
  "raw": "King's Cross rose N at 135 degrees."
}
```

`confidence` and `raw` describe the whole sheet reading. An **absent**
`platforms` key means the placement pass has not been done on that sheet, which
is what `--todo` reports; an empty array means the sheet was read and no usable
platform box was found. Do not write `"platforms": []` to mean "not yet read".

`data/pdf/` is gitignored but `data/foi/observations/` is committed. These files
are source data, not a cache: nothing can regenerate them.

## Depths and compass

Find:
1. The small table labelled something like "approximate depth below street level" listing platform depths in metres.
2. The drawn compass rose (letter N / north arrow).

Rules:
- northDeg is clockwise degrees from UP on this image. 0 = north points to the top of the image, 90 = north points to the right, 180 = down, 270 = left. null if there is no readable compass.
- depths: one object per printed table row. label is the caption as printed (e.g. "Northern Line Platforms"). metres is the number only. Do not invent metres. If the table is absent, depths is [].
- Do not estimate depth from the drawing geometry.
- confidence is "low" if the table or rose is unreadable, cropped, or you are guessing.
- raw: one short sentence (missing table, rose unclear, etc.).

## Platform placement

Find every drawn passenger platform (the long rectangular boxes, often labelled
PLATFORM / PLATFORMS with a number and an end such as NORTH END / WEST END).

Rules:
- One entry per drawn platform box or labelled pair. caption is the printed label.
- platformNumbers: integers as printed (e.g. PLATFORMS 7 & 8 → [7, 8]). [] if unnumbered.
- end: which labelled end this box is (north/south/east/west). null if unlabelled.
- bearingDeg: compass bearing of the platform long axis, clockwise from **the
  drawn rose on this sheet**, not from the page edge and **not from a and b**.
  0 = runs north–south, 90 = east–west. a/b and bearingDeg are independent
  observations; the projection fit compares them, so a bearing copied from the
  pixel slope carries no information. Undirected (0 and 180 are the same).
  null if you cannot read it.
- Boxes drawn parallel take the **same** bearingDeg.
- a and b: corresponding ends of the platform **long axis** (not opposite
  corners of the isometric parallelogram), in normalised page coordinates
  (0–1, origin top-left, x then y). Parallel boxes should give near-identical
  `b − a` vectors.
- grid: printed grid cell if readable (e.g. "G4"), else null.
- reference: the ticket hall / street building if clearly drawn, else null.
- Never invent endpoints or bearings. confidence "low" when redaction, crop, or
  guesswork is involved. Omit a platform rather than fabricate a and b.
- raw: one short sentence.

Calibration (Pimlico, victoria line stations p4): `northDeg` is 0 (rose points
up). Both platforms share `bearingDeg` about 80. Their `b − a` vectors are
near-identical.

## Working through the queue

`data/foi/pages.json` maps each sheet to a `stationId` and `stationName`. That
name comes from OCR and may be wrong; trust the drawing over the index.

The work is resumable because each sheet is one independent file. Take a batch
of 10 to 15 sheets, read each `-read.jpg`, write its observation file, then run
`npm run foi:build -- --todo` to confirm the queue shrank by that many before
starting the next batch. Never write an observation for a sheet you have not
looked at.

After a batch, `npm run foi:build` reports per-page review reasons:

| Reason | Meaning |
|--------|---------|
| `no-observation` | no file yet for that sheet |
| `no-placement` | file exists, `platforms` key absent |
| `no-depths` / `no-north` | sheet read but the table or rose was unreadable |
| `low-confidence` | you marked the reading uncertain |
| `unknown-line` | a depth caption did not map to a line id |
| `north-disagreement` | sheets for one station disagree on north by more than 20 degrees |
| `placement-residual` | the projection fit for that sheet is too poor to trust |
| `placement-disagreement` | sheets place a shared platform more than 30 m apart |
| `bearing-from-slope` | most marks have bearingDeg copied from the a→b pixel slope |
| `bearing-conflict` | parallel a→b vectors were given different bearings |
| `bearing-vs-geography` | merged bearing is more than 40° from every neighbour chord |

A reason is a prompt to re-read the sheet. Where the drawing itself is wrong or
unreadable and a human has decided the answer, record it in
`data/foi/extract.overrides.json` (keyed by `file` and `page`, with
`"reviewed": true` to drop the page from the review list) rather than editing an
observation to something the sheet does not show.

## Approximation

Depths and plan offsets are reconstructed from 2015 scans. They are approximate,
are never used for routing or access decisions, and `npm run build-schematics`
bakes them into generated node `x`/`y`/`bearingDeg` only as drawing hints.
