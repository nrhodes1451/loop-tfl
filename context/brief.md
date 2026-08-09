Brief: Step-free accessibility graph app (working name: StepFree)
Context

Personal project, not affiliated with TfL. Visualises London public transport step-free accessibility as an interactive network graph (station → platform → lift), overlaid with live disruption data. A Claude Design mockup exists showing the intended visual/interaction design - treat that mockup as a visual reference only, not a data contract. Do not carry over any station names, lift IDs, counts, or statuses hardcoded in the mockup. All real data comes from the APIs below.

Core principle: API is the source of truth

This is the most important constraint on this build. Concretely:

No hardcoded station lists, lift counts, or disruption data anywhere in the codebase, including "sensible defaults," seed data, or fallback content dressed up as real data. If the API is unavailable, show an explicit loading/error state - never silently fall back to fabricated or stale-looking data.
The three data sources below are canonical. If the mockup implies a field, node, or relationship that doesn't map cleanly onto real API output, flag it back to me rather than inventing a plausible-looking substitute.
Build the data layer first, against real API responses, before building UI polish. Don't let visual complexity in the mockup drive premature architectural decisions.
Data sources
Live disruptions: https://api.tfl.gov.uk/Disruptions/Lifts/ - JSON, current lift outages. Fields: naptanCode, icsCode, stopPointName, outageStartArea, outageEndArea, message. No live status elsewhere - this is the only live feed.
Static lift/platform reference: https://content.tfl.gov.uk/lrad-v2.xml - per-station <Lifts> (LiftID + FromStopArea/ToStopArea) and per-platform <LiftRoutes> (which LiftIDs reach each line/platform/direction). Refreshed periodically, not live.
Station metadata/coordinates: TfL Unified API /StopPoint/{naptanId} and the GIS Open Data Hub station datasets - station-level lat/long only. No platform- or lift-level coordinates exist anywhere in TfL's data (confirmed - platform lat/lon fields exist in the schema but are always populated as 0.0).
Known data limitations to build around, not paper over
Lift-to-disruption matching is inferred, not guaranteed. Join on normalised {outageStartArea, outageEndArea} against the XML's {FromStopArea, ToStopArea}, order-insensitive, string-normalised (strip spaces/hyphens, lowercase). This will not resolve 100% of the time. When it doesn't resolve, show the raw TfL disruption message rather than guessing which lift it is.
Station name matching between the disruption feed and the XML is also string-based (XML has no naptanCode). Normalise station names; expect occasional mismatches.
No lift or platform coordinates exist. The graph is topological, not geographic. Don't attempt to fake coordinates or force a map-accurate layout - use a force-directed layout as designed.
Multi-lift routes exist (some platforms require 2+ lifts in sequence) - a single disruption may only affect one lift in a longer route, so "platform reachable" is a graph traversal, not a lookup.
Scope for v1
Keep this small. Resist the temptation to build the whole network graph up front.
Suggested v1 scope: a handful of stations (e.g. the stations on my actual commute/local lines) rendered as the three-tier graph, live disruption overlay, no route-planning mode yet.
Route-planning (pick two stations, highlight accessible path) and the full-network zoomed-out view are v2+ - don't build them until the core data layer and a small graph render correctly against live data.
Tech stack
Next.js App Router, TypeScript, Tailwind, shadcn/ui
Data fetching: server-side/route handlers calling TfL APIs directly (respect any rate limits - register for an API key if needed)
Graph rendering: a force-directed graph library (e.g. D3 force, or react-force-graph) - don't hand-roll physics
No database needed for v1 if data is fetched live and cached in-memory/short-TTL - don't add persistence infrastructure prematurely
Brand/IP constraint

Line colours (official TfL palette) are fine to use for edge/wayfinding colour. Do not use the TfL roundel or the Johnston typeface - use a standard sans (e.g. Inter).

What "over-engineered" looks like, to avoid
Building the full station/platform/lift graph for all ~270+ stations before validating the join logic works on 5-10 stations
Building route-planning before the base graph renders correctly
Any persistence layer, auth, or user accounts before the core visualisation is proven
Polishing animation/interaction detail before the underlying data is confirmed live and correct