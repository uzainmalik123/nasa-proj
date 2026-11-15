# Known issues

Started 14 Nov 2026, 20:10 PKT, after the first green run (20261114T1423Z). One entry per issue: what is seen, what was checked, the likely cause, who owns the fix, and how big it is. Add to the bottom; strike through or move to "Fixed" when done. Reviewer calls the order.

Owners follow `contracts.md` §1: S1 pipeline/ingest + gates + workflows · S2 science + publish · S3 globe · S4 panels.

## Open

### ~~KI-1~~ · Globe: the red-outlined dots with a white glow sit on a grid and ignore the mouse · **fixed 15 Nov, see Fixed**
- **Seen:** thousands of small dots with a white centre and red outline, visibly aligned to a grid; hovering does nothing, so they read as fake.
- **Checked:** they are the FIRMS active-fire layer (`fires_24h.json`, legend "active fire detection (FIRMS)"): 35,033 VIIRS NOAA-21 detections from the last 24 h, real satellite data, published as **0.25° bins** (`[lon, lat, count, max_frp]`, centres on the grid, contracts §3), which is why they line up. The globe draws one glow + one dot per bin, radius by count (`globe/Globe.tsx` fire layers), but only the places layer has `mousemove` / `click` handlers; the fire layers have `count` and `frp` properties and no handler at all.
- **Cause:** a deliberate aggregation (binning keeps the file at 170 KB instead of ~2 MB of raw points) with no tooltip and no legend text saying so.
- **Fix sketch (S3, small):** add a hover handler on the fire-dot layer showing "N detections · max FRP x MW · 0.25° cell · VIIRS NOAA-21 · newest HH:MMZ"; say "0.25° cells" in the legend; make the dot radius grow with count more visibly so a 200-detection cell is not the same mark as a single one. If the grid look itself is the objection: S1 can bin finer (0.1°, ~4× the bins) or publish raw points above a zoom level; decide after the tooltip lands.

