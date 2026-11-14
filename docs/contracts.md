# contracts.md · the shared interface every session builds against

Written 13 Nov 2026 as preparation. Copied into the new repo as `docs/contracts.md` at 09:00 on day 1 and frozen after the integrator's first review. A session that must change a contract adds a dated note at the bottom and tells the integrator. Nothing else about the repo is fixed; this is.

## 1. Repo layout

```
earth-trend-detective/
  pipeline/                 uv project, Python 3.12
    config.py               constants: PLACE_TIER, radii, thresholds, FIRMS_LIVE_SOURCE
    places/                 build_places.py → data/places.parquet  (S2 owns on day 1 morning)
    ingest/                 firms.py  power.py  openmeteo.py  (S1)
    trend/                  mk.py                                (S2)
    features/               build.py                             (S2)
    hazards/                wildfire.py  drought.py  heat.py  rain.py   (S2)
    publish/                write_json.py  gates.py  feed.py     (S2 writes, S1 wires)
    run.py                  the one entrypoint the cron calls
    data/                   gitignored on main; the data branch holds parquet + json
  dashboard/                Next.js 16, app router, Tailwind v4, MapLibre, d3
    src/lib/                types.ts  palette.ts  format.ts  useSize.ts  data.ts (fetch + cache-buster)
    src/components/globe/   Globe.tsx  Legend.tsx  Search.tsx          (S3)
    src/components/panels/  TrendsTable  HazardsTable  PlacePanel  HazardCard  Feed  Freshness  Sources  (S4)
    src/components/charts/  TrendChart  AnomalySeries  DriverBars  Sparkline  (S4)
    public/data/            mock JSON for local dev, same filenames as the data branch
  .github/workflows/
    pipeline.yml            cron "0 */3 * * *" + workflow_dispatch; runs pipeline/run.py; pushes data branch; triggers deploy
    deploy.yml              builds the dashboard with NEXT_PUBLIC_DATA_URL and publishes to Pages
  docs/                     PRD.md  DESIGN.md  contracts.md  prep.md
```

Secrets in GitHub: `FIRMS_MAP_KEY`, `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD`. Locally the same names in `pipeline/.env`, gitignored.

Data branch: orphan branch `data`, force-pushed each run, containing `cache/*.parquet` and `out/*.json`. The dashboard reads `https://raw.githubusercontent.com/<org>/<repo>/data/out/<file>?v=<run_id>`.

## 2. Identifiers and conventions

- `place_id`: string, lowercase ASCII slug plus ISO country, e.g. `lahore-pk`, `san-francisco-us`. Stable forever. Index into every per-place array is by position in `places.json`, and every other file carries the same order.
- Dates: `YYYY-MM-DD`, UTC. Timestamps: ISO 8601 with `Z`.
- Numbers: probabilities 0 to 1 with 3 decimals; slopes as floats in the unit stated; counts as integers; `null` for missing, never `-999` or `NaN`.
- Hazard keys, fixed order everywhere: `wildfire`, `drought`, `heat`, `rain`.
- Variable keys, fixed order everywhere: `rain_mm`, `tmax_c`, `rh_pct`, `wind_ms`, `soil_wet`, `fires` (+ `ndvi` if the stretch lands).
- Kind labels, exactly these four strings: `observation`, `forecast`, `risk_assessment`, `trend`.
- Confidence: `"high" | "medium" | "low"`. Category: `"low" | "elevated" | "high" | "extreme"`.

## 3. Files the pipeline publishes

All files carry `meta.run_id`, `meta.generated_at`, `meta.tier`. `run_id` is `YYYYMMDDTHHMMZ`.

### `places.json`
```json
{ "meta": {...},
  "places": [ { "id": "lahore-pk", "name": "Lahore", "country": "PK", "continent": "Asia",
                "lat": 31.55, "lon": 74.35, "pop": 11126285, "radius_km": 50, "capital": false } ] }
```

