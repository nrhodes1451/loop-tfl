# Loop / Stepfree

Unofficial London public-transport accessibility tool. **Loop** plans a single street-to-street step-free journey; **Stepfree** is the optional network graph. Not affiliated with Transport for London.

Live: [loop.penrose.tools](https://loop.penrose.tools)

## Stack

Next.js App Router, TypeScript, Tailwind, Motion, d3-force (canvas), React Three Fiber (schematic), Inter + IBM Plex Mono.

## Routes

| Path | What it is |
|------|------------|
| `/` | Loop — mobile-first step-free route planner |
| `/explore` | Stepfree — force-directed accessibility graph |
| `/schematic` | Redirects to King’s Cross. Per-station views at `/schematic/[stationId]` (King’s Cross is hand-authored, others generated). Not used for routing |
| `/api/disruptions` | Live TfL lift outages (`LiftUniqueId` join) |
| `/api/network/lines` | Inter-station line chains, platform anchors, and bearings for the 3D tubes (from `data/schematic/lines.json`) |
| `/api/osm/tiles` | Version of the PMTiles extract, keying the tile URLs (404 if the file is missing) |
| `/api/osm/tiles/[v]/[z]/[x]/[y]` | One MVT tile, gzipped, `immutable` (204 where the extract has no tile) |
| `/api/osm/london.pmtiles` | Range-served Greater London PMTiles extract (404 if the file is missing) |
| `/api/schematic/[stationId]` | JSON for one station schematic (used to load neighbours in the 3D view) |

The 3D view reads tiles one URL at a time rather than range-requesting the archive in the browser, so the disk cache serves repeat pans. `v` is a digest of the extract's size and mtime, which is what makes `immutable` safe: a rebuilt extract lands on fresh URLs instead of needing revalidation.

## Data sources

| Data | Source |
|------|--------|
| Station–station rides | `GET /Line/Mode/{mode}` + `GET /Line/{id}/Route/Sequence/all` |
| Lift / platform topology | `https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip` |
| Live outages | `GET /Disruptions/Lifts/v2` (join on `LiftUniqueId`) |
| OSM land, water, and buildings (schematic surface) | Greater London PMTiles extract (`npm run fetch-london-pmtiles`), served per-tile from `/api/osm/tiles/[v]/[z]/[x]/[y]` |

Static topology is persisted in `data/network.json` (regenerate with the script below). That file includes undirected graph `edges`, directed `rides`, street↔platform `platformLiftChains`, and platform↔platform `interchangeChains`. Invented station schematics are generated from those chains into `data/schematic/generated/` (`npm run build-schematics`; also run at the end of `refresh-network`). The same script writes `data/schematic/lines.json` (gitignored): line chains, platform-centroid anchors, and per-station bearings for the 3D tubes. King’s Cross (`data/schematic/HUBKGX.json`) is a hand-authored override. The 3D view overlays OSM land, water, and building footprints from the London PMTiles extract (`data/osm/london.pmtiles`, regenerate with `npm run fetch-london-pmtiles`) when that file is present, and draws inter-station tubes at schematic platform depth (Lines toggle; same zoom window as the station dollhouses). Live disruptions are fetched at runtime via `/api/disruptions` with a ~60s in-memory TTL. There is no fabricated fallback data — if the live feed fails, the UI shows an explicit error and statuses degrade to unknown.

## Setup

```bash
npm install
npm run refresh-network   # writes data/network.json and generated schematics from TfL APIs
npm run build-schematics  # regenerate schematics + lines.json from existing network.json
npm run fetch-london-pmtiles  # Greater London PMTiles extract (gitignored)
npm run dev
```

Optional: set `TFL_APP_KEY` (see `.env.example`) for higher rate limits.

FOI axonometric page index (local scans in `data/pdf/`, gitignored):

```bash
sudo apt install poppler-utils   # pdftoppm; tesseract-ocr optional (script falls back to tesseract.js)
npm run index-foi-pages   # writes data/foi/pages.json; edit data/foi/pages.overrides.json for misses
```

```bash
npm test                  # topology, status derivation, pathfinder, schematic
npm run build-schematics  # regenerate generated/ + lines.json (local data job)
npm run build             # next build only — does not invent schematic JSON
```

## Deploy

Hosted on Cloud Run (`loop` in `us-east4`), mapped to `loop.penrose.tools`. From the repo root, generate schematic artifacts locally and ensure `data/osm/london.pmtiles` is present (`npm run fetch-london-pmtiles` if you do not have the extract yet):

```bash
npm run build-schematics
```

```bash
gcloud run deploy loop \
  --source . \
  --project penrose-tools \
  --region us-east4 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 5
```

`data/osm/london.pmtiles`, `data/schematic/generated/`, `data/schematic/index.json`, and `data/schematic/lines.json` are gitignored. `.gcloudignore` follows `.gitignore` then un-ignores those paths so `--source .` uploads them. Cloud Build does not fetch PMTiles or regenerate schematics; if they are absent at deploy time, OSM tiles and/or tubes 404.

Cloud Build runs `npm run build` (`next build` only) and starts with `next start`. Optional: set `TFL_APP_KEY` on the service for higher TfL rate limits.

Custom domain: Cloud Run domain mapping in `us-east4` plus a Squarespace CNAME `loop` → `ghs.googlehosted.com`. Certificate issuance can take up to 24 hours after the mapping is created.

## Planner verdicts

Loop returns one route and an honest verdict:

- **Step-free throughout** — boarding, interchange, and alighting lifts are in service
- **Step-free route breaks** — a required lift is out; the attempted path stays visible and later legs are marked unreachable. Replan can exclude the broken interchange
- **Probably step-free** — the path exists but live status is missing or older than ~15 minutes
- **No step-free route** — structural gap (not a live fault); offers the nearest step-free station

## Scope

- Station → station planning on tube, Elizabeth line, DLR, Overground, tram
- One route, live lift check, replan excluding a broken interchange
- Explore graph: expand stations into platform/lift nodes (max 3); National Rail is interchange context only, not a rideable mode
- Schematic: every network station, invented layout, not to scale, not for wayfinding, isolated from routing. Stations sit on a geographic 3D surface; neighbours load via `/api/schematic/[stationId]`. Inter-station tubes follow `network.json` edges at schematic platform depth and colour; platforms rotate to the line bearing. King’s Cross is a hand-authored override. OSM land, water, and buildings overlay when `data/osm/london.pmtiles` is present.
- Out of scope: walking directions, buses, National Rail routing, fares, ETAs, accounts

## License

Code is [MIT](LICENSE). Topology and live disruptions come from Transport for London and remain subject to [TfL's terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service). OSM land, water, and buildings are © OpenStreetMap contributors; tiles from [Protomaps](https://protomaps.com/). This project is not affiliated with TfL.
