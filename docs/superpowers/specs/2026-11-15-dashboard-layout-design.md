# Dashboard layout redesign · design

2026-11-15. Decided with the user in a brainstorming session with browser mockups (`.superpowers/brainstorm/56846-1794715072/content/`, not committed). Anything marked **(call)** is my decision; change it freely.

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
- Mobile. Minimum supported width 1280 px **(call)**; below that the left column collapses to a drawer is a Low item if time allows.
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

## 5. The layout

```
┌──────────────────────────────── top bar · 44 px ─────────────────────────────────────┐
│ ● Earth System Trend Detective   [⌕ search place  /] [Now|Next 14 days] [Wildfire▾]   │
│   NASA FIRMS · POWER · GIBS · Open-Meteo   [Rainfall▾] [World▾] [Imagery: none▾]      │
│                                                          ● LIVE · updated 3h ago  08:58 UTC │
├──────────── left column · 300 px ────────────┬──────────── stage · the rest ────────────┤
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

### 5.2 Left column (300 px, `bg-surface`-ish `#0f0f0e` **(call)**, 1 px `border` on the right)

**Tab strip.** Six tabs in one row, equal width, each an icon (lucide-react, 14 px **(call)**: `flame`, `trending-down`, `map-pin`, `bell`, `globe`, `database`) above a 9 px label. Active tab: `text-ink`, icon tinted accent at 20 % with an accent border, a 2 px accent underline. Inactive: `text-muted`. No badges, no figures. Keyboard: tabs are `role="tab"`, arrow keys move, `1`–`6` jump **(call)**.

Tabs and what each holds (every component exists today; it moves, it is not rewritten):

| Tab | Content, top to bottom | Today's component |
|---|---|---|
| Risk | hazards table (full height, scrolls inside), movers | `HazardsTable`, `Movers` |
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
- Days ≤ today recolour the globe's risk points from `risk.history[hazard][place][day]` for the selected hazard (the last 90 days exist; the track shows 14, the full range is a Low item). Tables do not change with the day; the day is a globe view.
- Days > today exist only for wildfire: points recolour from `fwi_forecast[place][day]`, normalised to the 16-day max per place, and the legend title changes to "fire-weather index · forecast (Open-Meteo)" so nobody reads a forecast index as the model's probability. For other hazards the forecast half is disabled (muted, not draggable) with the caption "forecast scrubbing: wildfire only".
- When an imagery layer is on, its date follows the scrubbed day, clamped to the layer's available range as `clampGibsDate` does today.
- `day` is in the URL (`?day=YYYY-MM-DD`), absent means today.

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

## 6. Colour usage cleanup (same palette, applied differently)

Observed in the current build and to be fixed as part of this work:

- The hazards table paints a full-length orange bar and an "extreme" chip on every row when the top 20 are all at 100 %. Result: a solid orange block. Fix: the inline ramp bar keeps its width but takes its colour from `RISK_STOPS` at the row's value, as the globe does, and the category chip is a 5 px dot plus muted text, not a filled pill.
- `Δ 7d` chips are tinted orange or blue on every row including `0 pt`. Fix: `0 pt` and `−0 pt` render in `muted` with no tint; only non-zero deltas get colour.
- The hindcast sparkline fill is a flat yellow block behind every row. Fix: 1.2 px line in `s2`, no fill, as DESIGN.md §5's sparkline rule says.
- Green appears as both "live" and "good KPI sub" and the table caption's category names. Fix: green only on the live pill, the gates tile and the hit-rate tile. Category names in captions are `ink-2`.
- Three gradients today: the title pill tint, the control panel `bg-black/55`, and the slider panel. Fix: one glass recipe for every floating panel: `bg-black/60 border-white/10 backdrop-blur rounded-xl`. No other gradient except the legend ramp and the gauge rings.
- The globe's fire detections (white dot, red ring) blanket Africa into a pink mass at zoom 1.6. Fix: at zoom < 2.5 draw fires as the glow layer only (no dot), as DESIGN.md §4 already allows for binned data **(call)**.

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
- Order of work. Suggested: column + tabs first (biggest visual change, no new data logic), then top bar, then dock gauges, then timeline scrubbing, then the colour cleanup, then DESIGN.md §3 rewrite and a new walk.mjs proof pass.
