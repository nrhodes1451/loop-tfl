# Handoff: Stepfree — London transport accessibility graph

## Overview
An unofficial, accessibility-focused web app that visualises the London public transport
network as a **force-directed graph** and surfaces **step-free (lift) status in real time**.

Three purposes, in priority order:
1. Tell a wheelchair user / step-free traveller whether a given station is usable *right now*.
2. Make the *absence* of accessible infrastructure visible as a structural gap in the graph,
   not as a footnote.
3. Check a journey end to end, including interchanges, and name where it breaks.

The layout is deliberately **physics-based, not geographic** — it should read as a simplified
network diagram at a glance while being organic and interactive.

## About the Design Files
The file in this bundle (`Stepfree Graph.dc.html`) is a **design reference created in HTML** — a
working prototype that shows intended look, behaviour, and data model. It is **not production
code to copy directly**.

The task is to **recreate this design in the target codebase's existing environment** (React,
Vue, SwiftUI, native, etc.) using its established patterns, state management, and component
library. If no environment exists yet, pick the most appropriate framework and implement there.

In particular:
- The prototype hand-rolls a small force simulation and draws the graph to a single `<canvas>`.
  In production, prefer a maintained library: **d3-force** (+ canvas or SVG renderer),
  **react-force-graph**, or **cosmograph** for very large graphs. Match the *behaviour*
  described below, not the prototype's physics code.
- Lift/platform data in the prototype is **deterministic synthetic data** (seeded hash per
  station+line+direction). Production must read a real feed (see "Data & APIs").
- The chrome (top bar, legend card, sidebar) is ordinary DOM and should be rebuilt as normal
  components.

## Fidelity
**High-fidelity.** Colours, type sizes, spacing, radii, copy, and interaction states below are
final and should be matched. The graph canvas itself is a *visual spec* (node sizes, halo
treatment, edge weights, dash patterns) rather than pixel-exact output, since node positions are
emergent from the simulation.

---

## Screens / Views

The app is a single full-viewport screen with two panes. There is no routing between pages; the
right pane changes with mode and selection.

```
┌───────────────────────────────────────────────┬──────────────────┐
│ top bar: wordmark + disclaimer | mode buttons │  sidebar         │
├───────────────────────────────────────────────┤  372px fixed     │
│                                               │                  │
│  graph canvas (flex: 1)                       │  header block    │
│                                               │  ───────────     │
│  ┌ legend card (abs, bottom-left)             │  scrolling body  │
│  └                                            │                  │
└───────────────────────────────────────────────┴──────────────────┘
```

Root: `display:flex; height:100vh; overflow:hidden; background:#0b0d10; color:#e9ecf1;`
font stack `Inter, system-ui, sans-serif`, `-webkit-font-smoothing: antialiased`.
Left pane: `display:flex; flex-direction:column; flex:1; min-width:0`.
Canvas wrapper: `position:relative; flex:1; min-height:0`; canvas is `width:100%; height:100%;
display:block`, sized by `ResizeObserver` × `devicePixelRatio`.

### 1. Top bar
`display:flex; align-items:flex-start; justify-content:space-between; gap:20px;
padding:18px 24px 14px; flex:none`.

- Wordmark **“Stepfree”** — 21px / 700 / `letter-spacing:-0.02em` / `#e9ecf1`.
- Beside it, baseline-aligned, gap 9px: **“london · live lift status”** — 12px, `#7d848f`,
  `IBM Plex Mono`, `white-space:nowrap`.
- Below: **“Unofficial accessibility tool. Not affiliated with any transport operator.”**
  12.5px / `#7d848f` / line-height 1.5 / `text-wrap:pretty`.
- Right group: `display:flex; gap:8px; flex:none`. Three buttons, all
  `padding:8px 13px; font-size:12.5px; border-radius:7px; white-space:nowrap; cursor:pointer`.
  - **Explore** and **Route** are a segmented pair. Active: `background:#ffffff;
    color:#0b0d10; border:1px solid #ffffff; font-weight:550`. Inactive: `background:#16191f;
    color:#b7bdc7; border:1px solid #262b33`.
  - **Reset view**: always `background:#16191f; color:#b7bdc7; border:1px solid #262b33;
    font-weight:500`. Re-frames the graph.

### 2. Graph canvas — collapsed overview (default state)
Only **station nodes** and **line edges** are rendered. This is state (1) of the mockup.

