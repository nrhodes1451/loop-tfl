# Handoff: Loop — step-free route planner (v1, mobile)

## Overview
Loop is an **unofficial** London TfL accessibility tool (not affiliated with TfL). v1 does one job: the user picks a **From** and a **To** station, and Loop returns a single **street-level → street-level step-free journey**, accounting for lifts/ramps at boarding, interchange, and alighting, with live lift-disruption awareness.

Audience: wheelchair users and anyone who needs step-free access. Clarity and trust beat clever UI. One job per screen.

In scope for v1: station→station planning, one route, honest verdicts (success / break / uncertain / no route), loading state.
Out of scope: walking directions outside stations, buses, fares, timetable ETAs, accounts, desktop layouts.

## About the Design Files
`Loop Route Planner.dc.html` in this bundle is a **design reference created in HTML** — a prototype showing intended look, copy, and structure. It is **not production code to copy**. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, Compose, etc.) using its established component library, tokens, and patterns. If no environment exists yet, pick the most appropriate framework and implement there.

The file is a design canvas: seven phone frames (390×844) side by side, plus a component inventory panel and an interaction-notes panel. Each option carries a stable id badge (`1a`–`1i`) used throughout this document.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, copy, and states. Recreate pixel-faithfully with the codebase's own primitives. All values below are exact.

---

## Screens / Views

