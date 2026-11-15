# Dashboard layout redesign · design

2026-11-15. Decided with the user in a brainstorming session with browser mockups (`.superpowers/brainstorm/56846-1794715072/content/`, not committed). **Approved by the user 2026-11-15** (desktop and mobile). Anything marked **(call)** is my decision; change it freely, but a package session that changes one writes the change here in the same PR.

## 1. Intent

The current dashboard (DESIGN.md §3) is a globe column plus a 560 px sidebar that stacks eleven cards: KPIs, hazards table, trends table, selected place, movers, continents, feed, honesty, freshness, sources, disclaimer. The user's verdict: the globe has no room, everything is visible at once, the text overwhelms, and the palette, while right, is applied in ugly ways.

The redesign gives the globe the screen, puts every list in one full-height left column behind a tab strip so a person sees one section at a time, and gives the top and bottom of the screen real weight: a proper top bar and a bottom dock with a timeline and gauges. The visual reference is the "Meteo Intelligence" style image in `media/image.png`: left panel, hero globe, top bar, bottom gauge row, glass panels. We take its structure, not its blue palette.

Audience is unchanged from the PRD: a judge with four minutes, then disaster managers and planners for the pitch.

## 2. Goals, non-goals, anti-goals

**Goals**
- The globe is the hero: it owns the full viewport minus the left column and top bar, and nothing sits on it except the legend, one place card, and the dock.
- One section at a time. Six tabs; the active tab's content is the only list on screen.
- Top bar and bottom dock carry the controls and headline numbers so the stage edges are not empty.
- Colour applied with restraint: orange and yellow only where they encode risk or fire; grey for the rest.
- Every number, caption and control that exists today still exists somewhere. Nothing from the PRD's H-items is dropped.

**Non-goals**
- A palette change. `lib/palette.ts`, `RISK_STOPS`, the series colour bindings (rain blue, fire orange, vegetation aqua, temperature yellow) and the category colours stay as DESIGN.md §2 says.
- New data. Everything on screen reads the files contracts.md §3 already publishes.
- A mobile-first redesign. Mobile is in scope as its own package (§5.5, L8): the desktop layout holds down to 1024 px; under 768 px the phone layout applies; between the two the desktop layout with the column as a drawer **(call)**.
- A separate landing or pitch page. That is a different piece of work.

**Anti-goals**
- Anything that hides the hazards and trends tables behind more than one click from first paint. The Risk tab is open on load.
- Floating panels covering the globe's points. Lists live in the column, never over the map.
- Decorative motion. The dock's play button and the pulse on the newest alert are the only things that move on their own.

## 3. Constraints

- Stack: Next 16, React 19, Tailwind 4, MapLibre GL (globe projection), hand-built d3 SVG charts. No charting library (DESIGN.md §5).
- App state stays in `Dashboard.tsx` (contracts.md §5): mode, hazard, trendVar, selected, continent, flyTo, gibsLayer, gibsDate, and now `tab` and `day`.
- URL round-trips state (`?mode&hazard&var&continent&selected&gibs&date`); the two new fields join it: `?tab=` and `?day=`.
- The globe container must stay `position:absolute; inset:0` inline (MapLibre overrides classes).
- `docs/DESIGN.md` §3 (layout) and §4's slider sentence are superseded by this document and should be rewritten to match once built. §2, §5, §6, §8 stand.

## 4. Approaches considered

Shown as mockups; the user picked by looking.

1. **Left icon rail with one floating panel** (reference-literal). Globe full-bleed, a 48 px rail opens a glass panel over the stage. Rejected: lists over the map hide points, and the user wanted a solid full-height column.
2. **Fixed right column with tabs.** Today's column, narrowed, with tabs instead of scroll. Rejected: least change, but the globe never gets the width and the reference's silhouette is left panel, globe right.
3. **Globe only, panels on demand.** Nothing until a click. Rejected: hides the tables from the judges' first screen.
4. **Full-height left column holding navigation and the active section, globe right, top bar, bottom dock.** Chosen.

Within 4, for the column's navigation:
- Vertical nav list (six rows): rejected, half-empty rows wasting the column.
- Thin icon rail beside the column: the reference's silhouette, but the user preferred the strip.
- Nav rows carrying a number and a sparkline: rejected as cluttered.
- Nav tabs carrying a headline figure or a stat ticker: rejected as cluttered.
- **Icon tab strip across the top of the column, icon and label only, no badges, no figures.** Chosen.