**Station node**
- radius `min(13, 6 + lineCount × 1.4)` world px — interchanges read bigger.
- fill `#171b21`, stroke `#576070` at 2/k px. Selected or expanded: fill and stroke `#ffffff`.
- **Aggregate halo**: a concentric ring at `r + 5px`, stroke width 2.6/k when disrupted else 2/k:
  - red `#f2565c`, solid, alpha 0.8 → at least one platform's lift chain is disrupted **now**
  - grey `#5f6672`, solid, alpha 0.8 → stale/no live data
  - neutral `#576070`, **dashed** `[3.5, 3]`, alpha 0.5 → station has **no lift infrastructure
    at all** (structural, not a live fault)
  - green `#35c77b`, solid, alpha 0.8 → every platform has a working step-free route
  This distinction matters: red must mean "broken today", never "never accessible".
- **Label**: 11.5px Inter, weight 500 (600 when selected/expanded), `#aeb5c0` (`#ffffff` when
  selected/expanded), drawn at `x + r + 8px`, vertically centred. Shown when
  `showAllLabels` prop is on, **or** `lineCount ≥ 4 && zoom > 0.55`, **or** `zoom > 1.2`,
  **or** the node is selected/expanded. Labels and stroke widths are divided by the zoom factor
  so they stay a constant screen size.

**Station–station edges**
- One edge **per line per adjacent pair** — multiple parallel edges where several lines run
  between the same two stations. Offset perpendicular to the segment by
  `(index − (total − 1) / 2) × 4.2px`, `lineCap:round`, width 2.6/k, alpha 0.88.
- Coloured with the operator line palette (see Design Tokens). Northern's black `#000000` is
  substituted with `#1c1f25` on the dark canvas so it stays visible.

**Fit / framing** — on mount, on resize, and on "Reset view" (unless the user has panned or
zoomed since): compute the station bounding box, then
`k = clamp(min((w − padX·2)/bw, (h − padY·2)/bh), 0.35, 3)` with
`padX = clamp(w × 0.06, 24, 80)`, `padY = clamp(h × 0.06, 20, 60)`, and centre the box.
Never reserve space for the legend overlay in this calculation. A refit is also run 1.4s after
mount, once the simulation has settled.

### 3. Graph canvas — station expanded (state 2 of the mockup)
Clicking a station node toggles its expansion; up to **3** stations stay expanded at once
(oldest is dropped). This is the collapse/expand strategy — platform and lift nodes are only
instantiated for expanded stations, never for all ~76 at once.

**Platform node** — one per **line + direction** at that station (e.g. "Piccadilly eastbound",
"Circle inner rail"). r 5.2, fill `#2b3037`, stroke 2/k px:
- line colour when step-free and working
- `#f2565c` when the chain is disrupted
- `#5f6672` when stale
- `#f2565c` **dashed** `[3, 2.5]` when there is no lift route at all
Label (only when zoom > 0.95): 9.5px / 500, `#9aa2ae` (`#f2565c` if broken), at `x + r + 5px`.
Seeded initially at `parent ± 60px` on a ring, index-distributed angle.

**Lift node** — r 3.4, solid fill by status: `#35c77b` / `#f2565c` / `#5f6672`. Sits *between*
the platform node and the station node. Chains of two lifts (concourse lift → platform lift)
occur where an interchange needs two vertical moves; the chain is `platform → lift₁ → lift₂ →
station`, all in series.

**Lift edges** — 1.6/k px, coloured by the status of the lift they lead from, alpha 0.9;
dashed `[4, 3]` when status is unknown.

**The gap** — if a platform has no lift route, **no visible edge is drawn to its station**. The
prototype keeps an invisible spring (`kind:"ghost"`, len 62, width 0) purely so the orphan node
doesn't drift away. Reproduce this: the visual gap is the core message.

### 4. Legend card
Absolute, `bottom:22px; left:24px`, `padding:14px 16px`,
`background:rgba(18,21,26,0.86); border:1px solid #23272f; border-radius:10px;
backdrop-filter:blur(6px)`, `display:flex; flex-direction:column; gap:12px`.
- Section label “LIFT STATUS” — 10.5px / 600 / `letter-spacing:0.14em` / uppercase / `#6f7681`.
- Row of three swatch+label pairs (9px dots, 12px `#c3c9d2` text, gap 7px inside, 16px between):
  Operational `#35c77b`, Disrupted `#f2565c`, No live data `#5f6672`.
- 1px `#23272f` divider.
- Second row: **No lift infrastructure** (13px circle, `2px dashed #576070`),
  **Platform** (9px dot, `#2b3037` + 1px `#454c57`), **Lift** (6px `#8b929c` dot).
- Footnote 11.5px `#6f7681`, max-width 300px: “A platform with no line to its station has no
  step-free route at all — the gap is the point.”