Frame: 390×844, `border-radius: 38px`, body background `#f7f8f9`, single column flex, `overflow: hidden`.
Every frame starts with a **status bar**: height 46, `padding: 0 26px`, space-between, `9:41` at 13px/600 left, signal/wifi/battery glyphs right (simple rounded rects — replace with the platform's real status bar).
Every frame ends with a **home indicator**: 120×5, radius 3, `rgba(20,23,28,.22)`, centered.

### 1a — Route entry (empty state)
**Purpose:** set From and To, then plan.
**Layout:** header block (`padding: 22px 20px 0`) → content column (`padding: 26px 20px 0`, `flex: 1`, `gap: 14px`) → sticky bottom CTA block (`padding: 14px 20px 12px`, background `linear-gradient(to top,#f7f8f9 60%,rgba(247,248,249,0))`).

Components:
- **Wordmark** "Loop" — 27px/700, `letter-spacing: -.03em`, `#14171c`. Right of it, mono `london · live lift status` — 10px, `#6c727c`, `letter-spacing: .04em`.
- **Disclaimer** — "Unofficial. Not affiliated with TfL." 11.5px, `#636a75`, `margin-top: 6px`. (Toggleable prop `showDisclaimer`.)
- **Section title** — "Plan a step-free journey" 19px/600, `-.02em`.
- **From/To card** — `#ffffff`, `1px solid rgba(0,0,0,.1)`, radius 16, `padding: 6px 6px 6px 0`, flex row. Left: two stacked buttons, each `min-height: 60px`, `padding: 0 8px 0 18px`, `gap: 14px`, radius 12, hover `#f0f2f5`. Leading marker: 14×14, `3px solid #6c727c` — **circle for From, radius-3 square for To**. Label: mono 9.5px `#6c727c` `letter-spacing:.08em` (`FROM` / `TO`); value 16px/600. Filled value `#14171c` ("King's Cross St. Pancras"); empty placeholder `#7b828c`-tier grey ("Choose a station"). 1px divider `rgba(0,0,0,.1)` inset `margin-left: 46px`.
- **Swap button** — 46px wide, full height, `#f0f2f5`, `1px solid rgba(0,0,0,.1)`, radius 12, glyph `⇅` 17px, hover `#e5e8ed`, `aria-label="Swap start and destination"`.
- **Empty state** — `1px dashed rgba(0,0,0,.13)`, radius 14, `padding: 20px 18px`, centered. "No journeys yet" 14px/600; body 12.5px `#6c727c` line-height 1.5: "Pick a destination and Loop checks every lift and ramp on the way — street to street."
- **Disruption summary** — mono label `LIFT DISRUPTIONS NOW` 9.5px `#6c727c`; card `#ffffff` + `1px solid rgba(0,0,0,.1)` radius 14, `padding: 14px 16px`, 10px red dot `#d1252e`, "6 lifts out of service" 14px/600, "Green Park, Bank, Finsbury Park +3" 12.5px `#5c626c`.
- **Primary CTA (disabled)** — full width, `min-height: 54px`, radius 15, background `#e4e7eb`, text `#6c727c` 16.5px/600, label "Plan step-free route". Helper above, centered, 12px `#6c727c`: "Choose a destination to continue".
- **Explore link** (optional, prop `showExploreLink`) — "Explore the network graph" 12.5px `#5c626c`, 1px bottom border `rgba(0,0,0,.15)`.

### 1b — Station picker
**Purpose:** search and choose a station for one slot, with its step-free status visible before planning.
**Layout:** header (back button 38×38 radius 11 `#f0f2f5`, title "Destination" 17px/600) → search field → filter chip row → results list (`flex: 1`, `gap: 6px`, `padding: 12px 20px 0`).

- **Search field** — `#ffffff`, `1px solid rgba(0,0,0,.18)`, radius 14, `min-height: 50px`, `padding: 0 15px`, `gap: 11px`; 13px circle outline marker; query text 16px/500 ("canary") with 1.5×17 caret; trailing "Clear" 12px `#6c727c`.
- **Filter chips** — `padding: 8px 12px`, radius 9, 12.5px/600. Selected: `#14171c` bg, `#ffffff` text ("All stations"). Unselected: `#f0f2f5` bg, `1px solid rgba(0,0,0,.1)`, `#5c626c` text ("Step-free only", "Nearby").
- **Legend** (above the list, 11.5px `#636a75`): "Status from TfL open data, refreshed 2 min ago. “Partial” means some platforms only."
- **Station row** — `#ffffff`, `1px solid rgba(0,0,0,.1)`, radius 14, `min-height: 74px`, `padding: 13px 15px`, flex row `gap: 12px`. Name 16px/600 (`-.01em`), qualifier in `#6c727c`/500. Below: line pills 22×4 radius 2 in TfL colors + line names 11.5px `#6c727c`. Trailing: status chip (see inventory).
- Rows shown: Canary Wharf (Jubilee, Step-free) · Canary Wharf (Elizabeth line) (Lift out) · Canada Water (Jubilee + Overground, Step-free) · Canonbury (Overground, No step-free) · Camden Town (Northern, Partial).

### 1c — Result: step-free throughout
**Layout:** sticky summary header → verdict banner → timeline (`flex: 1`, `padding: 20px 20px 0`) → bottom action row.

- **Sticky header** — `#ffffff`, bottom border `rgba(0,0,0,.1)`, `padding: 4px 16px 12px`, flex `gap: 12px`: back button, then route line "King's Cross St. P. → Canary Wharf" 14.5px/600 truncated with ellipsis, mono sub-line 10px `#6c727c` "checked 09:40 · 5 lifts on route", then "Edit" button (`min-height: 36px`, `padding: 0 12px`, radius 10, `#f0f2f5`, 13px/600).
- **Verdict banner** — radius 16, `background: rgba(15,122,76,.1)`, `1px solid rgba(15,122,76,.35)`, `padding: 16px 18px`, flex `gap: 13px`. 20px green circle `#0f7a4c` with white `✓` (12px/800). Title "Step-free throughout" 17.5px/700 `-.02em` `#0f7a4c`; body 13px `#3b424c` line-height 1.5: "Street to street. 1 change, 5 lifts, all in service."
- **Timeline legs** (see Leg row in inventory), in order:
  1. "Start · street level at King's Cross St. Pancras" — "Lift 4 from Euston Road entrance to Victoria line southbound platform." · green ring, Victoria `#0098D4` connector.
  2. "Stay on Victoria line · 2 stops" — "Through Oxford Circus. No lifts needed — you stay on board." · solid `#0098D4` dot with `0 0 0 3px rgba(0,152,212,.25)` halo.
  3. "Change at Green Park · to Jubilee line" — "Step-free interchange: lift 2 down to eastbound Jubilee platform. Level boarding at car 4." + green chip "Lift in service · 09:38" · green ring, Jubilee `#A0A5A9` connector.
  4. "Stay on Jubilee line · 7 stops" — "Through Waterloo and London Bridge. Platform-level throughout."
  5. "Arrive · street level at Canary Wharf" — "Lift 1 to Jubilee Place exit, then ramp to street." · green ring, no connector.
- **Bottom row** — primary "Start journey" (`flex: 1`, `min-height: 54px`, radius 15, `#14171c` bg, `#ffffff` text 16.5px/600) + 54×54 refresh button `↻` (`#f0f2f5`, `1px solid rgba(0,0,0,.13)`, radius 15, `aria-label="Refresh lift status"`).

### 1d — Result: route breaks (live lift disruption)
Same shell. Header sub-line: "checked 09:41 · 1 lift out of service".
- **Verdict banner** — `rgba(209,37,46,.1)` bg, `1px solid rgba(209,37,46,.38)`; 20px **rounded square** `#d1252e` with white `!`; title "Step-free route breaks at Green Park" 17.5px/700 `#d1252e`; body: "The interchange lift to the Jubilee line has been out of service since 06:12 today."
- Mono label above timeline: `ATTEMPTED ROUTE`.
- Legs 1–2 unchanged (green ring, Victoria connector). **Break leg**: ring is an 18px `#d1252e` square (radius 4) with `0 0 0 4px rgba(209,37,46,.2)` halo; connector below switches to dashed `repeating-linear-gradient(to bottom, rgba(20,23,28,.28) 0 6px, transparent 6px 12px)`. Content is a callout card: `#f0f2f5`, `1px solid rgba(209,37,46,.4)`, radius 14, `padding: 14px 15px` — title "Change to Jubilee · interchange lift out of service" 15.5px/700 `#d1252e`; body "Green Park. Lift 2 (Victoria ↔ Jubilee) unavailable. No step-free alternative inside this station."; mono footnote 10px `#5c626c` `TFL REPORT 06:12 · NO ETA`.
- Legs after the break: `opacity: .45`, dashed connectors, copy "Unreachable · Jubilee line to Canary Wharf" / "7 stops. Blocked by the break above." and "Not reached · street level at Canary Wharf" (dashed ring).
- **Actions** — primary "Replan avoiding Green Park"; secondary "Notify me when the lift is back" (`min-height: 48px`, radius 14, `#f0f2f5`, `1px solid rgba(0,0,0,.13)`, 15px/600).

### 1e — Result: uncertain / stale data
Route: Victoria → Stratford. Header sub-line "last live check 09:00 · 41 min ago".
- **Verdict banner** — neutral: `#f0f2f5`, `1px solid rgba(20,23,28,.16)`; 20px circle `3px solid #7b828c` with `?`; title "Probably step-free" 17.5px/700 `#14171c`; body "The path exists on paper, but live lift status is missing for 2 of 4 lifts. Treat with care."
- Verified legs keep green rings; **unverified legs use grey rings** (`4px solid #7b828c`) and a neutral chip "Unknown · last confirmed step-free 9 Aug" (`rgba(108,114,124,.16)` bg, `#4b525c` text).
- Legs: Start · Victoria (green, "Lift 1 to Victoria line northbound. Confirmed in service 09:39.") → Stay on Victoria line · 4 stops → Change at Highbury & Islington · to Overground (grey ring, callout card `#ffffff` + `1px solid rgba(20,23,28,.14)`) → Stay on Overground · 6 stops ("Manual boarding ramp may be needed. Staff assistance recommended.", `#FA7B05` connector) → Arrive · street level at Stratford (grey ring).
- **Action** — primary "Retry live check"; footer 11.5px `#636a75` centered: "Unofficial tool. Call TfL 0343 222 1234 to confirm lifts before travelling."

### 1f — Result: structural gap (no route)
Route: King's Cross St. P. → Covent Garden. Header sub-line "structural · not a disruption".
- **Verdict banner** — `#f0f2f5` with `1px dashed rgba(20,23,28,.32)`; 20px circle `3px dashed rgba(20,23,28,.55)`; title "No step-free route"; body "Covent Garden has no step-free path between street and platform. This is permanent, not a lift fault."
- Mono label `WHERE IT STOPS`. Legs: Start · KGX (green ring, Piccadilly `#003688` connector) → "Stay on Piccadilly line · 3 stops" ("Through Russell Square and Holborn.") → terminal leg with dashed ring `4px dashed rgba(20,23,28,.55)` and dashed callout card: "Covent Garden · no street↔platform step-free access" / "Lifts serve staff levels only; the platform exit is stairs. You would be able to board, but not to leave."
- **Alternative card** — `#ffffff` + `1px solid rgba(0,0,0,.1)` radius 14: mono `NEAREST STEP-FREE ALTERNATIVE`, "Tottenham Court Road" 15.5px/600, "Step-free throughout · 700 m from Covent Garden, mostly level pavement."
- **Actions** — primary "Plan to Tottenham Court Road"; secondary "Pick a different destination". Never offer "wait for the lift" here.

### 1g — In progress (computing + refreshing disruptions)
- Header sub-line: "checking live lift status…" (no Edit button).
- **Progress card** — `#f0f2f5`, `1px solid rgba(0,0,0,.13)`, radius 16, `padding: 16px 18px`: 20px spinner (`3px solid rgba(20,23,28,.18)`, `border-top-color:#14171c`, rotate 0.9s linear infinite), title "Planning step-free route" 17.5px/700; body "Walking the station graph, then checking 14 lifts on candidate paths."; 6px track radius 3 `rgba(20,23,28,.12)` with 62% fill `#14171c`; mono row 10px `#5c626c`: `9 OF 14 LIFTS CHECKED` / `~3s`.
- Mono label `BUILDING TIMELINE`. First two legs resolve normally (leg 2's detail is a skeleton bar); remaining legs are skeleton: rings `4px solid rgba(20,23,28,.14 → .08)`, connectors `rgba(20,23,28,.09 → .07)`, text bars 11–13px tall, radius 5, widths 52–78%.
- **Action** — full-width secondary "Cancel".

### 1h / 1i — Component inventory & interaction notes
Documentation panels in the canvas, not app screens. Their content is reproduced below.

---

## Component inventory

1. **Station input** — `min-height: 60px` row, marker + mono slot label + 16px/600 value. Search variant: `min-height: 50px`, focus-visible ring `0 0 0 3px rgba(0,152,212,.35)`.
2. **Status chip** — `padding: 6px 10px`, radius 8, 11.5px/600, 8px shape + text label. Five states:
   | State | Background / border | Text | Shape |
   |---|---|---|---|
   | Step-free | `rgba(15,122,76,.1)` | `#0f7a4c` | solid circle |
   | Partial | `1px solid rgba(20,23,28,.2)` | `#5c626c` | half-filled circle |
   | Lift out | `rgba(209,37,46,.1)` | `#d1252e` | rounded square |
   | Unknown | `rgba(108,114,124,.16)` | `#4b525c` | grey circle |
   | No step-free | `1px dashed rgba(20,23,28,.28)` | `#5c626c` | dashed circle |
3. **Verdict banner** — four states: success (green tint), break (red tint), uncertain (neutral solid border), no route (neutral **dashed** border). Always first element under the header; always title + one-sentence explanation.
4. **Leg row** — flex `gap: 14px`. Gutter: 18px column, `align-items: center`; ring 18×18 (`4px` border) or 14×14 solid dot for pass-through; connector `flex: 1`, width 5, radius 3, `margin: 5px 0`, colored with the TfL line color, dashed gradient when the chain is broken/unavailable. Content column: title 15.5px/600 `-.01em`; detail 13px `#5c626c` line-height 1.5 `margin-top: 4px`; optional chip `margin-top: 9px`; `padding-bottom: 22–24px` except the last row.

Ring semantics: **circle = station node, solid dot = pass-through, square = break, dashed = no infrastructure.** Status is never encoded by color alone — always color + text label + shape.

## Interactions & Behavior
- **Setting From/To:** tapping either row opens the full-screen picker (1b) scoped to that slot. Typeahead filter over station names; each row shows the station's own step-free status so a dead end is visible before planning. Selecting returns to entry with the slot filled and focus moved to the next empty slot. `⇅` swaps From/To in place. CTA remains disabled until both slots are set.
- **Plan:** shows 1g. Two phases — graph search, then live lift check across candidate paths. Cancel aborts and returns to 1a with inputs intact.
- **Success (1c):** verdict banner first, timeline below. Sticky header keeps From → To and check time visible while scrolling. `↻` re-runs only the lift check, not the graph search; update the header timestamp and any chips in place.
- **Break (1d):** never silently hide the path. Keep the attempted route rendered, name the failing station and cause, and dim + dash everything after the break (`opacity: .45`) so it reads "unreachable", not "fine". Primary action replans excluding the failing node; secondary subscribes to that lift's status.
- **Structural gap (1f):** reads as permanent, offers the nearest step-free station, and never suggests waiting.
- **Uncertainty (1e):** missing/stale live data downgrades the verdict to "probably step-free" rather than claiming success. Grey rings mark unverified legs and name the last confirmed date. Footer always carries the unofficial-tool disclaimer and TfL's phone number.
- **Transitions:** keep them minimal and non-essential — 120–160ms opacity/transform at most. Respect `prefers-reduced-motion`; the spinner and progress bar are the only continuous motion.
- **Accessibility:** timeline is an ordered list, one item per leg; verdict is the first heading so screen readers hear the answer before the detail. Every status has a text label. Tap targets ≥44px, CTAs in the thumb zone, visible focus rings. Any graph/canvas view is an optional extra, never the only path to the answer.

## State Management
- `from: Station | null`, `to: Station | null` — set by the picker; `swap()` exchanges them.
- `pickerOpen: 'from' | 'to' | null`, `query: string`, `filter: 'all' | 'stepFreeOnly' | 'nearby'`.
- `plan: { status: 'idle' | 'loading' | 'ok' | 'break' | 'uncertain' | 'none', legs: Leg[], breakAt?: StationId, checkedAt?: ISO, liftsChecked?: number, liftsTotal?: number }`.
- `Leg = { kind: 'start' | 'ride' | 'change' | 'arrive' | 'unreachable', station?, line?, stops?, detail, status: 'ok' | 'broken' | 'unknown' | 'none' }` — the row's ring, connector color, and chip derive from `kind` + `status` + `line`.
- Data needs: static station/line/step-free-infrastructure graph (TfL step-free data), plus live lift disruption feed (TfL Unified API `Disruption`/`Lift` records). Cache the last successful lift snapshot with its timestamp; if it is older than ~15 minutes or a lift is absent from the feed, mark those legs `unknown` and downgrade the verdict.

## Design Tokens
Colors
- Surfaces: page `#f7f8f9`, panel `#ffffff`, raised/secondary `#f0f2f5`, hover `#e5e8ed`, disabled `#e4e7eb`
- Text: primary `#14171c`, body `#3b424c`, secondary `#4b525c`, muted `#5c626c`, label `#6c727c`, faint `#636a75`
- Borders: hairline `rgba(0,0,0,.1)`, strong `rgba(0,0,0,.18)`, dashed `rgba(20,23,28,.28–.32)`
- Status: ok `#0f7a4c` (+ `rgba(15,122,76,.1/.35)`), break `#d1252e` (+ `rgba(209,37,46,.1/.38/.4)`), unknown `#7b828c` (+ `rgba(108,114,124,.16)`)
- Lines: Victoria `#0098D4`, Jubilee `#A0A5A9`, Piccadilly `#003688`, Elizabeth `#6950A1`, Overground `#FA7B05`, District `#000F9F`, Circle `#00782A`, Northern `#000000`
- Elevation: `0 0 0 1px rgba(0,0,0,.12), 0 18px 44px rgba(20,23,28,.13)` (phone frame)

Spacing: 4 / 6 / 8 / 9 / 12 / 14 / 16 / 18 / 20 / 22 / 26 px. Screen gutter 20px.
Radius: 8 (chip) · 10–11 (small button) · 13–14 (card, secondary button) · 15–16 (primary button, banner) · 38 (device frame).
Type: system UI sans (`-apple-system, "Helvetica Neue", Helvetica, system-ui`) for everything; `ui-monospace, "SF Mono", Menlo, monospace` for micro-labels only. Scale: 27/700 wordmark · 19–17.5/700 titles · 16–15.5/600 rows · 14.5–14/600 header + subtitles · 13/400 body (line-height 1.5) · 12.5–11.5 secondary · 10–9.5 mono labels (`letter-spacing: .03–.08em`). Negative tracking `-.01 to -.03em` on 14px+ headings. No text below 11.5px.

## Assets
None. No images, no icon font, no illustrative SVG. Glyphs are text characters (`‹ ⇅ ↻ ✓ ! ?` and `→ ↔`) — replace with the codebase's icon set (chevron-left, swap-vertical, refresh, check, alert, help). Line pills and timeline rings are plain CSS boxes. If Loop needs a logo, it is currently a text wordmark only.

## Files
- `Loop Route Planner.dc.html` — the design canvas: frames 1a–1g (screens), 1h (component inventory), 1i (interaction notes). Open in a browser; the ids in this document match the badges above each frame.
