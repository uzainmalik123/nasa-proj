# Earth System Trend Detective — build preparation

> **Scope update, 13 Nov evening:** this brief was written for a regional,
> gridded, multi-year design. The product is now **global, live, and
> point-based**. `PRD.md` and `DESIGN.md` are the source of truth for scope,
> data sources, and features. Keep using this file for the API details in
> section 3, the checklist in section 4, and the gotchas in section 9.
> Section 5's region row and anything about 0.25° cells or a 5-year
> backtest is superseded.

Written 13 Nov 2026, the day before the build. Read all of it once. Section 4
is the checklist for tonight; section 7 is the plan for tomorrow.

---

## 1. What we are building, and the one-line story

A tool that watches how rainfall deficit, rising land temperature and drying
vegetation move together across a region, scores every 0.25° cell every week
with a wildfire risk for the next two weeks, flags cells that have broken away
from their own normal, explains why in a sentence, and shows it all on a globe
with a replayable alert feed.

**The story for judges:** Earth systems are connected. A dry spell is not a
fire, but a dry spell *plus* a heat anomaly *plus* browning vegetation is a
fire waiting for a spark. We detect that chain forming weeks ahead, cell by
cell, from four NASA datasets, and we explain each alert in plain language.
Everything is reproducible from raw NASA files and runs on free infrastructure
with no server.

What the spike already proved (synthetic data, 11 Nov): XGBoost on this
feature table beats a calendar-only model (PR-AUC 0.239 vs 0.187, ROC 0.687 vs
0.631) and SHAP ranks rainfall, temperature anomaly and NDVI change as the top
drivers. The dashboard works end to end. Tomorrow is about replacing the
synthetic generator with real ingest and keeping everything downstream intact.

---

## 2. The system, stage by stage

Each stage: what it does, why it exists, input → output, what breaks, and what
the spike taught us.

### 2.1 Ingest (`pipeline/ingest_*.py`, to be written)

**What:** Pull raw files from four NASA sources and save them untouched under
`pipeline/data/raw/<source>/`. Never modify a raw file. Never delete one.

**Why:** Raw files are the replayable source of truth. If cleaning logic
changes, we re-run from raw without re-downloading. Judges like "we can
reproduce every number from the original NASA bytes".

**Output:** CSV (FIRMS), NetCDF4 (IMERG, MODIS). One file per request window.

**What breaks:** credentials (see §4), rate limits, the slow network here
(~250 KB/s measured). Keep requests small and resumable: skip a window if its
file already exists.

### 2.2 Clean (`pipeline/clean.py`)

**What:**
- FIRMS: drop detections outside the region; drop low confidence (MODIS
  `confidence < 30`; VIIRS keep `n` and `h`, drop `l`); drop `type != 0` on
  MODIS (volcano, static source, offshore); de-duplicate on
  (lat, lon, acq_date, acq_time, satellite).
- IMERG: mask fill values (−9999.9), keep `precipitation` in mm/day.
- MODIS NDVI: apply scale 0.0001; keep only `pixel_reliability` ∈ {0, 1}
  (good, marginal). Everything else → NaN (cloud, snow, fill).
- MODIS LST: apply scale 0.02 (Kelvin), convert to °C; keep only pixels where
  `QC_Day` bits 0–1 == 0 (good quality). Else NaN.
- Reject any file with a broken schema (missing column/variable) or an empty
  day, and write a line to `data/quality_log.jsonl`. These become the
  "data-quality alerts" in the dashboard.

**Why:** FIRMS mixes sensors with different confidence encodings; MODIS
composites contain cloud-contaminated pixels that look like "vegetation
collapsed"; a silently empty day would read as "no rain".

**What the spike taught us:** nothing downstream cares about the source
as long as `panel.parquet` has the nine columns in §2.3.

### 2.3 Regrid and aggregate (`pipeline/regrid.py`)

**What:** Put everything on one grid (0.25°, cell centres at x.125, x.375,
x.625, x.875) and one time step (Monday-anchored weeks). Output
`data/raw/panel.parquet` with exactly:

| column | from | how |
|---|---|---|
| `cell_id`, `lat`, `lon` | grid | integer id, cell centre |
| `week` | calendar | Monday date |
| `rain_mm` | IMERG | mean mm/day over the cell × 7 → weekly total |
| `lst_c` | MOD11 | cell mean of good pixels, 8-day → weekly by linear interpolation in time |
| `ndvi` | MOD13 | cell mean of good pixels, 16-day → weekly by linear interpolation |
| `fire_count` | FIRMS | detections whose point falls in the cell during the week |
| `fire_frp` | FIRMS | sum of `frp` (MW) for those detections |

**Why 0.25° and weekly:** coarse enough that MODIS cloud gaps average out and
the table stays ~700k rows for 5 years; fine enough that risk maps look
spatial. It is also what the spike used, so the model code runs unchanged.

**Regrid mechanics:**
- FIRMS points: `floor((lat - lat_min) / 0.25)` → cell index. Trivial.
- IMERG 0.1°: 2.5 IMERG pixels per cell edge, so not an integer coarsen. Use
  `groupby_bins` on lat and lon with the 0.25° edges, then mean.
- MODIS from AppEEARS in geographic projection: pixel ≈ 0.0083° (1 km) or
  exactly 0.05° (CMG products). Same `groupby_bins` approach, or
  `coarsen(lat=5, lon=5)` if we get the 0.05° products (see §3.3).
- Time: MODIS composites carry a start date. Assign to the week containing
  it, then `interpolate_na` along time per cell, then forward-fill at the end.
- Cloud fraction per cell-week (share of NaN pixels) is worth keeping as a
  quality column; the dashboard can grey out cells with > 80% cloud.

### 2.4 Feature table (`pipeline/features.py`, exists)

**What:** one row per cell-week with 19 features and the label
`fire in the next 2 weeks`. Already written and tested on the spike.

Features: rainfall 1/4/12-week sums; 4-week rainfall anomaly (z-score vs the
cell's own climatology for that week-of-year, computed from training years
only); rainfall as % of normal; LST and its anomaly; NDVI, its anomaly and
4-week change; fire count/FRP in the previous 4 weeks; weeks since last fire;
season (sin/cos of week-of-year); lat/lon; long-run annual rainfall and NDVI.

**Why climatology from training years only:** the test year must not define
its own "normal". That is the leakage judges will probe.

**Anomaly flags:** `rain_anom_4w < −1.5`, `lst_anom > 1.5`, `ndvi_anom < −1.5`.
These are the "breakout from normal" detector. See §6 for the trend-test
upgrade.

**Real-data risk:** 5 years is a thin climatology. If anomalies look noisy,
widen to 2016+ for IMERG/MODIS (they go back further) even if FIRMS only
needs 5 years. Climatology does not need the label.

### 2.5 Train (`pipeline/train.py`, exists)

**What:** XGBoost classifier, time-based split (older years train, most
recent year test), early stopping on the last 10% of training weeks, a
season-only baseline for comparison, test metrics, SHAP global ranking.
Exports `model.json`.

**Why a time split and a baseline:** a random split leaks neighbouring weeks
and inflates scores; a baseline proves the Earth-system features matter.
These two things are the difference between "we trained a model" and "we
showed the model learned the physics".

**Headline metric:** PR-AUC, with the positive rate next to it. ROC-AUC looks
flattering on imbalanced data. Also report precision in the top 5% of cells,
which is what an operator would act on.