- Divider, then the interaction hint in `IBM Plex Mono` 11px `#5c626c`:
  “drag to pan · scroll to zoom / click a station to expand”.

### 5. Sidebar (372px, `background:#101318`, `border-left:1px solid #1e222a`)
Header block `padding:22px 22px 18px; border-bottom:1px solid #1e222a`:
- kicker 10.5px / 600 / uppercase / `letter-spacing:0.16em` / `#6f7681`
- title 21px / 650 / `-0.02em`
- subtitle 13px / `#838a95` / line-height 1.5
Body: `flex:1; overflow-y:auto; padding:18px 22px 28px`. Scrollbar 9px, thumb `#2a2f37`.

**5a. Explore, nothing selected** — kicker “Network overview”, title “76 stations · 14 lines”,
subtitle “Live lift and ramp status across the graph, updated as feeds report in.”
Body: explainer paragraph, divider, section label “CURRENTLY DISRUPTED”, then up to **9** rows
sorted by disrupted-lift count. Each row: `padding:9px 11px; background:#14171d;
border:1px solid #232830; border-radius:8px; cursor:pointer`; hover `background:#1a1f26;
border-color:#303743`. Contents: 8px red dot, station name (13px / 500 / `#dde2e9`), and
“N lifts” right-aligned in `IBM Plex Mono` 11.5px `#7d848f`. Clicking selects **and** expands
that station in the graph.

**5b. Explore, station selected** — kicker “Station”, title = station name, subtitle
“{n} platforms · {m} with a working step-free route right now”.
- Line chips: pill `padding:4px 9px 4px 7px; background:#171b21; border:1px solid #232830;
  border-radius:999px; font-size:11.5px; color:#cfd5de`, 8px line-colour dot.
- One card per platform: `border-radius:10px; padding:13px 14px; background:#13161b;
  border:1px solid #1f242b` (border `#3a2226` when disrupted / no route).
  - 4×26px rounded line-colour bar, then label (13.5px / 550) and sub-label
    (11.5px `#7d848f`): “2 lifts in sequence” / “1 lift to concourse” / “no lift route”.
  - Status pill, right: 10.5px / 600 / uppercase / `letter-spacing:0.06em`, colour per status,
    `border:1px solid <status>33; background:<status>14; border-radius:6px`. Labels:
    **Step-free**, **Blocked**, **Unknown**, **No route**.
  - Lift list, under a 1px `#23272f` divider: 8px status dot, lift name (12.5px / 500
    `#d5dae1`), then the operator's disruption message verbatim (12px `#838a95`,
    line-height 1.55, `text-wrap:pretty`).
  - If no lifts: red explainer instead — “No lift or ramp exists between this platform and
    street level. There is no step-free route here even when every lift is working.”

**5c. Route mode** — kicker “Route check”, title “Accessible route”, subtitle “Shortest path by
interchange, checked lift by lift.”
- Two `<select>`s (From / To), alphabetised station list, `padding:10px 11px; font-size:13px;
  background:#171b21; border:1px solid #262b33; border-radius:8px; color:#e9ecf1`.
  Labels 11.5px `#7d848f`.
- Empty state copy: “Pick two stations and the graph will highlight the shortest path, then
  check every interchange for a working lift chain.”
- **Verdict banner**, `padding:13px 14px; border-radius:10px`:
  - broken → title “Step-free route breaks”, `#f2565c` on `rgba(242,86,92,0.08)` /
    border `rgba(242,86,92,0.28)`; body names the breaking stations.
  - stale → “Probably step-free”, `#b7bdc7`, green-tinted background; body counts the
    stations with no live data.
  - clean → “Step-free throughout”, `#35c77b` on `rgba(53,199,123,0.07)` /
    border `rgba(53,199,123,0.22)`.
  Title 13.5px / 600; body 12.5px `#a8afba` / line-height 1.55.
- **Leg timeline**: 22px gutter column with an 11px ring (2px, colour = station aggregate
  status) and a 3px line-coloured connector to the next leg; content column has station name
  (13.5px / 550) and a note (12px, `#f2565c` when that leg is a break, else `#838a95`):
  “Start · step-free from street”, “Stay on Victoria”, “Change to Jubilee · interchange lift
  out of service”, “Arrive · no working lift to street level”.

---

## Interactions & Behavior