### `trends.json`
```json
{ "meta": {...},
  "variables": ["rain_mm","tmax_c","rh_pct","wind_ms","soil_wet","fires"],
  "units":     ["mm/yr","°C/yr","pct/yr","m/s/yr","frac/yr","det/yr"],
  "long":  { "window": "10y", "slope": [[...per variable...] per place], "p": [[...]], "label": [[...]] },
  "short": { "window": "90d", "slope": [[...]], "p": [[...]], "label": [[...]] },
  "series_long":  [ [ [monthly mean, 120 values] per variable ] per place ],
  "months": ["2016-11", ...] }
```
`label` is one of `"rising"`, `"falling"`, `"stable"`, `"insufficient"`; significance is `p < 0.05`. Slope is Sen's slope in the stated unit.

### `risk.json`
```json
{ "meta": {...},
  "hazards": ["wildfire","drought","heat","rain"],
  "valid_from": "2026-11-14", "valid_to": "2026-11-28",
  "now": [ { "wildfire": {"p": 0.182, "severity": 0.61, "exposure": 11126285, "confidence": "medium", "category": "elevated"},
             "drought":  {"index": -1.4, "severity": 0.55, "exposure": 11126285, "confidence": "high", "category": "high"},
             "heat":     {"days_above": 3, "severity": 2.1, "exposure": 11126285, "confidence": "high", "category": "elevated"},
             "rain":     {"p": 0.04, "severity": 12.0, "exposure": 11126285, "confidence": "high", "category": "low"} } per place ],
  "history_days": ["2026-08-16", ..., "2026-11-13"],
  "history": { "wildfire": [[90 values] per place], "drought": [[...]], "heat": [[...]], "rain": [[...]] },
  "forecast_days": ["2026-11-14", ..., "2026-11-29"],
  "fwi_forecast": [[16 values] per place],
  "drivers": [ { "wildfire": [ {"feature": "rain_anom_30d", "label": "30-day rainfall anomaly", "shap": -0.42, "value": -1.3} ×5 ],
                 "drought": [ {"reason": "90-day rainfall 48% below normal"} ... ], "heat": [...], "rain": [...] } per place ],
  "text": [ { "wildfire": "...", "drought": "...", "heat": "...", "rain": "..." } per place ],
  "model": { "name": "xgb_wildfire", "version": "2026-11-14T10:00Z", "pr_auc": 0.31, "baseline_pr_auc": 0.19, "brier": 0.041, "holdout": ["2026-10-02","2026-11-13"] } }
```
`severity` units by hazard: wildfire = forecast fire weather index 0–1; drought = deficit depth as a fraction of normal; heat = °C above the place's 95th percentile; rain = mm above the place's 95th-percentile week. `category` thresholds live in `config.py` and are quoted in the legend.

### `series.json`
```json
{ "meta": {...}, "days": ["2026-08-16", ...],
  "rain_30d": [[...] per place], "rain_30d_norm": [[...]], "rain_30d_sd": [[...]],
  "tmax": [[...]], "tmax_norm": [[...]], "tmax_sd": [[...]],
  "soil_wet": [[...]], "soil_wet_norm": [[...]], "soil_wet_sd": [[...]],
  "fires_7d": [[...]] }
```
90 days per place. Normal and sd are the place's own 10-year climatology for that calendar window.

### `fires_24h.json`
```json
{ "meta": {...}, "source": "VIIRS_NOAA21_NRT", "newest_acq": "2026-11-13T15:30Z",
  "bins": [ [lon, lat, count, max_frp] ... ] }
```
0.25° bins, global. Lon and lat are bin centres.