**Spike lesson:** the test year was a harsher drought than any training year
and the model under-predicted it. Expect the same with 2025/2026 real data.
Say it out loud in the pitch; it is a strength ("calibrated, honest, and here
is the drift").

### 2.6 Explain (SHAP in `train.py` and `predict.py`, exists)

Global mean |SHAP| for the "what drives risk" bars; per-alert SHAP values for
the "why this alert" bars and for the LLM prompt.

### 2.7 Predict (`pipeline/predict.py`, exists)

**What:** load `model.json`, score every cell-week of the latest period,
pick alerts (risk ≥ threshold, plus a z-score of that cell's own risk
history), attach top-5 SHAP drivers, build the explanation text, and write
`dashboard/public/data/predictions.json` (~1 MB) and `series.json` (~4.5 MB).

**Alert threshold:** on the spike, probabilities rarely exceeded 0.5, so the
threshold is 0.35. On real data, choose it as a quantile (e.g. top 2% of
cell-weeks) rather than a fixed probability; that is robust to recalibration.

**Scheduled job:** a GitHub Actions workflow runs ingest → clean → regrid →
features → predict weekly and commits the JSON. No server. Write the workflow
file tomorrow afternoon once the pipeline runs locally; it is ~30 lines.

### 2.8 Explanation layer (LLM)

`explain_text()` in `predict.py` is currently a template. Swap for an LLM
call that receives the cell's numbers and SHAP drivers and returns one
sentence. Keep the template as a fallback so the demo never blocks on an API.
Cache results by alert id.

### 2.9 Dashboard (`dashboard/`, exists)

Next.js 16 + MapLibre globe + d3 charts, static, reads the two JSON files.
Panels: globe risk heatmap with time slider and play; FIRMS detections
overlay; KPI tiles; live alert feed (replayed); per-cell anomaly series with
normal band; SHAP bars; lead-lag chart; backtest with calibration table;
seasonal calendar. Click an alert → fly to cell. Click a cell → its series.

Two things to add tomorrow if time allows: a data-quality feed card reading
`quality_log.jsonl`, and a region picker if we run more than one region.

---

## 3. The four data sources, exactly

All need a free Earthdata Login except FIRMS, which needs its own MAP_KEY.

### 3.1 FIRMS — active fire detections

- **API:** `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{W},{S},{E},{N}/{DAYS}/{YYYY-MM-DD}`
  - `DAYS` is 1–10. `DATE` is the start date. Omit date for the latest.
  - Region: `-124.5,32,-114,46`.
- **Sources:** archive is `MODIS_SP`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`
  (standard processing, lags a couple of months). Recent weeks are only in
  `MODIS_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`. The backfill must pull SP
  for history and NRT for the tail, then de-duplicate the overlap.
- **Columns:** `latitude, longitude, brightness (MODIS) / bright_ti4 (VIIRS),
  scan, track, acq_date, acq_time, satellite, instrument, confidence,
  version, bright_t31 / bright_ti5, frp, daynight, type (MODIS only)`.
- **Confidence:** MODIS 0–100 integer. VIIRS `l`/`n`/`h`. Handle both.
- **Limits:** 5000 transactions per 10 minutes; a 10-day query counts as
  several. 5 years × 3 sources ≈ 550 requests. Fine, but sleep 0.5 s between
  calls. Check your key's status at
  `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=...`.
- **Decision:** use VIIRS (375 m, more detections) as the primary label
  source and MODIS as a secondary count. Or merge all three. Merging is
  simplest: a cell-week has fire if any sensor saw one.

### 3.2 GPM IMERG — rainfall

- **Products:** `GPM_3IMERGDL` V07 (Late run, ~14 h latency) and
  `GPM_3IMERGDF` V07 (Final run, months of latency). **Use Late for
  everything** so training and live scoring see the same product.
- **Format:** one NetCDF4 per day, global 0.1°, variable `precipitation` in
  mm/day, float32, fill −9999.9. Dimension order in V07 files is
  `(time, lon, lat)`, not `(time, lat, lon)`. Check on the first file and
  transpose.
- **Access, preferred:** OPeNDAP subsetting so we only pull our bounding box.
  Pattern:
  `https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDL.07/YYYY/MM/3B-DAY-L.MS.MRG.3IMERG.YYYYMMDD-S000000-E235959.V07B.nc4`
  opened with `xarray.open_dataset(url, engine="pydap")` after `earthaccess.login()`,
  then `.sel(lon=slice(-124.5, -114), lat=slice(32, 46))`. Our box is ~105 ×
  140 pixels × 4 bytes ≈ 60 KB per day instead of ~8 MB. Over 5 years that is
  the difference between 100 MB and 15 GB on this network.
- **Access, fallback:** Earthdata Search → GPM_3IMERGDL → "Customize" →
  spatial subset + date range → download the links list → `wget` with
  `.netrc`. Or `earthaccess.search_data(short_name="GPM_3IMERGDL",
  version="07", temporal=(...), bounding_box=(...))` then `earthaccess.download`
  (full files, slow here).
- **Gotcha:** GES DISC requires approving the "NASA GESDISC DATA ARCHIVE"
  application in your Earthdata profile or every download is a 401. Do it
  tonight (§4).

### 3.3 MODIS NDVI and LST via AppEEARS

- **Base URL:** `https://appeears.earthdatacloud.nasa.gov/api/`
- **Flow:** `POST /login` with Earthdata basic auth → bearer token.
  `POST /task` with the JSON below → task id. `GET /task/{id}` until
  `status == "done"`. `GET /bundle/{id}` → file list. `GET /bundle/{id}/{file_id}`
  streams each file. Tasks take minutes to hours; **submit the tasks tonight
  or first thing tomorrow** so they are ready when the regrid code is.
- **Task JSON (area request):**
  ```json
  {
    "task_type": "area",
    "task_name": "ca_or_ndvi_lst",
    "params": {
      "dates": [{"startDate": "01-01-2021", "endDate": "11-13-2026"}],
      "layers": [
        {"product": "MOD13A2.061", "layer": "_1_km_16_days_NDVI"},
        {"product": "MOD13A2.061", "layer": "_1_km_16_days_pixel_reliability"},
        {"product": "MOD11A2.061", "layer": "LST_Day_1km"},
        {"product": "MOD11A2.061", "layer": "QC_Day"}
      ],
      "output": {"format": {"type": "netcdf4"}, "projection": "geographic"},
      "geo": { "type": "FeatureCollection", "features": [{ "type": "Feature",
               "properties": {}, "geometry": { "type": "Polygon", "coordinates":
               [[[-124.5,32],[-114,32],[-114,46],[-124.5,46],[-124.5,32]]] } }] }
    }
  }
  ```
  Dates are `MM-DD-YYYY`. Output "geographic" means a lat/lon grid, which is
  what we want for regridding.
- **Size trade-off:** 1 km products over CA+OR for 6 years is on the order of
  1–2 GB, which is an hour-plus on this network. **First check whether
  AppEEARS lists the 0.05° climate-modelling-grid products `MOD13C1.061`
  (NDVI, 16-day) and `MOD11C2.061` (LST, 8-day).** If it does, use them: same
  science, ~50× smaller, and 0.05° → 0.25° is an exact `coarsen(5)`. If not,
  fall back to MOD13A2/MOD11A2 and request fewer years (2022+) for the first
  pass.
- **NDVI layer details:** scale 0.0001, valid −2000..10000, fill −3000.
  `pixel_reliability`: 0 good, 1 marginal, 2 snow/ice, 3 cloudy, −1 fill.
- **LST layer details:** scale 0.02, units Kelvin, fill 0. `QC_Day` bits 0–1:
  0 good, 1 other quality, 2 not produced (cloud), 3 not produced (other).
  Mask to bits 0–1 == 0. Use **Day** LST; night is a separate layer and we do
  not need it.
- **Terra vs Aqua:** MOD = Terra, MYD = Aqua. Terra is fine; Aqua has had
  orbit drift in recent years.
- **Reference notebook:** `nasa/appeears-data-resources` on GitHub,
  `AppEEARS_API_Area.ipynb`. Copy its request/poll/download cells.

### 3.4 Resources from the challenge page, triaged

| resource | verdict | use |
|---|---|---|
| AppEEARS | **core** | NDVI + LST, §3.3 |
| Giovanni | convenience | quick regional IMERG time-series plot for the pitch; sanity check that our weekly sums look like theirs |
| Hydrology Time Series (Data Rods) | optional | NLDAS/GLDAS soil moisture at a few points as validation or a bonus feature |
| Climate Data Online (NOAA) | skip | station data; only for ground-truthing |
| KNMI Climate Explorer | optional | 20+ year gridded rainfall if 5-year climatology is too thin |
| Trend-test articles | **use** | Mann-Kendall + Sen's slope per cell, §6 |
| CSA (RCM SAR, SWOT, Geo.ca) | skip | radar and surface water, outside scope; only if a Canadian region is added |

---

## 4. Tonight's checklist

Do these before sleeping. Each is a blocker tomorrow.

1. **Earthdata Login** at `https://urs.earthdata.nasa.gov`. One account is
   enough for the team if we share a `.netrc`, but two is safer.
2. In the Earthdata profile → *Applications* → *Approved Applications* →
   *Approve more applications*: approve **"NASA GESDISC DATA ARCHIVE"** and
   accept its EULA. Also approve **"LP DAAC Data Pool"** and
   **"AppEEARS"** if they appear. Without the GES DISC one, IMERG is 401.
3. **FIRMS MAP_KEY** at `https://firms.modaps.eosdis.nasa.gov/api/map_key/`.
   Arrives by email in minutes. Confirm with the status URL in §3.1.
4. Create `~/.netrc` (mode 600):
   ```
   machine urs.earthdata.nasa.gov login YOUR_USER password YOUR_PASS
   ```
   and `pipeline/.env` with `FIRMS_MAP_KEY=...`. Both are gitignored
   (`.env*` already is).
5. Install the extra Python deps now, on this slow network:
   `cd pipeline && uv add earthaccess xarray netcdf4 pydap requests pymannkendall python-dotenv`.
6. **Smoke test each source with one request** (no pipeline code yet):
   - FIRMS: one 10-day CSV for the region. Count rows.
   - IMERG: open one day via OPeNDAP, print `ds.precipitation.dims` and the
     bbox slice shape.
   - AppEEARS: `POST /login`, then `GET /product` and grep for `MOD13C1`,
     `MOD11C2`, `MOD13A2`, `MOD11A2`. Decide 1 km vs CMG on the spot.
7. **Submit the AppEEARS task(s)** for the chosen products and full date
   range so they process overnight.
8. Write down the three decisions in §5 and agree them as a team.
9. Make sure everyone can run the spike: `pipeline/run.sh` then `npm run dev`.

---

## 5. Decisions to lock

| decision | recommendation | why |
|---|---|---|
| Region | ~~California + Oregon~~ **Superseded: global, ~600 named places, see PRD.md §7.1** | the spike used a region to validate the method; the product watches the whole Earth |
| Time range | 2021-01-01 → now for FIRMS and the label; 2016+ for IMERG/MODIS climatology if cheap | 5 years of labels is enough; a longer climatology makes anomalies cleaner |
| Grid and step | 0.25°, Monday weeks | unchanged from spike; everything downstream assumes it |
| Label | any detection (merged sensors) in the cell in weeks t+1..t+2 | simple, defensible, matches "risk weeks later" |
| Train/test split | train ≤ 2024-12, test 2025-01 → latest | a full real fire season held out |
| Alert threshold | top 2% of cell-weeks by risk, plus risk z-score > 1.5 vs the cell's history | robust to calibration, surfaces "new" risk not chronic risk |
| Primary metric | PR-AUC with positive rate; precision@top5% | honest on imbalance, operator-relevant |

---

## 6. Upgrades worth doing tomorrow, in priority order

1. **Mann-Kendall trend test per cell** (`pymannkendall`). For each cell, run
   it on the last 12 weeks of NDVI and of rainfall anomaly. Output trend
   direction, Sen's slope and p-value. Show "significant drying trend (p <
   0.05)" as a tag on alerts and as a globe layer. This is the "trend
   detective" part of the challenge name and it is cheap.