| Input | Behaviour |
|---|---|
| Hover node | Tooltip drawn near cursor: 8px-radius `rgba(20,23,29,0.95)` box, 1px `#2b3138` border, ~46px tall. Line 1 = node name (12.5px / 600 `#e9ecf1`), line 2 = 11.5px `#8b929c`: station → “step-free · Victoria · Jubilee…”, platform → “Platform · no step-free route”, lift → “Lift · disrupted”. Flips to the other side near the pane edges. Cursor `pointer` over a node, else `grab`. |
| Click station (Explore) | Toggle expansion (max 3 concurrent, FIFO) + select it in the sidebar. Reheats the simulation (`alpha = 0.9`). |
| Click platform / lift | Selects the parent station in the sidebar (does not collapse). |
| Click station (Route) | First click sets **From** and clears **To**; second sets **To**; a third restarts from From. |
| Drag a node | Pins it to the cursor (`vx = vy = 0`), warms the simulation to `alpha ≥ 0.4`. Released nodes rejoin the physics. |
| Drag background | Pan. Sets a `userMoved` flag that suppresses auto-refit. |
| Scroll | Zoom about the cursor, `k = clamp(k · e^(−Δy · 0.0016), 0.28, 4)`. Also sets `userMoved`. |
| Click empty space | Clears the sidebar selection. |
| Resize | Canvas re-measured; auto-refit unless `userMoved`. |
| Route selected | Non-path line edges drop to alpha 0.16; path edges go to width 3.6/k with a 7/k white underlay at 85% opacity; off-path station nodes dim to alpha 0.25. |

**Motion.** No CSS transitions anywhere; all movement comes from the simulation, running in a
`requestAnimationFrame` loop. `alpha` decays `× 0.994` per frame with a floor of `0.03`, so the
layout keeps a faint organic drift instead of freezing. Forces: pairwise repulsion
`1900 · charge / d²` (charge 1 for stations, 0.28 for platform/lift, cut off beyond 300px);
collision push `(minD − d) × 0.06`; springs — line edges rest length = `networkSpread`
(default 104) at stiffness 0.012, platform/lift edges 24–62px at 0.09; per-station gravity back
toward its seeded geographic point at `0.0016 × alpha × 60`; sub-nodes pulled to their parent at
0.004; velocity damping 0.82.

**Seeding.** Stations are seeded at approximate geographic coordinates scaled
`x × 15`, `y × 10.5` (the vertical squash keeps outer branches from dominating the bounding box)
and then relaxed. This gives a recognisable-but-organic layout rather than a random hairball.

**Routing.** Breadth-first search over the station adjacency graph (fewest hops), tracking the
line used on each hop. A leg is a **break** when the station's aggregate status is `bad` or
`none` *and* it is the origin, the destination, or an interchange (the next leg uses a different
line). Passing straight through a station on one line does not require its lifts.

**Derivations.**
- Platform status = `none` if no lift chain exists; else `bad` if **any** lift in the chain is
  disrupted (series, not parallel); else `unknown` if any is stale; else `ok`.
- Station aggregate = `bad` if any platform is `bad`; else `none` if *every* platform is `none`;
  else `unknown` if any is `unknown`; else `ok`.

## State Management

```
mode: 'explore' | 'route'
selected: stationId | null
expanded: stationId[]           // max 3
routeA, routeB: stationId | ''
```
Non-reactive (kept out of the render loop, mutated per frame):
`nodes[]`, `links[]`, `positions Map<id,{x,y,vx,vy}>`, `view {k,tx,ty}`, `alpha`,
`hover`, `userMoved`, `platformCache`.

Rendering rule: **never re-render the UI framework on a simulation tick.** The prototype draws
to canvas imperatively and only re-renders the sidebar on state change. Keep that split.

Tweakable props exposed in the prototype: `showAllLabels` (boolean, false),
`disruptionLevel` (0–0.5, default 0.18 — synthetic fault rate; drop in production),
`networkSpread` (60–220px, default 104 — line-edge rest length).

## Data & APIs (production)
The prototype's synthetic generator must be replaced by real feeds. The shape it expects:

```ts
Station  { id, name, lines: {id,name,color}[], lat?, lon? }
Platform { id, stationId, lineId, direction, lifts: Lift[] }   // one per line+direction
Lift     { id, name, status: 'ok'|'bad'|'unknown', message, updatedAt }
Edge     { from, to, lineId }                                   // adjacent stations, per line
```
Notes for whoever wires this up:
- Live lift/escalator disruption and step-free station data are published by Transport for
  London's Unified API (`/Disruptions/Lifts`, `/StopPoint`, and the step-free accessibility
  datasets). Platform-level lift *topology* — which lift serves which platform, and where two
  lifts are needed in series — is **not** fully available from one endpoint and will need a
  curated dataset per station.