### KI-3 · "Not every place has the now temperature"
- **Seen:** some places show no current temperature (location on screen not yet pinned down: globe tooltip, place panel anomaly row, or the heat card).
- **Checked:** `series.tmax` has a value on the last observed day (2026-11-13) for all 554 places, soil wetness for 553 (one place's last value is 2026-10-05). POWER itself lags 3 days (`valid_for 2026-11-11`), so there is no "today" observation for any place by design; the panel's anomaly rows take the last non-null value. The heat card shows "–" only when `severity` is null, which no place has.
- **Cause:** not reproduced from the data. Candidates: (a) the globe tooltip in heat mode shows `days_above` = 0 for most places, which may read as "no temperature"; (b) the trend variable "max temperature" shows "insufficient" for some places; (c) the one place with stale soil wetness. Needs the place name and the panel the reviewer was looking at.
- **Fix sketch (S4 / S3, small once pinned):** label what is shown ("last observed 13 Nov, POWER lags 3 days") and never render a bare "–" without a reason.

### KI-4 · Imagery: IMERG rain rate blankets whole countries, nothing underneath is legible
- **Seen:** with imagery = rain rate the raster hides the basemap; places and borders disappear.
- **Checked:** `Globe.tsx` inserts the GIBS raster at 55 % opacity directly below the places layer, i.e. above every basemap layer (borders, labels, coastlines). IMERG is a coarse 0.1° product drawn at tile level 6, so one pixel covers a large area and the colour ramp is saturated.
- **Cause:** layer order plus opacity. The raster should sit under the basemap's boundary and label layers, not over them.
- **Fix sketch (S3 / M-GIBS, medium):** `addLayer(..., beforeId)` with the basemap's first boundary or label layer id (query `map.getStyle().layers` for the first `line` layer with `admin` / `boundary` in its id) so borders and labels draw on top; drop opacity to ~40 % for rain; add an opacity slider or a fixed "imagery dims the globe" note in the legend.

### KI-5 · Imagery: vegetation (NDVI) needs country borders, but not thick ones
- **Seen:** NDVI covers land completely; borders are needed to tell countries apart, thin enough not to cover the vegetation signal.
- **Checked:** same layer order as KI-4; the OpenFreeMap basemap's admin lines are under the raster, so none show.
- **Fix sketch (S3, small, same change as KI-4):** once the raster sits below the boundary layer, set that layer to a 0.6 px line at ~50 % ink when imagery is on (a `setPaintProperty` on the boundary layer id), and restore it when imagery is off.

### KI-6 · Imagery: land surface temperature covers most countries, cannot see the globe
- **Seen:** as KI-4 for the LST layer.
- **Checked:** LST at level 7 has the same ordering problem; the ramp is also dark over hot land, which fights the dark basemap.
- **Fix sketch (S3, same change as KI-4):** layer order + opacity; consider 45 % for LST. If still unreadable, add a "blend" option that only draws the raster over land outside the selected continent's places.

### KI-7 · Dashboard takes up to a minute before anything useful appears · **priority**
- **Seen:** reviewer: ~1 min of "loading… CONNECTING" on the Pages site, long enough for a visitor to leave. Headless Chromium from a fast link: 10–20 s.
- **Checked (20:30 PKT):** raw.githubusercontent.com does gzip; on the wire the nine files are ~1.8 MB (trends 945 KB, series 522 KB, risk 255 KB, fires 41 KB, places 16 KB, rest tiny), ~8 s fetched one after another from here, so a slow link easily turns that into 30–60 s. `loadAll()` fetches `run.json` first and only then the other eight (one extra round trip), then renders nothing until all nine have parsed: 7.5 MB of JSON, 2.7 MB of it `trends.series_long` (120 months × 6 variables × 554 places), which no panel needs until a place is selected.
- **Cause:** everything-first loading. First paint needs ~450 KB gzipped (places, risk `now`, trend slopes/labels, fires); the other ~1.4 MB is per-place detail.
- **Fix sketch, staged:**
  1. **Today, S4, small:** ~~fetch all nine in parallel (drop the run.json-first step; use a timestamp cache-buster)~~ and ~~show a progress line ("3 of 9 files") instead of "connecting"~~ · **done by INTEGRATE d1 (`a9e8742`)**: parallel fetch, 5-minute cache-buster window, "loading N of 9 files" pill; local real-data load 24.6 s → 9.8 s, live 11.6 s in headless Chromium. Still open: render the globe and KPIs as soon as `places` + `risk` arrive, tables as `trends` arrives, skeletons meanwhile.
  1c. **Run-id keyed cache (15 Nov, `data-cache`, `docs/handback/data-cache.md`) · done:** the nine parsed files are kept in IndexedDB under their run id (`lib/cache.ts`); a load renders the cached run at once, then fetches the 1 KB `run.json` fresh and only refetches the nine when the id changed; a fetched set replaces the cache only when its files agree on one newer id (the CDN mid-publish keeps the old run and retries at the next probe). An open tab re-probes every 5 min while visible. Measured against the CDN in headless Chromium: first visit 9.9 s and 10 requests → reload 1.1 s and 1 request. Worst-case staleness is unchanged (the CDN's 5-minute max-age); an open tab now picks up a new run within 5 min, where before it never did. The pill says "checking for a newer run" during the probe and "offline, showing the cached run" when it fails; its tooltip names the run and whether it came from the cache. Also `fetch` now uses the HTTP cache (`cache: "default"`) inside the 5-minute window. The first visit is unchanged: that is step 2 below.
  2. **Split per-place detail out of first paint (S2 + S4, 2–3 h):** `trends.json` keeps slopes, labels and a 12-value sparkline per row; the monthly `series_long`, `series.json`, and risk `history` / `drivers` / `text` move to one small detail file per place fetched on select. First paint drops from 2.1 MB gzipped / 10.6 MB parsed to ~0.5 MB / <1 MB. Contract change: dated note in contracts §3, check the gates read none of the moved keys.
  2. **Day 2, S2 + S4, medium:** split the published files into a *summary* set for first paint and *detail* files loaded on demand: `risk.json` keeps `now`, `model`, `valid_*`; `trends.json` keeps `long`/`short` slopes, p, labels; `series_long`, the 90-day series, the hazard `history`, `drivers` and `text` move to `out/place/{place_id}.json` (~10–15 KB gzipped each, 554 files on the data branch) fetched when a place is selected or hovered. First paint drops to ~400 KB.
  3. **Then, S3, small:** prefetch the detail files of the places in view (nearest N to the globe centre, re-run on `moveend`), which is the "load where the user is, then more" behaviour; the feed and the top-20 table prefetch their own rows.
  4. **Optional:** copy `out/` into the Pages build at deploy time so the files come from the Pages CDN with `Cache-Control` tuned to the 3 h cadence, instead of raw.githubusercontent's 5 min `max-age=300`.
- **Contract impact:** step 2 changes `contracts.md` §3 (new `place/{id}.json`, slimmer `risk.json` / `trends.json`) and `lib/types.ts`; needs a dated note and S2 + S4 in the same session.

### KI-8 · Open-Meteo on GitHub runners: 7 min for 23 requests, and a shared per-IP quota
- **Seen:** green run 20261114T1423Z: 23 forecast requests took 14:23:38 → 14:30:27 on the runner versus 0.8 s each from a home IP. Earlier the same day a runner IP was banned (429, Retry-After until midnight UTC) before our first request.
- **Checked:** Open-Meteo limits are per IP (10,000 weighted calls/day, 600/min); runner IPs are shared with other projects.
- **Status:** mitigated (past_days=2 incremental, cache reuse under 5.5 h, fail-fast with cache fallback, see contracts note 16:20 PKT). The slow requests suggest minute-level throttling on that IP; hidden behind POWER's 554 s today.
- **Fix sketch (S1, if it recurs):** a paid Open-Meteo key (per-key quota instead of per-IP) or a self-hosted runner. Decide on day 2 only if a run goes red on G2/G3 because of it.

### KI-9 · Forecast can be up to 5.5 h old on a green run
- **Seen:** by design since the quota change: a run reuses the previous forecast when it is under 5.5 h old; `freshness.json` shows the real retrieval time and `, cached run <id>` in the product.
- **Fix sketch:** none needed unless the reviewer wants every run to fetch (`OPENMETEO_MIN_AGE_H=0` in `pipeline.yml`, at ~5,700 calls per IP-day).

### KI-10 · Dashboard loader fails hard on any missing file
- **Seen:** before the first green run the Pages site showed `run.json: HTTP 404` and nothing else.
- **Checked:** `lib/data.ts` `loadAll()` throws on the first non-200; one missing file blanks the whole dashboard.
- **Fix sketch (S4, small):** fetch each file independently, render what arrived, and show a per-file "missing" row in the freshness panel. Matters again whenever the data branch is rebuilt from scratch.

### KI-11 · POWER is now the floor of every run (554 s of a 900 s budget)
- **Seen:** `timings.ingest` 553.7 s on every incremental run; the science stages take ~75 s.
- **Checked:** `POWER_PACE_S = 1.0` with 2 workers is a global one-request-per-second pace, 554 places → 554 s regardless of workers.
- **Fix sketch (S1, small, needs a quota check):** POWER's documented limit is per-minute; test `POWER_PACE_S=0.5` on a manual run (277 s). Required before tier 2 (1,500 places would be 25 min at the current pace, over G1).
- **15 Nov:** with the Pakistan tier (666 places) a tier-due incremental run is ~800 s, ~100 s under the 900 s budget. `G1_INCREMENTAL_MAX_S` raised to 20 min for headroom; the pace stays at 1 s because the POWER team states no fixed limit but throttles for fair use, and the runner IP is shared (the Open-Meteo ban, KI-8). The 0.5 s experiment above is still the real fix for tier 2.

### KI-12 · The honesty ledger only ever shows green runs
- **Seen:** `honesty.json` `runs[]` lists ok=true runs only.
- **Checked:** the data branch is pushed only on success, so a failed run's ledger entry never reaches it; the failed `run.json` is kept as a workflow artifact instead.
- **Fix sketch (S1, small):** push `out/run.json` + `honesty.json` of a failed run to the data branch without touching the other files (a second, narrower push step with `if: failure()`), so the dashboard's honesty panel can show red runs too.

### KI-13 · Data branch grows every run
- **Seen:** `cache/forecast/{run_id}.parquet` (~500 KB) and `cache/published/{run_id}.parquet` (~45 KB) are added per run and never pruned; 8 runs a day ≈ 4.4 MB/day on a 120 MB force-pushed branch.
- **Fix sketch (S1, small):** keep the newest 8 forecast files (the published snapshots are the honesty history and should stay); prune in the ingest stage.

### KI-14 · Globe: no way to show places only, fires only, or both
- **Seen:** the gridded FIRMS dots (KI-1) crowd the places in the burning belts; the reviewer wants a toggle: places / fires / both.
- **Checked:** both are always-on MapLibre layers (`L_PLACES`, `L_FIRE_GLOW`, `L_FIRE_DOT`); there is no visibility state for either in `Dashboard.tsx`, and the legend's "active fire detection (FIRMS)" line is text only.
- **Fix sketch (S3 + S4, small):** one `layers: "both" | "places" | "fires"` state in `Dashboard.tsx` (contracts §5 lists the globe props; this is one additive prop), a three-way segmented control in the controls row next to NOW / NEXT 14 DAYS, and `setLayoutProperty(id, "visibility", …)` on the three layers. Make the legend's fire line the toggle for fires so the two stay together. Default "both".

### KI-15 · Globe: zoom only by scroll wheel; no buttons, nothing for keyboard users
- **Seen:** no zoom-in / zoom-out buttons; keyboard users cannot zoom or pan.
- **Checked:** `Globe.tsx` creates the map with `dragRotate: false` and adds no `NavigationControl`; MapLibre's built-in keyboard handler (`+`/`-`, arrows) only works once the canvas has focus, and nothing makes it focusable or says so.
- **Fix sketch (S3, small):** `map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right")` gives + / − buttons that are real `<button>`s (tab-reachable, with aria-labels); set `tabindex="0"` and an `aria-label` on the canvas container so `+`/`-`/arrows work after a Tab; style the control with the DESIGN.md tokens (the default MapLibre CSS is white). A "reset view" button (home) in the same group is cheap and useful.

### KI-16 · Scheduled pipeline runs are late or missing
- **Seen:** `cron: "0 */3 * * *"`; only one scheduled run so far (13:14Z for the 12:00Z slot, red on G2 before the day-16 fill landed). The 15:00Z slot had not fired by 17:45Z.
- **Checked:** both workflows are `active`; the dispatch path is green (14:23Z). GitHub delays or drops scheduled runs on busy days and for new repositories; nothing in the YAML is wrong.
- **Fix sketch (S1, none unless it persists):** if no scheduled run goes green overnight, dispatch manually before the pitch and add a second cron line offset by 30 min (`30 */3 * * *`) so a dropped slot is covered.

### KI-17 · Globe: the imagery panel is clipped on the right below a 1360 px viewport and always covers part of the map attribution
- **Seen:** with a GIBS layer on, the bottom-centre imagery panel (M-GIBS) loses its right end (the mono date, the "11-14" slider label) once the globe column is narrower than ~800 px; at every width the panel sits on top of MapLibre's attribution box, hiding "NASA GIBS | MapLibre |" until the user's first drag collapses the box to its (i) button.
- **Checked (14 Nov, 18:40 UTC, `docs/handback/m-gibs/ki17-measure.mjs` on `dashboard/out`, `?gibs=rain`):** the panel is `left: max(50% − 20px, 510px)`, `width: min(480px, 62%)`, centred, inside the globe wrapper's `overflow-hidden`. The 510 px floor keeps it ≥ 24 px clear of the legend at every width tried, so the legend/panel overlap the M-GIBS handback first listed does **not** happen; it is the far side that fails:

  | viewport | globe column | panel left–right | clipped on the right | attribution box left |
  |---|---|---|---|---|
  | 1600 | 1040 | 270–750 | 0 px | 606 (expanded box runs under the panel) |
  | 1360 | 800 | 270–750 | 0 px | 366 |
  | 1280 | 720 | 287–733 | 13 px | 286 |
  | 1200 | 640 | 312–708 | 68 px (date cut to "20") | 206 |
  | 1024 | 464 | 366–654 | 190 px | 30 |

  Crops: `docs/handback/m-gibs/ki17-panel-clipped-1200.png`, `ki17-attribution-1600.png`. The attribution box is ~434 px wide while expanded (MapLibre shows the compact control open until the first interaction).
- **Cause:** the floor was chosen for the 1600 px proof viewport, and the attribution control sits in the same corner with no reserved space.
- **Fix sketch (S3, small):** anchor the panel to the right of the legend instead of the centre (`left: 270px; right: 12px; max-width: 480px`) so it shrinks with the column, and move the attribution to `top-right` (`attributionControl` position) or add `padding-bottom` to `.maplibregl-ctrl-bottom-right` so the (i) button and the expanded box clear the panel. Below ~1100 px the aside's 560 px already leaves too little globe; DESIGN §3 fixes the aside width, so that is a non-goal.

### KI-19 · Legend says the ramp stops are "today's" percentiles; they are a 14 Nov snapshot
- **Seen:** the globe legend reads "ramp stops = today's 50 / 80 / 95 / 99th pct" and the hazards table quotes the same stops.
- **Checked:** `lib/palette.ts` `RISK_STOPS` is a constant (0.15 / 0.59 / 0.92 / 0.995) from run 20261114T0949Z, 554 places. The live run 20261115T0417Z has 666 places and a wildfire median of 0.124, so the first stop is above the median and 349 of 666 places sit under it (467 in category-today mode, 554 of 666 in rain next-14). Nothing recomputes the stops.
- **Cause:** the stops were meant as "unusual for the world right now" but were frozen on day one; the legend text was written for a recomputed value.
- **Fix sketch (S2 + S3 / S4, small):** either publish the four percentiles in `risk.json` `meta` and read them in `palette.ts` (chips, table, globe and legend share `RISK_STOPS`, so one place), or change the legend and table wording to "set 14 Nov" and quote the date. The first is honest and cheap if S2 adds four numbers.

## Fixed
- 15 Nov · KI-20 (`ki20-null-driver`, `docs/handback/ki20/male-mv*.png`): `DriverBars` shows "–" for a null wildfire feature value (label and tooltip; the SHAP bar stays), `ShapDriver.value` is typed `number | null`, and `PlacePanel` sits in a new `panels/ErrorBoundary` (keyed by the selected place) whose fallback card reads "This place's details could not be drawn.", so one bad card can no longer blank the page.
- 15 Nov · KI-18 (interim, `ki18-mobile-switch`, `docs/handback/ki18/`): below `lg` (1024 px) a bottom-centre Globe / Panels switch shows one half at a time, globe first (the globe section stays mounted, just invisible; `?view=panels` opens on the panels; a fly-to row pick or alert switches to the globe); the title block and controls wrap at 390 px; ≥ lg unchanged. This is the cheap interim: the full mobile layout (stacked globe + panels, page scroll) is spec §5.5 / L8. Still open on phones: panel tables overflow their width (place name column clipped) and the globe legend card sits under the switch.
- 15 Nov · KI-2 (S3, `s3-ki2`, `docs/handback/ki2-low-mark.md`): places under the risk floor are the low mark, an off-white dot at the world zoom that crossfades into a hollow ring from zoom 2.5 to 4.5; the legend shows the mark as drawn at the current zoom with "low · under 15 %"; the category legend's "low" uses the same mark. Measured on the live 666-place file: a 12 % place's max luminance went from 53 to 248 (of 255) at the world zoom; the 112 Pakistan districts read as separate rings at zoom 4.5. Muted grey now means only "no assessment" / "not significant". Pure paint expressions, nothing added to the load path. The 118 places between the floor and 30 % stay the ramp's dark first stop (luminance ≈ 50–70), now the least visible band on the globe: KI-19's call.
- 15 Nov · KI-1 (S3, `s3-globe`, `docs/handback/ki1-fires.md`): hovering a fire dot shows "N active fire detections · 0.25° cell / max FRP x MW · centre lat lon / observation · VIIRS NOAA-21 · newest <time> UTC"; the legend says "0.25° cells · 1 / 10 / 50 detections · hover for the count" with three sample dots and the source line; dot and glow radius grow with √count (1 → 2.7 px, 174 → 11.2 px at zoom ≥ 5, 0.75 of that at the global zoom). The grid look itself is still the 0.25° binning (contracts §3); finer bins or raw points above a zoom level stay an S1 decision.
- 14 Nov · INTEGRATE d1: KI-7 step 1a (parallel fetch + progress pill), see above.
- 14 Nov · Open-Meteo day 16 null over Europe (21 places): filled from `gfs_seamless` in the ingest; G2 requires 16 days.
- 15 Nov · Open-Meteo day 16 null everywhere before ~06 UTC (run 43660446069, 00:53 UTC, G2 "forecast 0" for 554 places; `gfs_seamless` has no day 16 then either): G2 now requires today .. today + 14, the days the hazards read; day 16 only feeds the nullable `fwi_forecast`.
- 14 Nov · Open-Meteo per-IP quota ban: incremental `past_days=2`, cache reuse, fail-fast with cache fallback.
- 14 Nov · Reused forecast cache not filled: reuse path runs the fill too.
- 14 Nov · Per-place Open-Meteo fetch took 903 s (over G1): batched 25 places per request.