2. **Data-quality feed** card in the dashboard reading `quality_log.jsonl`
   (rejected files, empty days, cloud-heavy weeks). Shows the pipeline is
   honest about gaps.
3. **LLM explanations** with template fallback and caching.
4. **GitHub Actions weekly workflow.** Needs secrets for Earthdata and FIRMS.
5. **Quantile-based alert threshold** instead of the fixed 0.35.
6. Only if everything else is done: a second region (e.g. south-east
   Australia or British Columbia) to show the pipeline is region-agnostic.

---

## 7. Plan for the 48 hours

Assumes a team of 3–4. Names to be filled in.

**Day 1 morning (0–4 h): data in.**
- A: FIRMS backfill script (SP for history, NRT for tail), save raw CSVs,
  clean, points → cell-week counts. This is the fastest source; have it
  producing `fire_count` by hour 2.
- B: IMERG OPeNDAP loop, one file per day, bbox-sliced, save as one NetCDF
  per month under raw, then weekly sums per cell.
- C: AppEEARS download of the overnight task; open NetCDF, apply QA masks,
  regrid, interpolate to weekly.
- D (or whoever is free): dashboard polish, data-quality card, LLM call stub.

**Day 1 afternoon (4–10 h): first real run.**
- Assemble `panel.parquet` from the three sources. Run `features.py`,
  `train.py`, `predict.py` unchanged. Look at the numbers. Expect something
  to be wrong (units, dimension order, week alignment). Fix, rerun.