For the column's width (raised by the builder check: the mockup's 300 px cannot hold today's tables, whose fixed columns need ~400 px plus the name):
- Compact row anatomy at 340 px, dropping population and the sparkline into tooltips: rejected, the user wants the whole data visible.
- Sideways scroll: rejected.
- **As wide as the data needs and no wider, about 460 px, every column kept.** Chosen. The user's rule: fit the whole data, don't overshadow the globe.

## 5. The layout

```
┌──────────────────────────────── top bar · 44 px ─────────────────────────────────────┐
│ ● Earth System Trend Detective   [⌕ search place  /] [Now|Next 14 days] [Wildfire▾]   │
│   NASA FIRMS · POWER · GIBS · Open-Meteo   [Rainfall▾] [World▾] [Imagery: none▾]      │
│                                                          ● LIVE · updated 3h ago  08:58 UTC │
├──────────── left column · ~460 px ───────────┬──────────── stage · the rest ────────────┤
│ [Risk] [Trends] [Place] [Alerts] [Regions]   │ ┌legend┐                     ┌place card┐ │
│ [Sources]        icon + label, active underlined │ └──────┘                     └──────────┘ │
│ ─────────────────────────────────────────── │                                            │
│ active section's content, scrolls inside     │               globe canvas                 │
│ (hazards table + movers when tab = Risk)     │                                            │
│                                              │ ┌──────────────── dock ──────────────────┐ │
│ ─────────────────────────────────────────── │ │ ▶ ──hindcast──●──today──forecast──  date │ │
│ ● FIRMS 3h  ● POWER 1d  ● Open-Meteo 9h  6/6 │ │ [fires 24h][extreme][drying][hit][gates][region] │ │
└──────────────────────────────────────────────┴──────────────────────────────────────────┘
```

Body never scrolls. The column's content area is the only scroll container (thin scrollbar, as today).

### 5.1 Top bar (44 px, full width, `bg-page`, 1 px `border` under it)

Left: orange dot, title (15 px semibold tight), under it one 10 px muted line `NASA FIRMS · POWER · GIBS · Open-Meteo`. The 11.5 px context sentence that today reads "554 places on watch · trends and 14-day hazard risk from…" moves to the Sources tab header **(call)**.

Centre: the existing controls, unchanged in behaviour: search (focus on `/`), Now / Next 14 days segmented toggle, hazard select, trend-variable select, region select, imagery select (the GIBS layer toggle, today a floating chip row on the globe). Styled as DESIGN.md §2 buttons and chips: ghost, 10 px uppercase, `border-white/15`; the active segment uses `bg-accent/15 text-ink border-accent/60` **(call)**.

Right: the live/stale pill exactly as today, then a mono UTC clock `YYYY-MM-DD HH:MM UTC` ticking once a minute. The pill's title tooltip keeps run id and finish time.

### 5.2 Left column (as wide as the widest table needs, ~460 px; `#0f0f0e` **(call)**; 1 px `border` on the right)

The width is set by the data, not the mockup: the hazards table keeps rank, place, country, value with ramp bar, hindcast sparkline, Δ 7d, category and population; the trends table keeps all of its columns; `Movers` stays two tables side by side; the place panel keeps its four hazard cards in a row. Measure the widest tab once built and set the column to that, then stop. It must never grow past ~480 px: at 1600 px wide the globe keeps ≥ 1100 px, against 1040 px boxed in today.

**Tab strip.** Six tabs in one row, equal width, each an icon (lucide-react, 14 px **(call)**: `flame`, `trending-down`, `map-pin`, `bell`, `globe`, `database`) above a 9 px label. Active tab: `text-ink`, icon tinted accent at 20 % with an accent border, a 2 px accent underline. Inactive: `text-muted`. No badges, no figures. Keyboard: tabs are `role="tab"`, arrow keys move, `1`–`6` jump **(call)**.

Tabs and what each holds (every component exists today; it moves, it is not rewritten):

