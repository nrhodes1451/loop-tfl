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

## Data sources

| Data | Source |
|------|--------|
| Station–station rides | `GET /Line/Mode/{mode}` + `GET /Line/{id}/Route/Sequence/all` |
| Lift / platform topology | `https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip` |
| Live outages | `GET /Disruptions/Lifts/v2` (join on `LiftUniqueId`) |
| OSM buildings (schematic surface) | Greater London PMTiles extract (`npm run fetch-london-pmtiles`) served from `/api/osm/london.pmtiles` |

Static topology is persisted in `data/network.json` (regenerate with the script below). That file includes undirected graph `edges`, directed `rides`, street↔platform `platformLiftChains`, and platform↔platform `interchangeChains`. Invented station schematics are generated from those chains into `data/schematic/generated/` (`npm run build-schematics`; also run at the end of `refresh-network` and as part of `npm run build`). King’s Cross (`data/schematic/HUBKGX.json`) is a hand-authored override. Its 3D view overlays OSM building footprints from the London PMTiles extract (`data/osm/london.pmtiles`, regenerate with `npm run fetch-london-pmtiles`) when that file is present. Live disruptions are fetched at runtime via `/api/disruptions` with a ~60s in-memory TTL. There is no fabricated fallback data — if the live feed fails, the UI shows an explicit error and statuses degrade to unknown.

## Setup

```bash
npm install
npm run refresh-network   # writes data/network.json and generated schematics from TfL APIs
npm run build-schematics  # regenerate schematics from existing network.json
npm run fetch-london-pmtiles  # Greater London PMTiles extract (gitignored)
npm run dev
```

Optional: set `TFL_APP_KEY` (see `.env.example`) for higher rate limits.

```bash
npm test                  # topology, status derivation, pathfinder, schematic
npm run build             # regenerates schematics, then next build
```

## Deploy

Hosted on Cloud Run (`loop` in `us-east4`), mapped to `loop.penrose.tools`. From the repo root, with `data/network.json` and `data/schematic/` present:

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

Cloud Build runs `npm run build` (`build-schematics` then `next build`) and starts with `next start`. Optional: set `TFL_APP_KEY` on the service for higher TfL rate limits.

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
- Schematic: every network station, invented layout, not to scale, not for wayfinding, isolated from routing. King’s Cross is hand-authored and overlays OSM buildings when `data/osm/london.pmtiles` is present.
- Out of scope: walking directions, buses, National Rail routing, fares, ETAs, accounts

## License

Code is [MIT](LICENSE). Topology and live disruptions come from Transport for London and remain subject to [TfL's terms](https://tfl.gov.uk/corporate/terms-and-conditions/transport-data-service). Building footprints are © OpenStreetMap contributors. This project is not affiliated with TfL.