### `feed.json`
```json
{ "meta": {...},
  "alerts": [ { "id": "20261113T1500Z-lahore-pk-wildfire", "hazard": "wildfire", "place": 17, "place_id": "lahore-pk",
                "issued_at": "2026-11-13T15:00Z", "valid_from": "2026-11-13", "valid_to": "2026-11-27",
                "trigger": "category_up" | "z_above_2" | "new_anomaly",
                "probability": 0.41, "severity": 0.7, "exposure": 11126285, "confidence": "medium", "category": "high",
                "evidence": ["power:2026-11-10", "firms:2026-11-13T15:00Z", "openmeteo:2026-11-13T12:00Z"],
                "anomalies": ["rain", "soil"], "explanation": "...", "status": "active",
                "model_version": "2026-11-14T10:00Z" } ] }
```
Newest first, max 50. Status is `active`, `updated`, `expired`.

### `freshness.json`
```json
{ "meta": {...},
  "sources": [ { "name": "NASA FIRMS", "kind": "observation", "product": "VIIRS_NOAA21_NRT",
                 "valid_for": "2026-11-13T15:30Z", "retrieved_at": "2026-11-13T18:02Z", "records": 48211,
                 "latency_doc": "~3 h", "status": "ok" | "stale" | "missing", "url": "https://firms.modaps.eosdis.nasa.gov/" } ... ] }
```
One row each for FIRMS, POWER, Open-Meteo, GIBS, Natural Earth.

### `honesty.json`
```json
{ "meta": {...}, "mode": "hindcast" | "published",
  "window": ["2026-10-02","2026-11-13"],
  "buckets": [ {"lo": 0.0, "hi": 0.05, "n": 1203, "pred": 0.021, "obs": 0.018} ... ],
  "top20_hit_rate": 0.45, "baseline_top20_hit_rate": 0.25,
  "runs": [ {"run_id": "...", "ok": true, "failed_gate": null, "duration_s": 412} ×10 ] }
```

### `run.json`
```json
{ "run_id": "20261114T1000Z", "tier": 1, "n_places": 612, "started": "...", "finished": "...", "duration_s": 2310,
  "gates": { "G1_time": {"value": 2310, "pass": true}, "G2_coverage": {"value": 0.995, "pass": true}, ... "G7_deploy": {"value": null, "pass": null} },
  "ok": true, "metrics": { "pr_auc": 0.31, "baseline_pr_auc": 0.19, "brier": 0.041 } }
```

## 4. Pipeline internals that two sessions touch

- `data/cache/power/{place_id}.parquet`: columns `date, t2m, t2m_max, rain_mm, rh_pct, wind_ms, soil_root, soil_top`. S1 writes, S2 reads.
- `data/cache/firms/{YYYY-MM-DD}.parquet`: raw detections for that acquisition date, columns `lat, lon, acq_time, frp, confidence, daynight, type, source`. S1 writes.
- `data/cache/firms_counts.parquet`: `place_id, date, n, frp_sum` after the KD-tree join. S1 writes, S2 reads.
- `data/cache/forecast/{run_id}.parquet`: `place_id, date, tmax, rain_mm, rh_min, wind_max, et0`. S1 writes, S2 reads.
- `data/features.parquet`: one row per place per day, every feature column plus `label`, `label_valid`, `split`. S2 only.
- `config.py` constants both sides import: `PLACE_TIER`, `RADIUS_KM = 50`, `LABEL_MIN_DETECTIONS = 3`, `HORIZON_DAYS = 14`, `FIRMS_LIVE_SOURCE`, `FIRMS_COUNT_SOURCE = "MODIS_NRT"`, `FIRMS_HISTORY_SOURCE = "MODIS_SP"`, `FIRMS_WORLD_MAX_DAYS = 5`, `POWER_PACE_S = 1.0`, category thresholds per hazard.

## 5. Dashboard internals that two sessions touch

