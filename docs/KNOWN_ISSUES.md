# Known issues

Started 14 Nov 2026, 20:10 PKT, after the first green run (20261114T1423Z). One entry per issue: what is seen, what was checked, the likely cause, who owns the fix, and how big it is. Add to the bottom; strike through or move to "Fixed" when done. Reviewer calls the order.

Owners follow `contracts.md` §1: S1 pipeline/ingest + gates + workflows · S2 science + publish · S3 globe · S4 panels.

## Open

### KI-1 · Globe: the red-outlined dots with a white glow sit on a grid and ignore the mouse
- **Seen:** thousands of small dots with a white centre and red outline, visibly aligned to a grid; hovering does nothing, so they read as fake.
- **Checked:** they are the FIRMS active-fire layer (`fires_24h.json`, legend "active fire detection (FIRMS)"): 35,033 VIIRS NOAA-21 detections from the last 24 h, real satellite data, published as **0.25° bins** (`[lon, lat, count, max_frp]`, centres on the grid, contracts §3), which is why they line up. The globe draws one glow + one dot per bin, radius by count (`globe/Globe.tsx` fire layers), but only the places layer has `mousemove` / `click` handlers; the fire layers have `count` and `frp` properties and no handler at all.
- **Cause:** a deliberate aggregation (binning keeps the file at 170 KB instead of ~2 MB of raw points) with no tooltip and no legend text saying so.
- **Fix sketch (S3, small):** add a hover handler on the fire-dot layer showing "N detections · max FRP x MW · 0.25° cell · VIIRS NOAA-21 · newest HH:MMZ"; say "0.25° cells" in the legend; make the dot radius grow with count more visibly so a 200-detection cell is not the same mark as a single one. If the grid look itself is the objection: S1 can bin finer (0.1°, ~4× the bins) or publish raw points above a zoom level; decide after the tooltip lands.

### KI-2 · Globe: 256 low-risk places render as near-invisible grey dots
- **Seen:** in wildfire mode half the watch list is a 3 px grey dot with no colour.
- **Checked:** live `risk.json` has every place with a probability, a category and a 16-day forecast; none is missing data. Places with wildfire probability under the first ramp stop (15 %, today's median) are drawn as a muted 3 px dot per DESIGN.md §4 (`globe/colour.ts` `RISK_FLOOR`). They are clickable and searchable.
- **Cause:** a design rule, not a data gap; the legend does not say what a grey dot means.
- **Fix sketch (S3, small):** a legible "low (< 15 %)" style and a legend entry, or a "show low-risk places" toggle.

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

### KI-7 · Dashboard first paint waits on ~7.5 MB of JSON
- **Seen:** headless Chromium showed "loading… CONNECTING" for 10–20 s on the Pages site before the tables filled; all nine fetches returned 200.
- **Checked:** `trends.json` 2.7 MB, `series.json` 2.5 MB, `risk.json` 2.2 MB, served from raw.githubusercontent.com (no compression negotiation guaranteed, ~5 min CDN cache).
- **Cause:** every per-place series (120 monthly values × 6 variables × 554 places, 90-day series × 10 arrays × 554) ships on first load.
- **Fix sketch (S2 + S4, medium):** publish `series_long` and the 90-day series as separate per-place or chunked files loaded on selection; keep `trends.json` to slopes/p/labels (~200 KB). Or gzip-serve from Pages by copying `out/` into the build. Day-2 decision.

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

## Fixed
- 14 Nov · Open-Meteo day 16 null over Europe (21 places): filled from `gfs_seamless` in the ingest; G2 requires 16 days.
- 14 Nov · Open-Meteo per-IP quota ban: incremental `past_days=2`, cache reuse, fail-fast with cache fallback.
- 14 Nov · Reused forecast cache not filled: reuse path runs the fill too.
- 14 Nov · Per-place Open-Meteo fetch took 903 s (over G1): batched 25 places per request.
