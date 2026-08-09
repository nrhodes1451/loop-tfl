# Stepfree

Unofficial London public-transport accessibility graph. Visualises stations, platforms, and lifts as a force-directed network with live TfL lift disruption status.

Not affiliated with Transport for London.

## Stack

Next.js App Router, TypeScript, Tailwind, d3-force (canvas), Inter + IBM Plex Mono.

## Data sources

| Data | Source |
|------|--------|
| Station–station edges | `GET /Line/Mode/{mode}` + `GET /Line/{id}/Route/Sequence/all` |
| Lift / platform topology | `https://api.tfl.gov.uk/stationdata/tfl-stationdata-detailed.zip` |
| Live outages | `GET /Disruptions/Lifts/v2` (join on `LiftUniqueId`) |

Static topology is persisted in `data/network.json` (regenerate with the script below). Live disruptions are fetched at runtime via `/api/disruptions` with a ~60s in-memory TTL. There is no fabricated fallback data — if the live feed fails, the UI shows an explicit error and statuses degrade to unknown.

## Setup

```bash
npm install
npm run refresh-network   # writes data/network.json from TfL APIs
npm run dev
```

Optional: set `TFL_APP_KEY` for higher rate limits.

```bash
npm test                  # unit tests for topology + status derivation
npm run build
```

## Scope (v1)

- Full network for tube, Elizabeth line, DLR, Overground, tram
- Explore mode: expand stations into platform/lift nodes (max 3)
- Accessible sidebar list as the primary non-canvas interface
- No route-planning mode yet