- `src/lib/types.ts` mirrors §3 exactly. S4 writes it in the first 30 minutes from this file; S3 imports it.
- `src/lib/data.ts` exports `loadAll(): Promise<Data>` that fetches every file with `?v=` cache-buster, from `NEXT_PUBLIC_DATA_URL` or `/data/` locally.
- App state lives in one `Dashboard.tsx` **(S4)**: `mode: "now" | "next14"`, `hazard`, `trendVar`, `selected: number | null`, `continent`, `flyTo`. Globe receives props and an `onSelect`; it never owns state.
- Globe exposes exactly: `<Globe places risk trends fires mode hazard trendVar selected onSelect flyTo gibsLayer gibsDate />`.
- Tokens and chart rules: DESIGN.md. No new colours.

## 6. Session rules

1. Read PRD.md §7–§9, DESIGN.md, and this file before writing anything.
2. Work on your branch, in your directories. Touching another session's directory needs a note here.
3. `uv run ruff check` and `npm run lint && npm run build` pass before every handback.
4. Handback = what works, proof (JSON sample or screenshot path), what is not done, any contract note.
5. Mock data first. `dashboard/public/data/*.json` with 20 places exists before the globe or a table is started.

## Change log
- 2026-11-13 · initial.
- 2026-11-14 08:40 · S0: FIRMS_LIVE_SOURCE = VIIRS_NOAA21_NRT (SNPP NRT ended 2 Nov 2026). FIRMS `world/N` counts days from today UTC, so live pulls use `world/2` filtered to the last 24 h, never `world/1`. Places: 554 at tier 1.
- 2026-11-14 09:20 · S1: additive cache columns. `firms/{date}.parquet` also carries `acq_date` and `satellite` (needed for the cross-run dedupe key); `type` is null for MODIS_NRT rows (NRT CSV has no `type`), and such rows count as vegetation fires. New file `cache/firms_live.parquet` (same columns) holds the last-24 h rows of `FIRMS_LIVE_SOURCE` + `MODIS_NRT` for `fires_24h.json`. `firms_counts.parquet` is dense (every place × every cached date, `n = 0` where none). `firms/_history.json` records fetched history chunks and travels with the data branch, as does `data/places.parquet`. Forecast `wind_max` is m/s at 10 m (POWER `wind_ms` is 2 m). FIRMS MAP_KEY quota is 5,000 *transactions* per rolling 10 min and one world chunk costs ~200, so the one-time history self-paces (~45 min cold).
- 2026-11-14 10:35 · S1: `forecast/{run_id}.parquet` additionally carries `rh_mean` (relative_humidity_2m_mean, %) and `wind_mean` (wind_speed_10m_mean, m/s). POWER's RH2M and WS2M are daily means, so the perfect-prognosis training features are means; S2 should prefer `rh_mean`/`wind_mean` over `rh_min`/`wind_max` for the forecast slots. `rh_min`/`wind_max` stay for fire-weather severity. Lands on the next pipeline run; the cold-run parquet lacks the two columns.
- 2026-11-14 13:20 · S1: forecast/{run_id}.parquet also carries Open-Meteo past_days=92: rows per place are ~108 (92 before today + 16 forecast), same columns, no "future only" filter. The API populates only ~66 of the 92 past days; the oldest ~26 rows per place come back with every value null and are kept as returned. Consumers must select dates >= today for the forecast and drop all-null rows (S2's feature builder does both). Lands on the next pipeline run; the cold-run parquet has 16 rows per place.
- 2026-11-14 15:10 · S4: no schema change. `RISK_STOPS` in `lib/palette.ts` set per DESIGN.md §2 to the first scoring run's 50 / 80 / 95 / 99th percentiles of wildfire p: 0.15 / 0.59 / 0.92 / 0.995 (run 20261114T0949Z). Follows S2-B's 10:05 note raising `CATEGORY_THRESHOLDS["wildfire"]` to 0.30 / 0.60 / 0.90. Convention for the two `CATEGORY_V` copies (`globe/colour.ts`, `charts/ramp.ts`): each category sits at the probability where it starts, so low 0.03 (muted), elevated 0.30, high 0.60, extreme 0.90. S4's copy and the table / card / feed legends are updated on `s4-panels`; S3's copy and the globe legend labels still need the same change.