| Tab | Content, top to bottom | Today's component |
|---|---|---|
| Risk | hazards table (takes the remaining height, scrolls inside), movers pinned under it as a compact top-5 up / top-5 down so both are on screen without scrolling **(call)** | `HazardsTable`, `Movers` |
| Trends | trends table (full height) | `TrendsTable` |
| Place | the selected place's whole panel; the empty state when nothing is selected | `PlacePanel` |
| Alerts | feed | `Feed` |
| Regions | continent bars and small multiples | `Continents` |
| Sources | the context sentence, freshness, honesty, sources table, disclaimer footer | `Freshness`, `Honesty`, `Sources`, footer |

Rules:
- Risk tab is open on first paint. `mode === "now"` no longer reorders tables; it still switches the hazard cards' headline and the globe colouring as today.
- Selecting a place (row click, globe click, alert click, search pick) switches to the Place tab **(call)**. Escape clears the selection and returns to the tab that was open before **(call)**.
- Picking an alert still sets hazard and flies the globe (DESIGN.md §4), then opens Place.
- The region filter (continent) applies to every tab as today.

**Column footer** (pinned, 1 px `border` above): one row of source status dots, 9 px: `FIRMS 3h · POWER 1d · Open-Meteo 9h · 6/6 gates`, green/amber/red by `freshness.json` status, mono ages. Clicking it opens the Sources tab. This replaces the "places on watch" KPI's gate count.

**KPI tiles are removed.** Their four numbers move: places on watch → Sources tab header; fires 24 h, places drying, top-20 hit rate → the dock.

### 5.3 Stage

The globe fills the stage. `Globe.tsx` is unchanged except: the GIBS chip row and 30-day slider (`GibsControl`) are removed from the globe, their layer picker moves to the top bar's imagery select, and their date follows the dock's timeline day **(call)**.

**Legend** (top-left, glass): exactly today's `Legend` component, moved from bottom-left.

**Place card** (top-right, glass, 220 px wide, only when a place is selected) **(call)**: place name, country, population; the active hazard's headline (22 px mono: probability or category) with the category chip; the first sentence of `risk.text[place][hazard]`; a 34 px fire-weather forecast sparkline from `fwi_forecast` (wildfire only); a "details" link that opens the Place tab. It is a summary; the full charts stay in the column.

**Hover tooltip** on points: unchanged.

### 5.4 Dock (bottom, glass, 14 px inset left/right/bottom)

Two rows.