- `status:'unknown'` is a first-class state: absence of a fresh reading must never be rendered
  as "working". Stamp `updatedAt` and degrade to `unknown` past a staleness threshold.
- Poll or subscribe; treat any station whose reading is older than a few minutes as stale.

## Accessibility requirements (non-negotiable for this product)
The prototype is a visual mock and does **not** yet meet these. Production must:
- Provide a **non-canvas equivalent**: the sidebar content should be reachable and operable by
  keyboard alone, with an accessible list/tree view of stations → platforms → lifts as the
  primary interface. The graph is an enhancement, not the only route to the data.
- Never encode status by colour alone — pair every colour with text ("Blocked", "No route") and
  a shape difference (dashed vs solid ring), as the current design does.
- Announce status changes via a polite live region.
- Support `prefers-reduced-motion`: freeze the simulation to a settled layout, no idle drift.
- Meet AA contrast in both themes; the red `#f2565c` and green `#35c77b` were chosen against
  `#0b0d10`/`#101318` for that reason. Verify with a deuteranopia check too.
- Keyboard: focus ring on nodes, arrow-key traversal of the graph, Enter to expand.

## Design Tokens

**Surfaces & text (dark)**
| Token | Value | Use |
|---|---|---|
| canvas / app bg | `#0b0d10` | graph background, root |
| sidebar bg | `#101318` | right pane |
| panel bg | `#13161b` | platform cards |
| row bg | `#14171d` | disruption rows |
| control bg | `#16191f` / `#171b21` | buttons, selects, chips, station fill |
| hover bg | `#1a1f26` | row hover |
| border subtle | `#1e222a` / `#1f242b` | pane + card borders |
| border | `#232830` / `#23272f` / `#262b33` | dividers, controls |
| border strong | `#303743` | hover border |
| border danger | `#3a2226` | broken platform card |
| node stroke | `#576070` | station outline, no-infra halo |
| text primary | `#e9ecf1` | |
| text secondary | `#c3c9d2` / `#cfd5de` / `#d5dae1` / `#dde2e9` | |
| text muted | `#838a95` / `#7d848f` | body, sub-labels |
| text faint | `#6f7681` / `#5c626c` | kickers, hints |
| label on canvas | `#aeb5c0` | station labels |

**Status**
`ok #35c77b` · `disrupted #f2565c` · `unknown/stale #5f6672` · `no infrastructure #576070`
Tints: `rgba(242,86,92,0.08)` / border `rgba(242,86,92,0.28)`;
`rgba(53,199,123,0.07)` / border `rgba(53,199,123,0.22)`; pills use `<hex>14` fill, `<hex>33` border.

**Line palette** (operator colours, used functionally for wayfinding)
`Bakerloo #B36305` · `Central #E32017` · `Circle #FFD300` · `District #00782A` ·
`Hammersmith & City #F3A9BB` · `Jubilee #A0A5A9` · `Metropolitan #9B0056` ·
`Northern #000000` (rendered `#1c1f25`) · `Piccadilly #003688` · `Victoria #0098D4` ·
`Elizabeth #6950A1` · `DLR #00A4A7` · `Overground #EE7C0E` · `Tram #84B817`

**Typography** — Inter 400/500/550/600/650/700; IBM Plex Mono 400/500 for metadata and hints.
Scale: 21 (title) · 13.5 (card title) · 13 (body) · 12.5 (buttons, messages) · 12 (meta) ·
11.5 (chips, labels) · 11 (hint) · 10.5 (kickers, status pills, uppercase).
Canvas: 11.5px station labels, 9.5px platform labels, 12.5/11.5px tooltip — all scaled by `1/k`.

**Spacing** 3 · 4 · 6 · 7 · 8 · 9 · 11 · 12 · 13 · 14 · 16 · 18 · 20 · 22 · 24 px.
**Radius** 6 (pills) · 7 (buttons) · 8 (rows, selects, tooltip) · 10 (cards, legend) · 999 (chips).
**Sidebar width** 372px fixed. **Legend max text width** 300px.

**Brand constraints** — no roundel or roundel-like mark, no operator wordmark styling, no
Johnston/New Johnston typeface. The disclaimer line in the top bar must survive into production.

## Assets
None. No images, icons, or SVG artwork — every visual is CSS or canvas drawing. Fonts are
Inter and IBM Plex Mono from Google Fonts (self-host in production).

## Files
- `Stepfree Graph.dc.html` — the full prototype: network data (14 line definitions, ~76 stations
  with seed coordinates), synthetic lift generator, force simulation, canvas renderer, and all
  sidebar/chrome markup. Read the station/line tables at the top; they are the fastest way to
  understand the graph model.
