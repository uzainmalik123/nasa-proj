# DESIGN.md · Earth System Trend Detective

The visual system from the November spike, written down so the fresh repo reproduces it exactly and extends it without drift. Everything here is already implemented once; the tokens and numbers are copied from the working code, not invented.

## 1. Principles

1. **The data is the subject.** The basemap, chrome, and labels are dimmed so the risk points, fire detections, and chart lines are the brightest things on screen.
2. **One dark surface, one accent.** Near-black page, slightly lighter cards, warm orange accent used only for risk, fire, and interactive emphasis.
3. **Dense but legible.** Lots of charts and tables, each small, each with a one-line caption that says what it means. 10 to 12 px type is normal in the sidebar.
4. **Every chart answers one question.** The card heading is the question in plain words ("Rainfall deficit leads fire"), not the chart type.
5. **Numbers in mono, words in sans.** Mono for anything that aligns: coordinates, percentages, tick labels, timestamps.
6. **Live feels live.** A pulsing ring on the newest alert, an "updated Nh ago" stamp, fly-to on click. Motion only where it carries meaning.

## 2. Tokens

### Colour
```ts
// lib/palette.ts
export const P = {
  page:     "#0d0d0d",   // app background
  surface:  "#1a1a19",   // cards, tooltips body
  surface2: "#222221",   // hover rows, inputs
  ink:      "#ffffff",   // primary text, selected outline
  ink2:     "#c3c2b7",   // secondary text, chart labels
  muted:    "#898781",   // captions, axis labels, headings
  grid:     "#2c2c2a",   // chart gridlines
  axis:     "#383835",   // zero lines, axis strokes
  border:   "rgba(255,255,255,0.10)",

  s1: "#3987e5",   // blue    rainfall, soil moisture, "lowers risk", predicted
  s2: "#d95926",   // orange  fire, "raises risk", observed
  s3: "#199e70",   // aqua    vegetation / NDVI
  s4: "#c98500",   // yellow  temperature / LST

  critical: "#d03b3b",
  warning:  "#fab219",
  good:     "#0ca30c",
};
```
Series colours are bound to a meaning, not to a slot. Rain is always blue, fire always orange, vegetation always aqua, temperature always yellow, in every chart and legend.

### Risk ramp (sequential, transparent at zero)
```ts
export const RISK_STOPS: [number, string][] = [
  [0.00,  "rgba(255,120,40,0)"],
  [0.15,  "rgba(140,45,15,0.45)"],   // 50th pct of wildfire p, run 20261114T0949Z
  [0.59,  "#9a3412"],                // 80th
  [0.92,  "#ea580c"],                // 95th
  [0.995, "#fbbf24"],                // 99th
  [1.00,  "#fef3c7"],
];
```
Stop values set 14 Nov 2026 after the first real scoring run (554 places), per the rule below. The spike's values were 0.05 / 0.20 / 0.40 / 0.65.
Used for the globe points, the risk sparkline fill, and the table bars. Always shown with a legend. Risk below the first stop is nearly invisible on purpose: the globe should look calm except where it matters.

**The stop values are tunable, the colours are not (call).** The number shown is a calibrated probability, and the global base rate is unknown until real data is in. On day 1, after the first scoring run, set the stops at the 50th, 80th, 95th and 99th percentiles of current place risk and write the resulting probability values into the legend. If that makes the legend read "0 · 4 · 11 · 30 · 100 %", that is fine. The ramp encodes "unusual for the world right now"; the number next to it stays the honest probability.

### CSS variables
```css
:root {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --surface-2: #222221;
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --border: rgba(255,255,255,0.1);
  --accent: #ea580c;
}
```
Exposed to Tailwind v4 through `@theme inline` as `bg-page`, `bg-surface`, `text-ink`, `text-ink-2`, `text-muted`, `border-grid`, `text-accent`.

### Type
- Sans: Geist (via next/font), `--font-sans`.
- Mono: Geist Mono, `--font-mono`.
- Sizes in use: 22 px KPI value (semibold), 15 px app title (semibold, tight tracking), 12 px slider date, 11.5 px body in cards, 11 px card headings (uppercase, 0.08 em tracking, semibold, muted), 10 px captions, tick labels, chips, 9 px chip text inside pills.
- Line height `leading-snug` for 11.5 px prose.

### Shape and spacing
- Card: `background var(--surface); border 1px solid var(--border); border-radius 14px; padding 14px 16px`.
- KPI tile: same card, padding `14px 12px`.
- Sidebar gap between cards: 12 px. Sidebar padding: 12 px.
- Floating panels on the globe (slider, legend): `rounded-2xl` or `rounded-xl`, `bg-black/55 to /60`, `border-white/10`, `backdrop-blur`.
- Chips: `rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-ink-2`.
- Selected row: `border-white/30 bg-white/[0.06]`. Hover row: `bg-white/[0.04]`.
- Buttons: ghost. `text-[10px] text-muted hover:text-ink`. Primary round button (play): `h-8 w-8 rounded-full border-white/15 bg-white/5 hover:bg-white/10`.

