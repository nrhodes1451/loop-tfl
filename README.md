# Loop / Stepfree

Unofficial London public-transport accessibility tool. **Loop** plans a single street-to-street step-free journey; **Stepfree** is the optional network graph. Not affiliated with Transport for London.

## Stack

Next.js App Router, TypeScript, Tailwind, d3-force (canvas), Inter + IBM Plex Mono.

## Routes

| Path | What it is |
|------|------------|
| `/` | Loop — mobile-first step-free route planner |
| `/explore` | Stepfree — force-directed accessibility graph |
| `/api/disruptions` | Live TfL lift outages (`LiftUniqueId` join) |

## Data sources

| Data | Source |
|------|--------|
| Station–station rides | `GET /Line/Mode/{mode}` + `GET /Line/{id}/Route/Sequence/all` |
| Lift / platform topology | `https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip` |
| Live outages | `GET /Disruptions/Lifts/v2` (join on `LiftUniqueId`) |

Static topology is persisted in `data/network.json` (regenerate with the script below). That file includes undirected graph `edges`, directed `rides`, street↔platform `platformLiftChains`, and platform↔platform `interchangeChains`. Live disruptions are fetched at runtime via `/api/disruptions` with a ~60s in-memory TTL. There is no fabricated fallback data — if the live feed fails, the UI shows an explicit error and statuses degrade to unknown.

## Setup

```bash
npm install
npm run refresh-network   # writes data/network.json from TfL APIs
npm run dev
```

Optional: set `TFL_APP_KEY` for higher rate limits.

```bash
npm test                  # topology, status derivation, pathfinder
npm run build
```

## Planner verdicts

Loop returns one route and an honest verdict:

- **Step-free throughout** — boarding, interchange, and alighting lifts are in service
- **Route breaks** — a required lift is out; the attempted path stays visible and later legs are marked unreachable
- **Probably step-free** — the path exists but live status is missing or older than ~15 minutes
- **No step-free route** — structural gap (not a live fault); offers the nearest step-free station

## Scope (v1)

- Station → station planning on tube, Elizabeth line, DLR, Overground, tram
- One route, live lift check, replan excluding a broken interchange
- Explore graph: expand stations into platform/lift nodes (max 3)
- Out of scope: walking directions, buses, fares, ETAs, accounts, desktop layouts