**Timeline.** Play button (650 ms per step, as today's spec), a track spanning −14 days to +14 days with today marked, a hatched band over the past, tick labels every 7 days in mono, a knob, and a mono date readout with a `hindcast ◂ ▸ forecast` caption.

What scrubbing does **(call)**:
- "Today" on the track is `risk.valid_from` (the run's day), not the browser clock, so the knob always sits on real values. `history_days` ends the day before it and `forecast_days` starts on it, so the track is contiguous.
- Days < today recolour the globe's risk points from `risk.history[hazard][place][day]` for the selected hazard (the last 90 days exist; the track shows 14, the full range is a Low item). Tables do not change with the day; the day is a globe view. History holds the native value (p, index, days-above) and no category, and the dashboard has category thresholds only for wildfire and rain, so: scrubbing always colours by the continuous value ramp, the legend title says "hindcast · <day>", and for drought and heat the past half is disabled with the caption "hindcast scrubbing: wildfire and rain" until their thresholds are published (a contracts.md note and a pipeline touch; Low item).
- Days > today exist only for wildfire: points recolour from `fwi_forecast[place][day]` on its absolute 0–1 scale (it is already FWI severity 0–1 per contracts.md; do not normalise per place, that would light up every place on its own worst day), and the legend title changes to "fire-weather index · forecast (Open-Meteo)" so nobody reads a forecast index as the model's probability. For other hazards the forecast half is disabled (muted, not draggable) with the caption "forecast scrubbing: wildfire only".
- When an imagery layer is on, its date follows the scrubbed day, clamped to the layer's available range as `clampGibsDate` does today. The legacy `?date=` URL parameter folds into `?day=` on load (read once, written back as `day`), so the raster and the points can never show different days.
- `day` is in the URL (`?day=YYYY-MM-DD`), absent means today. A `day` older than the newest run's history range clamps to its edge.

**Gauges.** Six tiles in one row, each a 30 px ring (conic gradient) plus label, 13 px value, 7 px sub. Rings only where there is an honest denominator; otherwise the ring is omitted and the value stands alone **(call)**:

| Tile | Value | Ring | Colour |
|---|---|---|---|
| Fires · 24 h | sum of `fires.bins` counts | none | `s2` orange |
| Places extreme | count of `risk.now[i][hazard].category === "extreme"` | / places in filter | `warning` yellow |
| Places drying | 10-yr rain slope < 0 (today's KPI) | / places in filter | `s4` |
| Top-20 hit rate | `honesty.top20_hit_rate` | % | `good` green, sub shows baseline |
| Gates | passed / judged from `run.gates` | fraction | `good` green, amber if any failed |
| Region mean risk | `continents.mean_now[hazard][continent]` or world mean | % | hazard colour |

Every tile keeps the `title` tooltip text today's KPI tiles carry. The gauge row follows the region filter like the KPIs did.

### 5.5 Mobile (under 768 px): "M4", approved 2026-11-15

Decided from three phone mockups (bottom sheet with a tab bar, globe-on-top with a card carousel, left drawer) and then reshaped to the user's own idea: sections in a side drawer, the selected city's data rising from the bottom only when a city is tapped. The user's words: data at the bottom all the time is hard to look at, but when they tap a city we show the data somehow, and a layout shift is fine.

Three states, one layout:

```
state 1 · idle              state 2 · city tapped          state 3 · ≡ tapped
┌──────────────┐            ┌──────────────┐               ┌─────────┬────┐
│ ≡ ● title ⌕ │            │ ≡ ● title ⌕ │               │ tabs    │    │
│ [chips…]     │            │ [chips…]     │               │ Risk ▾  │    │
│              │            │   globe ◎    │  globe slides │ table   │dim │
│    globe     │            ├──────────────┤  up, city at  │ …       │glo │
│   (heatmap)  │            │ Faisalabad 100% ✕          │ movers  │be  │
│              │            │ [fire][drought][heat][rain]│ sources │    │
│              │            │ fire-weather curve         │         │    │
│ [▶ ─●─ today]│            │ drivers · drag up for more │         │    │
└──────────────┘            │ [▶ ─●─ today]              └─────────┴────┘
                            └──────────────┘
```

- **State 1.** Top bar as a glass pill: ≡ (drawer), orange dot, short title "Trend Detective", live dot, ⌕ (search). Under it a horizontally scrolling chip row with the same controls as the desktop top bar (mode, hazard, trend, region, imagery). The globe fills the rest. The bottom carries only the timeline as a one-line glass pill **(call: kept because the user asked earlier for the slider to stay visible)**. No gauges on mobile; their numbers are in the Sources tab and the Risk tab header.
- **State 2.** Tapping a globe point, a search result or a drawer row: the stage shrinks to the top ~46 % of the screen, the globe flies so the city sits at the centre of the visible half, and a sheet rises to ~54 %. Sheet contents top to bottom: grab handle; place name, country, population, coordinates, with the active hazard's headline (17 px mono) and category chip at the right and ✕; the one-line driver sentence; four hazard cards in a row (hazard-coloured left border, 12 px mono value); the fire-weather forecast curve; the SHAP driver bars; the timeline docked into the sheet's bottom edge. Dragging the sheet up reveals the rest of today's `PlacePanel` (trend chart with variable chips, the three anomaly series, the sentence). ✕ or swipe-down returns to state 1 and clears the selection; the globe animates back to full height.
- **State 3.** ≡ opens a drawer from the left at 74 % width over a 45 % scrim. It is the desktop column re-flowed: the tab strip (icon + label) with **five** tabs, Risk, Trends, Alerts, Regions, Sources; no Place tab, because the sheet is the place view **(call)**. Content is the same components as desktop in their column layout; the hazards table hides its sparkline and population columns under 400 px wide **(call)**, which is the only place the "whole data visible" rule bends, and those two values are in the sheet. The source-status strip is pinned at the drawer's bottom. Tapping a row closes the drawer, flies the globe and opens the sheet. Tapping the scrim or swiping left closes it.
- Transitions: sheet and drawer 240 ms ease-out; the stage resize and the fly-to run together so the city lands centred as the sheet finishes **(call)**. Reduced-motion users get instant state changes.
- URL state is identical to desktop; `tab=` maps to the drawer's tab and opens it on load only if the URL names one.
- Touch targets ≥ 44 px on the tab strip, chips, ✕, play button and knob. The timeline knob gets a 28 px invisible hit area.
- The heatmap (§6.1 band 1) is what makes state 1 worth looking at; mobile should ship after F1.

## 6. Colour usage cleanup (same palette, applied differently)

Observed in the current build and to be fixed as part of this work:

- The hazards table paints a full-length orange bar and an "extreme" chip on every row when the top 20 are all at 100 %. Result: a solid orange block. Fix: the inline ramp bar keeps its width but takes its colour from `RISK_STOPS` at the row's value, as the globe does, and the category chip is a 5 px dot plus muted text, not a filled pill.
- `Δ 7d` chips are tinted orange or blue on every row including `0 pt`. Fix: `0 pt` and `−0 pt` render in `muted` with no tint; only non-zero deltas get colour.
- The hindcast sparkline fill is a flat yellow block behind every row. Fix: 1.2 px line in `s2`, no fill, as DESIGN.md §5's sparkline rule says.
- Green appears as both "live" and "good KPI sub" and the table caption's category names. Fix: green only on the live pill, the gates tile and the hit-rate tile. Category names in captions are `ink-2`.
- Three gradients today: the title pill tint, the control panel `bg-black/55`, and the slider panel. Fix: one glass recipe for every floating panel: `bg-black/60 border-white/10 backdrop-blur rounded-xl`. No other gradient except the legend ramp and the gauge rings.
- The globe's fire detections blanket Africa into a pink mass at zoom 1.6 and sit on a visible 0.25° grid. Fixed by §6.1 below, not by styling the dots.

### 6.1 Fire layer: the wow moment

State on 2026-11-15 (s3-globe, KI-1 done): the fire cells have a hover tooltip (count, cell size, max FRP, source, newest acquisition), a legend row with three sample dots for 1 / 10 / 50 detections, and a radius that grows with √count, scaled 0.75× at world zoom. `globe/fires.ts` holds the radius law, colours and formatters. All of that stays; it is the zoomed-in experience. The grid still shows at world zoom because every dot is a cell centre, and no dot styling can hide that.

**Band 1 · heatmap at world zoom** (S3 only, ~1 h, ship first: it is the demo's opening frame)
- One `heatmap` layer on the existing `fires` GeoJSON source, inserted under the glow and dot layers. `heatmap-weight` = `min(count, 60) / 60` so one mega-cell cannot wash out a region; `heatmap-radius` ≈ 18 px at zoom 2 rising to ≈ 28 px at zoom 4; `heatmap-intensity` 1; `heatmap-color` from transparent through `#9a3412`, `#ea580c`, `#fbbf24` to `#fef3c7`, the risk ramp's own colours, so the globe stays one system.
- Crossfade on zoom: `heatmap-opacity` 0.9 at zoom ≤ 2.5 → 0 at zoom 4.5; the existing glow and dot layers get the inverse (`circle-opacity` 0 at 2.5 → 1 at 4.5). At the fly-to zoom (5.2) a judge sees exactly the KI-1 dots and tooltip.
- Legend fire row: below zoom 4 show the ramp swatch and "active fires · density of VIIRS detections, last 24 h"; above it show the three sample dots as today. One conditional in `Legend.tsx` fed by a `zoom` value the globe already tracks for the GIBS control.
- The tooltip hit-test stays on the dot layer; hovering the heatmap does nothing, which is right for a density view.
- No pipeline change, no new file.

**Band 2 · real detections when zoomed in** (S1 + S3, 2–3 h, only if time allows)
- S1 writes a second file from the same live parquet `ingest/fires24.py` reads: `fires_points.json` = `{ "meta", "source", "newest_acq", "points": [[lon, lat, frp], …] }` at two decimals, same source filter as the bins. ~35k rows ≈ 600 KB raw, ≈ 220 KB gzipped from Pages. Contracts.md §3 gains the file with a dated note; gates do not read it.
- S3 loads it lazily the first time zoom crosses 4 (not in `loadAll`, so first paint is unchanged), then points the dot and glow layers at a second source with the real positions, radius by FRP (`2 + 0.5·√FRP` px, capped at 11) and the same tooltip minus the cell line. The bins stay for the heatmap and for sessions that never zoom in. If the fetch fails the bins keep drawing; nothing breaks.
- Never jitter the bin centres to hide the grid. Fake positions are worse than a visible grid.
- The dock's timeline does not touch fires; the file is the last 24 h only.

## 7. Type and density

- Column text sizes stay as DESIGN.md §2: 11 px table rows, 10 px captions, 9 px chips.
- Every card keeps one caption line, but captions that explain method (the ramp percentiles, the hit-rate definition) move from under each table to the Sources tab, leaving the Risk tab with the table, its one-line question heading and the movers **(call)**. The `title` tooltips keep the long explanations where they were.

## 8. Motion

- Tab switch: content cross-fades 120 ms **(call)**. Nothing slides.
- Place card: fades in 150 ms on selection.
- Dock play: steps the day every 650 ms; the globe recolours via feature-state without animation.
- Newest alert pulse and fly-to: unchanged.
- Nothing animates on load.

## 9. What's left to the builder

- Exact icon choices and the tab strip's hover state.
- How `HazardsTable` and `TrendsTable` get "full height, scroll inside" (they already cap at ~20 rows; lifting the cap inside a flex container is the likely change).
- Where the day-scrub recolouring lives (a `day` prop on `Globe` that picks `history`/`fwi_forecast` over `now` is the obvious shape).
- The gauge ring component and the dock's responsive behaviour between 1280 and 1600 px (tiles may drop their sub line).
- Whether the clock is a component or lives in the top bar.
- `walk.mjs` depends on `aside > section` cards and the subtitle text "places on watch ·", both gone; it needs a rewrite alongside L1.
- `lucide-react` is not installed; add it with L1.

## 10. Work packages and status

This section is the tracker. The work is split across sessions; each session takes one package, builds it on a branch from `origin/main`, updates the status line here in the same PR, and hands back with screenshots per the repo's handback rule. Order matters only where noted. Owners follow contracts.md §1 (S3 globe, S4 panels, S1 pipeline).

| ID | Package | Owner | Depends on | Status |
|---|---|---|---|---|
| L1 | Left column with the six-tab strip; move the eleven sections into tabs; column footer with source dots; KPI tiles removed; column width measured and set (§5.2); `tab` in state and URL; `walk.mjs` rewritten; `lucide-react` added | S4 | – | open |
| L2 | Top bar (§5.1): brand + source strip, controls moved up, imagery select back in the bar, live pill, UTC clock; title block and floating control panel removed from the globe | S4 | L1 | open |
| L3 | Stage furniture (§5.3): legend to top-left, place card top-right, `GibsControl` removed from the globe | S3 | L2 | open |
| L4 | Dock gauges (§5.4 gauges table): ring component, six tiles, region filter, tooltips | S4 | L1 | open |
| L5 | Dock timeline (§5.4 timeline): track, play, `day` in state and URL, globe recolour from `history` / `fwi_forecast`, GIBS date follows the day, `date=` folded into `day=` | S3 | L3, L4 | open |
| L6 | Colour usage cleanup (§6 bullets): ramp-coloured bars, zero-delta chips muted, sparklines without fill, green only on live/gates/hit-rate, one glass recipe, captions to the Sources tab (§7) | S4 | L1 | open |
| F1 | Fire heatmap at world zoom with zoom crossfade and legend swap (§6.1 band 1) | S3 | – (ship first) | done (PR) |
| F2 | `fires_points.json` from the pipeline, lazy load above zoom 4, real-position dots (§6.1 band 2) | S1 + S3 | F1 | open, only if time allows |
| L7 | DESIGN.md §3 and §4 rewritten to match; KNOWN_ISSUES entries KI-14 / KI-15 re-checked against the new chrome; final walk proof | S4 | all above | open |
| L8 | Mobile layout "M4" (§5.5): breakpoints, glass top bar + chip row, timeline pill, city sheet with stage resize and centred fly-to, sections drawer with five tabs, touch targets; proof screenshots at 390 × 844 for all three states | S3 + S4 | L1, L3, L5, F1 | open |

Done before this document: KI-1 fire tooltip, legend row and √count radii (s3-globe, 2026-11-15).

Not in scope here, tracked elsewhere: a landing or pitch page.