## 3. Layout

```
┌────────────────────────────────── 100vh, overflow hidden ──────────────────────────┐
│ ┌──────── globe column, flex 1.15, min-w 0 ─────────┐┌── aside 560px, scroll ─────┐ │
│ │ title block top-left (pointer-events none)         ││ KPI grid 4 cols           │ │
│ │                                                    ││ card                      │ │
│ │               globe canvas (absolute inset 0)      ││ card                      │ │
│ │                                                    ││ card                      │ │
│ │ legend bottom-left        time slider bottom-centre││ ...                       │ │
│ │                           (min(640px, 80%) wide)   ││ footer note 10px muted    │ │
│ └────────────────────────────────────────────────────┘└───────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```
- The body never scrolls. Only the aside scrolls, with a thin scrollbar (`scrollbar-width: thin`).
- The globe container must be `position: absolute; inset: 0` as an inline style. MapLibre's CSS sets `.maplibregl-map { position: relative }` and will override a class.
- Title block: orange dot + title, one line of 11.5 px context under it, then a status pill (uppercase 10 px, coloured border and tinted background). In the real build the pill reads "live · updated 2h ago" in `good` green instead of the synthetic warning.
- For the global version the aside keeps 560 px. Tables that need more width get a full-width drawer under the globe rather than a wider sidebar **(call)**.

## 4. Globe

- MapLibre GL, `projection: globe`, OpenFreeMap `dark` style (no key), zoom 2.7 regional / 1.6 global, pitch 0.
- Atmosphere: `atmosphere-blend` interpolated 1 at zoom 0 to 0 at zoom 8.
- Dim the basemap: hide every symbol layer matching `label|place|poi|road` except country, state, region, city, capital names.
- Layer order bottom to top: GIBS raster overlay (optional, opacity 0.55), risk points, selected outline, fire glow, fire dots.
- **Risk points** (global version): `circle` layer, colour from `RISK_STOPS` via feature-state, stroke `rgba(0,0,0,0.6)` 1 px so points separate from the basemap. Radius follows the same rank breakpoints as the colour so size and colour agree: 3 px at the first stop, 3.5 / 5 / 8 / 11 px at the 80 / 95 / 99th-percentile stops (computed in `globe/colour.ts` from `RISK_STOPS`, so retuning the stops retunes the radii). Places below the first stop render at 3 px in `muted` at 0.5 opacity so the world still reads as "watched". Trend colouring keeps a linear 3 to 11 px radius on the normalised slope.
- **Selected place**: white 2 px ring, 1.5× radius.
- **Fire detections**: two circle layers over the same source. Glow: `#fff7ed`, radius 6 to 18 by count, opacity 0.18, blur 1. Dot: `#fff7ed`, radius 2.2 to 5, stroke `#d03b3b` 1.2 px. For global 0.25° bins use the same pair; radius scales with count.
- Cursor pointer on hover over points. Click selects. Fly-to on alert pick: `zoom max(current, 5.2)`, `speed 0.9`.
- Legend bottom-left: gradient bar 176 px wide with the stops spaced evenly (the bar encodes rank), labelled with the probability at each stop (today 0 · 15 · 59 · 92 · 100 %), a caption naming the percentiles, the category thresholds for probability hazards (wildfire elevated ≥ 30 · high ≥ 60 · extreme ≥ 90 %), then a sample fire dot and the words "active fire detection (FIRMS)".

## 5. Chart grammar

All charts are hand-built SVG with d3-scale and d3-shape. No charting library. Rules shared by every chart:

- Measure the container with a `ResizeObserver` hook and render nothing until width > 0. Prevents negative rect widths on first paint.
- `overflow-visible` on the SVG so labels can sit on the edge.
- Margins: left 34 to 36 px for a mono y axis, right 6 to 8, top 8 to 20, bottom 22 when there are x labels.
- Gridlines `P.grid`, zero line `P.axis`. 3 to 4 y ticks, mono 10 px `muted`, right-aligned at x = left margin minus 6.
- X labels every ~9 to 13 points, "Mon YY" format, 10 px `muted`, centred.
- Lines 1.8 to 2 px, round joins. Areas (normal band) `ink` at 8% opacity.
- Anomaly markers: 3.5 px circle, fill `surface`, stroke `critical` 1.5 px.
- Current-time cursor: 1 px `ink` at 60% opacity.
- Hover: one transparent rect over the plot area, nearest-point lookup via `scalePoint.step()`, tooltip positioned at the data point and flipped to the left past 62% width.
- Tooltip: `bg-black/80 border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] backdrop-blur`, rows of coloured dot + muted label + mono value aligned right.
- Every chart ends with a one-line legend or caption in 10 px `muted` using inline swatches (a 4 px wide line for series, a 2.5 px tall box for bands, a ringed dot for anomalies).