- Checkpoint by hour 8: a real risk map on the globe, whatever the metrics.

**Day 1 evening (10–16 h): make it good.**
- Tune nothing in the model. Fix data instead: cloud masks, label merging,
  climatology length.
- Mann-Kendall layer. Alert threshold as quantile. LLM explanations.
- Commit. Deploy the dashboard to Vercel or Cloudflare Pages (static export
  works; the JSON ships with it).

**Day 2 morning (16–22 h): automation and backtest story.**
- GitHub Actions workflow, run it once manually.
- Backtest narrative: pick two or three real 2025 fires and show the risk
  rising weeks earlier on their cells. Screenshot them for the slides.
- Freeze the data. No more pipeline changes after hour 22.

**Day 2 afternoon (22–28 h): pitch.**
- Slides: problem (1), the chain (1), data (1), pipeline (1), results with
  the baseline comparison (1), demo (live, 90 s), honesty slide (drift,
  limits, what we'd do next) (1).
- Rehearse the demo three times on the deployed URL, not localhost.

---

## 8. Risks and fallbacks

| risk | fallback |
|---|---|
| AppEEARS queue slow / task fails | request fewer years (2022+) or CMG products; worst case run the spike's synthetic NDVI/LST with real rain and fire, clearly labelled |
| IMERG OPeNDAP auth trouble | Earthdata Search subsetter links + wget; or Giovanni manual NetCDF export for the region |
| FIRMS rate limit | sleep between calls; use VIIRS SNPP only |
| Network too slow for anything | everything is bbox-subset already; prioritise FIRMS + IMERG (small) and accept coarser MODIS |
| Model metrics look bad on real data | it is still a working system; show the baseline comparison and the anomaly layer; be honest. Judges reward process. |
| Dashboard breaks on real JSON | the JSON schema is unchanged; if a panel breaks, hide that card, don't debug it on stage |
| Laptop dies before demo | deploy early; demo from the URL |

---

## 9. Gotchas collected so far

- MapLibre's worker must be served from `public/` under Next (done).
- MapLibre's CSS overrides Tailwind positioning on the map container (done).
- `xgboost-cpu`, not `xgboost`, to avoid a 200 MB CUDA download.
- pandas 3: `dayofyear` is `day_of_year`; strings are a new dtype; be
  careful with `.values` vs `.to_numpy()`.
- IMERG V07 daily dims are `(time, lon, lat)`.
- AppEEARS dates are `MM-DD-YYYY`. Task names must be unique per user.
- FIRMS SP archive lags; NRT covers the last ~2 months; merge and de-dup.
- MODIS LST is Kelvin × 50; NDVI is × 10000.
- Climatology must come from training years only.
- Week boundaries: anchor to Monday everywhere, including FIRMS `acq_date`.

---

## 10. Glossary

- **FIRMS**: Fire Information for Resource Management System. Active fire
  detections from MODIS and VIIRS; a detection is a hot pixel, not a fire
  perimeter. **FRP**: fire radiative power in MW, a proxy for intensity.
- **IMERG**: Integrated Multi-satellitE Retrievals for GPM. Global rainfall
  estimate at 0.1°, half-hourly, with daily aggregates. Early/Late/Final
  runs trade latency for accuracy.
- **MODIS**: imager on Terra (MOD) and Aqua (MYD). **NDVI**: normalised
  difference vegetation index, −1..1, greener is higher. **LST**: land
  surface temperature, the skin temperature, hotter than air temperature on
  a dry day.
- **Climatology / normal**: the long-run mean (and spread) for a given cell
  and week of year. **Anomaly**: deviation from it, in standard deviations.
- **PR-AUC**: area under the precision–recall curve; random = positive rate.
- **SHAP**: per-prediction attribution of the score to each feature.
- **Mann-Kendall**: non-parametric test for a monotonic trend in a time
  series; **Sen's slope** is its matching estimate of the rate.
- **CMG**: climate modelling grid, MODIS products pre-aggregated to 0.05°.