### Chart catalogue (proven in the spike, rebuilt for the global screen)
| Chart | Shape | Encodes |
|---|---|---|
| AnomalySeries | line over a ±1σ band, flagged points, time cursor | one variable vs the place's own normal |
| DriverBars | horizontal diverging bars, labels left, mono values at bar end | SHAP: orange raises, blue lowers |
| KPI tile | 10 px uppercase label, 22 px value, 10.5 px sub in green when good | headline metrics |

The spike also had RegionalSeries, LagBars, Backtest, Calibration and a seasonal Calendar heatmap. **None of these are on the global screen (call).** Build only what the PRD's one-screen layout shows. The lag chart and the calendar can come back as Low items if time allows; their grammar above still applies.

### Chart catalogue (new for the global version)
| Chart | Shape | Notes |
|---|---|---|
| Ranked table | dense rows: rank, name, country, risk % as mono + tiny ramp bar, sparkline of the last 14 days of hindcast risk, Δ chip vs 7 days ago | sortable headers; click row = select + fly-to; max ~20 rows visible, scroll inside |
| Trend chart | 10-year monthly means as a thin line with the Sen's slope drawn as a straight dashed line through it, 90-day daily values inset at right with its own slope; label "↑ +0.8 mm/yr · p=0.01" in mono | the challenge's core chart; one per variable, stacked, shared x |
| Hazard card | four small cards in a row: hazard name, 22 px probability or category, then four 10 px rows: severity, exposure, confidence, valid window; coloured left border in the hazard's colour (fire orange, drought yellow, heat critical red, rain blue) | never collapse the four numbers into one |
| Sources panel | table: source, kind (observation / forecast / trend / risk assessment), valid for, retrieved at, status dot | the blueprint's provenance rule, always visible |
| Fire-weather forecast curve | single line of the daily fire weather index for the next 14 days, area fill from `RISK_STOPS`, today marked at the left edge; the model's single 14-day probability sits above it as a 22 px number | the curve is the forecast's physics, the number is the model; caption says so |
| Movers | two short tables side by side, up (orange Δ) and down (blue Δ) | same row anatomy as ranked table |
| Continent bars | horizontal stacked bars, buckets low/elevated/high/extreme using ramp stops | one row per continent, counts in mono |
| Continent small multiples | 7 tiny line charts in a row, 60 px tall, shared y | mean risk over 90 days |
| Freshness | table: source, last fetch (relative), records, status dot | green/amber/red by age |
| Honesty | bar pairs predicted vs observed by bucket, plus one sentence | small, below the fold |

### Table rules
- Row height 28 px, 11 px text, mono for every number, right-align numbers.
- Header 10 px uppercase muted, sortable with a thin caret.
- Inline ramp bar: 40 × 4 px rounded, filled proportionally in the risk colour.
- Sparkline: 64 × 16 px, 1.2 px line in the series colour, no axes.
- Δ chip: `+12 pt` in orange when rising, `−8 pt` in blue when falling, mono 10 px.
- Zebra off. Separation by a 1 px `border` line only.

## 6. Copy and tone

- Headings are questions or claims in sentence case, uppercased by CSS: "Rainfall deficit leads fire", "Why this alert".
- Captions explain the method in one line: "Trained on … never saw the test year."
- Alert sentence pattern: "Risk 62% for the next two weeks. Rainfall is 48% below normal over the last four weeks; land surface temperature is running 1.8 standard deviations hot. Main driver: 4-week rainfall anomaly."
- Units always present: mm, σ, %, °C. Greek sigma is used for z-scores.
- Timestamps in UTC, `YYYY-MM-DD HH:MM UTC`. Relative age ("2h ago") in the status pill only.
- Never say "AI". Say "model".

## 7. Motion

- Newest alert dot: `pulse-ring` keyframe, 1.6 s ease-out infinite, scale 0.6 to 1.8, opacity 0.9 to 0.
- Play button advances one step every 650 ms.
- Fly-to only on explicit pick, never on data refresh.
- Hover transitions: `transition` default (150 ms) on row background only.
- Nothing animates on load except the globe's own tile fade.

## 8. Accessibility and hygiene

- Buttons carry `aria-label` when icon-only.
- Contrast: `ink2` on `surface` passes AA; `muted` is for captions only, never for essential values.
- Keyboard: search box focusable with `/`, rows are buttons, Escape clears selection **(call)**.
- No layout shift: cards have fixed chart heights (80, 110, 150 px) so the sidebar does not jump when data arrives.

## 9. Do and don't

- Do keep the globe calm. Risk below 5% is transparent.
- Do bind colour to meaning across the whole app.
- Do write the question in the card heading.
- Don't add a second accent colour. Green is reserved for "good" and status.
- Don't use filled polygons for risk. Points only.
- Don't let any chart appear without a caption or legend.
- Don't centre text in tables.
