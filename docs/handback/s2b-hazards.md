# S2-B handback · wildfire model, hazard modules, risk / series / feed / honesty writers

Branch `s2-science` (worktree `../nasa-project-s2`, merged with main 6fe715e). Owns `pipeline/hazards`, `pipeline/publish`, plus `pipeline/trend/load.py` (S2-A's loader, same session). Data: the data branch of run 20261114T0842Z (554 places, POWER through 2026-11-11, forecast 20261114T0827Z with 108 rows per place, FIRMS 2025-11-01 → 2026-11-14).

## What works

| Module | Does |
|---|---|
| `hazards/wildfire.py` | XGBoost `hist` on the 33 feature columns, time-ordered: train rows up to 4 weeks before the holdout, those 4 weeks are the early-stopping set, the final 6 weeks of valid labels (2026-09-19 → 10-30) are the holdout. Isotonic calibration on the holdout. PR-AUC on raw scores, Brier on **cross-fitted** calibrated scores (isotonic fitted on each half of the holdout, applied to the other) so the published Brier and the honesty buckets are out of sample for the calibrator too. Baselines: fire weather index (`fwi_14d`, isotonic the same way), persistence (`fires_30d`), climatology. SHAP `TreeExplainer` top-5 per place for today's row. Saves `data/model/xgb_wildfire.json` and `metrics.json` (metrics + isotonic breakpoints). |
| `hazards/drought.py` | index = 0.40 z(90-day rain) + 0.25 z(30-day rain) + 0.35 z(root-zone soil), each against the place's own 10-year climatology for that calendar window; categories from `config` (−0.5 / −1.0 / −1.5); severity = 90-day deficit as a fraction of normal; reasons quote mm vs normal, soil sd, and a falling rain / soil trend from `trends.json` when significant. |
| `hazards/heat.py` | thresholds = 95th / 99th percentile of the place's own 10-year daily `T2M_MAX`; `days_above` over d+1 … d+14 on the observed+forecast path; severity = °C of the hottest day over the 95th; Rothfusz heat index in the drivers when ≥ 27 °C; category from `config` (1 / 3 / 7 days), capped at "elevated" unless the hottest day is ≥ 1 °C over the threshold. |
| `hazards/rain.py` | "unusually wet week" = wettest 7-day total inside the 14-day window ≥ the place's seasonal (±30 calendar days) 95th percentile of the same statistic; p from a log-normal forecast-error model (σ = 0.5 in log(mm+1)); severity = mm over the 95th-percentile week; 3-day totals in the drivers; text ends "Not a flood forecast." |
| `hazards/common.py` | one pass over the places (POWER + forecast via the feature builder's `weather_path`): thresholds, 16-day forecast arrays (`fwi_forecast`), 90-day hindcast inputs for heat and rain, series.json normals, completeness for confidence. |
| `hazards/__init__.py` | `run(ctx)`: trains, scores today and the 90 history days, assembles `risk`, `series`, `honesty`, `metrics`, anomaly z-matrices for the feed. `python -m hazards [--synth]` runs hazards + publish standalone. |
| `publish/feed.py` | triggers `category_up` (into high/extreme), `z_above_2` (risk > trailing 90-day mean + 2 sd, category not low), `new_anomaly` (a new \|z\| > 1.5 flag on 30-day rain / soil / 7-day tmax mapped to drought / rain / heat, category not low), in that priority; one per place per hazard per 7 days; seeded by replaying the last 30 days of the hindcast when no previous `feed.json` exists; later runs read the previous file, expire, and mark re-triggered alerts `updated`. Newest first, max 50, same-minute alerts ordered by category then exposure. |
| `publish/__init__.py` | writes `places.json`, `risk.json`, `series.json`, `feed.json`, `honesty.json` (mode `hindcast`) with `write_json`; validates one entry per place, 90 history / 16 forecast lengths, p in [0, 1], no NaN in `now`, categories / confidence in the contract enums, wildfire p std vs G4. |
| `trend/load.py` | **new**: detects POWER's near-real-time product step and removes it per place (see "real-data surprise"). |

## PROOF

### Runtime (laptop, single process, the four science stages wired as in `run.py`)

```
SCIENCE STAGE 53.6 s {'trend': 13.3, 'features': 11.7, 'hazards': 28.2, 'publish': 0.4}
  hazards: xgboost train 1.5 s · scoring + SHAP 0.2 s · per-place inputs 25 s
```

### Metrics (`data/model/metrics.json`, holdout 2026-09-19 → 10-30, 23,268 rows, base rate 0.336)

| | PR-AUC | Brier |
|---|---|---|
| **xgb_wildfire** (240 rounds) | **0.791** | **0.137** (cross-fitted calibration; in-sample 0.135; raw 0.137) |
| fire weather index baseline (`fwi_14d`) | 0.437 | 0.213 (isotonic, cross-fitted) |
| persistence (`fires_30d`) | 0.731 | – |
| climatology (constant 0.336) | – | 0.223 |

G5 passes (PR-AUC above baseline, Brier below). Honest caveat: most of the skill is persistence; the model's lift over `fires_30d` is 0.06 PR-AUC. The SHAP drivers say the same thing (`fires_7d`, `fires_30d`, `days_since_fire` lead almost everywhere).

### honesty.json (cross-fitted buckets)

```
window 2026-09-19 → 2026-10-30 · top20_hit_rate 0.988 · baseline_top20_hit_rate 0.501
 lo    hi      n    pred    obs
 0.00 0.02  1709  0.0079  0.0140
 0.02 0.05  1040  0.0285  0.0298
 0.05 0.10  2409  0.0703  0.0764
 0.10 0.20  5243  0.1259  0.1284
 0.20 0.35  4418  0.2590  0.2780
 0.35 0.50  1566  0.4151  0.3557
 0.50 0.70  3000  0.5751  0.5787
 0.70 1.00  3883  0.8721  0.8699
runs: [20261114T0933Z ok 53 s, 20261114T0930Z ok 31 s, 20261114T0925Z ok 31 s]   (duration = science stages only; gates may overwrite runs[0])
```

### risk.json today (554 places, valid 2026-11-14 → 11-28, history 2026-08-16 → 11-13, forecast days 2026-11-14 → 11-29)

```
wildfire p          mean 0.294 sd 0.299 · pct 50/80/95/99 = 0.153 / 0.594 / 0.924 / 0.995 · categories low 178 elevated 187 high 55 extreme 134 · confidence high 492 medium 61 low 1
drought  index      mean -0.047 sd 0.970 · categories low 372 elevated 101 high 61 extreme 20
heat     days_above mean 0.22 · categories low 525 elevated 19 high 5 extreme 5
rain     p          mean 0.099 sd 0.181 · categories low 408 elevated 65 high 47 extreme 34   (hindcast mean 0.097, share > 0.5 = 5.5 %, i.e. the 5 % event it is built as)
top wildfire: mbabane-sz, juba-ss, sholapur-in, dhanbad-in, recife-br (0.995)
top drought: freetown-sl −2.49, melekeok-pw −2.18, khartoum-sd −2.05, bandar-seri-begawan-bn −2.04, n-djamena-td −2.02
top heat: praia-cv 12 d, ibadan-ng 12 d (1.9 °C over), banjul-gm 10, dakar-sn 10
top rain: quito-ec, guayaquil-ec (0.995), porto-alegre-br 0.88, yerevan-am 0.86
file sizes: risk.json 2.15 MB · series.json 2.43 MB · feed.json 0.03 MB · honesty.json 0.9 KB · places.json 80 KB (all under G6)
```

### risk.json for three places (`now`, `drivers`, `text`, last 5 history values, `fwi_forecast`)

```
== lahore-pk (index 102)
now: {"wildfire": {"p": 0.936, "severity": 0.161, "exposure": 6577000, "confidence": "high", "category": "extreme"}, "drought": {"index": -0.38, "severity": 0.369, "exposure": 6577000, "confidence": "high", "category": "low"}, "heat": {"days_above": 0, "severity": 0.0, "exposure": 6577000, "confidence": "high", "category": "low"}, "rain": {"p": 0.0, "severity": 0.0, "exposure": 6577000, "confidence": "high", "category": "low"}}
drivers: {"wildfire": [{"feature": "fires_7d", "label": "detections in the last 7 days", "shap": 1.697, "value": 56.0}, {"feature": "fires_30d", "label": "detections in the last 30 days", "shap": 1.677, "value": 298.0}, {"feature": "days_since_fire", "label": "days since last detection", "shap": 0.898, "value": 1.0}, {"feature": "fwi_obs_7d", "label": "observed fire weather, last 7 days", "shap": -0.434, "value": 0.344}, {"feature": "fwi_14d", "label": "forecast fire weather, next 14 days", "shap": 0.397, "value": 0.161}], "drought": [{"reason": "90-day rainfall 141 mm, 37% below normal"}, {"reason": "30-day rainfall 3 mm, 72% below normal"}, {"reason": "root-zone soil wetness 0.2 sd above normal"}, {"reason": "90-day rainfall trend falling (-1.94 mm/day per yr, p < 0.05)"}], "heat": [{"reason": "0 of the next 14 forecast days at or above the 95th percentile (44.6 °C)"}, {"reason": "0 days at or above the 99th percentile (47.1 °C)"}, {"reason": "peak 31.1 °C on day 2"}, {"reason": "peak heat index 35 °C with humidity"}], "rain": [{"reason": "wettest 7 days of the forecast total 0 mm"}, {"reason": "95th-percentile week for this time of year is 19 mm"}, {"reason": "wettest 3 days of the forecast total 0 mm (95th percentile 19 mm)"}]}
text: {"wildfire": "94% chance of 3 or more fire detections within 50 km of Lahore in the next 14 days (extreme). Forecast fire weather index 0.16 (0-1). 298 detections in the last 30 days. Main driver: detections in the last 7 days (raises risk).", "drought": "Drought index -0.4 for Lahore (low). 90-day rainfall is 37% below normal; soil wetness 0.2 sd above normal. 90-day rainfall trend falling (-1.94 mm/day per yr, p < 0.05).", "heat": "No forecast day above Lahore's 95th-percentile max temperature (44.6 °C) in the next 14 days; peak 31.1 °C.", "rain": "0% chance of an unusually wet week around Lahore (low): the wettest 7 forecast days total 0 mm against a 95th-percentile week of 19 mm for this time of year. Not a flood forecast."}
history (last 5): {'wildfire': [0.982, 0.982, 0.936, 0.936, 0.924], 'drought': [-0.33, -0.35, -0.34, -0.33, -0.41], 'heat': [0, 0, 0, 0, 0], 'rain': [0.0, 0.0, 0.0, 0.0, 0.0]}
fwi_forecast: [0.099, 0.1, 0.14, 0.14, 0.144, 0.138, 0.141, 0.141, 0.153, 0.158, 0.179, 0.202, 0.202, 0.194, 0.219, 0.558] 
```
```
== sydney-au (index 490)
now: {"wildfire": {"p": 0.228, "severity": 0.02, "exposure": 4630000, "confidence": "high", "category": "elevated"}, "drought": {"index": -0.06, "severity": 0.0, "exposure": 4630000, "confidence": "high", "category": "low"}, "heat": {"days_above": 0, "severity": 0.0, "exposure": 4630000, "confidence": "high", "category": "low"}, "rain": {"p": 0.006, "severity": 0.0, "exposure": 4630000, "confidence": "high", "category": "low"}}
drivers: {"wildfire": [{"feature": "fires_7d", "label": "detections in the last 7 days", "shap": -0.25, "value": 0.0}, {"feature": "days_since_fire", "label": "days since last detection", "shap": 0.225, "value": 14.0}, {"feature": "lon", "label": "longitude", "shap": -0.201, "value": 151.183}, {"feature": "doy_sin", "label": "season (sin)", "shap": -0.154, "value": -0.726}, {"feature": "fwi_obs_7d", "label": "observed fire weather, last 7 days", "shap": 0.12, "value": 0.01}], "drought": [{"reason": "90-day rainfall 169 mm, near normal"}, {"reason": "30-day rainfall 91 mm, 30% above normal"}, {"reason": "root-zone soil wetness 0.7 sd below normal"}, {"reason": "90-day soil wetness trend falling (-0.211 per yr, p < 0.05)"}], "heat": [{"reason": "0 of the next 14 forecast days at or above the 95th percentile (28.8 °C)"}, {"reason": "0 days at or above the 99th percentile (32.7 °C)"}, {"reason": "peak 27.6 °C on day 9"}, {"reason": "peak heat index 29 °C with humidity"}], "rain": [{"reason": "wettest 7 days of the forecast total 23 mm"}, {"reason": "95th-percentile week for this time of year is 85 mm"}, {"reason": "wettest 3 days of the forecast total 20 mm (95th percentile 68 mm)"}]}
text: {"wildfire": "23% chance of 3 or more fire detections within 50 km of Sydney in the next 14 days (elevated). Forecast fire weather index 0.02 (0-1). 2 detections in the last 30 days. Main driver: detections in the last 7 days (lowers risk).", "drought": "Drought index -0.1 for Sydney (low). 90-day rainfall is near normal; soil wetness 0.7 sd below normal. 90-day soil wetness trend falling (-0.211 per yr, p < 0.05).", "heat": "No forecast day above Sydney's 95th-percentile max temperature (28.8 °C) in the next 14 days; peak 27.6 °C.", "rain": "1% chance of an unusually wet week around Sydney (low): the wettest 7 forecast days total 23 mm against a 95th-percentile week of 85 mm for this time of year. Not a flood forecast."}
history (last 5): {'wildfire': [0.228, 0.153, 0.221, 0.228, 0.221], 'drought': [0.04, -0.01, -0.03, -0.1, -0.06], 'heat': [0, 0, 0, 0, 0], 'rain': [0.002, 0.002, 0.002, 0.002, 0.004]}
fwi_forecast: [0.029, 0.0, 0.0, 0.0, 0.011, 0.014, 0.011, 0.016, 0.034, 0.088, 0.02, 0.033, 0.032, 0.0, 0.016, 0.023] 
```
```
== sao-paulo-br (index 509)
now: {"wildfire": {"p": 0.243, "severity": 0.004, "exposure": 18845000, "confidence": "high", "category": "elevated"}, "drought": {"index": 2.95, "severity": 0.0, "exposure": 18845000, "confidence": "high", "category": "low"}, "heat": {"days_above": 0, "severity": 0.0, "exposure": 18845000, "confidence": "high", "category": "low"}, "rain": {"p": 0.625, "severity": 13.6, "exposure": 18845000, "confidence": "high", "category": "extreme"}}
drivers: {"wildfire": [{"feature": "fwi_14d", "label": "forecast fire weather, next 14 days", "shap": -0.421, "value": 0.004}, {"feature": "soil_trend_90d", "label": "90-day soil wetness trend", "shap": -0.286, "value": 0.552}, {"feature": "days_since_fire", "label": "days since last detection", "shap": 0.277, "value": 10.0}, {"feature": "fwi_14d_max", "label": "peak forecast fire weather", "shap": -0.271, "value": 0.027}, {"feature": "fires_7d", "label": "detections in the last 7 days", "shap": -0.233, "value": 0.0}], "drought": [{"reason": "90-day rainfall 539 mm, 122% above normal"}, {"reason": "30-day rainfall 199 mm, 72% above normal"}, {"reason": "root-zone soil wetness 3.0 sd above normal"}, {"reason": "10-year soil wetness trend falling (-0.00523 per yr, p < 0.05)"}], "heat": [{"reason": "0 of the next 14 forecast days at or above the 95th percentile (33.1 °C)"}, {"reason": "0 days at or above the 99th percentile (35.4 °C)"}, {"reason": "peak 30.9 °C on day 9"}, {"reason": "peak heat index 41 °C with humidity"}], "rain": [{"reason": "wettest 7 days of the forecast total 91 mm"}, {"reason": "95th-percentile week for this time of year is 78 mm"}, {"reason": "wettest 3 days of the forecast total 73 mm (95th percentile 56 mm)"}]}
text: {"wildfire": "24% chance of 3 or more fire detections within 50 km of São Paulo in the next 14 days (elevated). 30-day rainfall is 2.1 sd above normal. Forecast fire weather index 0.00 (0-1). 4 detections in the last 30 days. Main driver: forecast fire weather, next 14 days (lowers risk).", "drought": "Drought index +2.9 for São Paulo (low). 90-day rainfall is 122% above normal; soil wetness 3.0 sd above normal. 10-year soil wetness trend falling (-0.00523 per yr, p < 0.05).", "heat": "No forecast day above São Paulo's 95th-percentile max temperature (33.1 °C) in the next 14 days; peak 30.9 °C.", "rain": "63% chance of an unusually wet week around São Paulo (extreme): the wettest 7 forecast days total 91 mm against a 95th-percentile week of 78 mm for this time of year. Not a flood forecast."}
history (last 5): {'wildfire': [0.243, 0.243, 0.243, 0.243, 0.235], 'drought': [2.94, 2.81, 2.83, 2.94, 2.98], 'heat': [0, 0, 0, 0, 0], 'rain': [0.079, 0.111, 0.541, 0.625, 0.627]}
fwi_forecast: [0.0, 0.001, 0.0, 0.0, 0.0, 0.004, 0.027, 0.0, 0.0, 0.019, 0.008, 0.0, 0.0, 0.0, 0.0, 0.0] 
```

### feed.json head

```
meta {'run_id': '20261114T0935Z', 'generated_at': '2026-11-14T09:36:12Z', 'tier': 1} · 50 alerts · status {'active': 50} · trigger {'z_above_2': 41, 'category_up': 9} · hazard {'wildfire': 20, 'rain': 20, 'drought': 6, 'heat': 4}
{"id": "20261114T0935Z-buenos-aires-ar-wildfire", "hazard": "wildfire", "place": 510, "place_id": "buenos-aires-ar", "issued_at": "2026-11-14T09:35Z", "valid_from": "2026-11-14", "valid_to": "2026-11-28", "trigger": "z_above_2", "probability": 0.512, "severity": 0.011, "exposure": 12795000, "confidence": "high", "category": "extreme", "explanation": "51% chance of 3 or more fire detections within 50 km of Buenos Aires in the next 14 days (extreme). Forecast fire weather index 0.01 (0-1). 6 detections in the last 30 days. Main driver: days since last detection (raises risk).", "evidence": ["power:2026-11-11", "firms:2026-11-14T08:07Z", "openmeteo:2026-11-14T08:42Z"], "anomalies": [], "status": "active", "model_version": "2026-11-14T09:35Z"}
{"id": "20261114T0935Z-tehran-ir-wildfire", "hazard": "wildfire", "place": 94, "place_id": "tehran-ir", "issued_at": "2026-11-14T09:35Z", "valid_from": "2026-11-14", "valid_to": "2026-11-28", "trigger": "category_up", "probability": 0.512, "severity": 0.105, "exposure": 7873000, "confidence": "high", "category": "extreme", "explanation": "51% chance of 3 or more fire detections within 50 km of Tehran in the next 14 days (extreme). Forecast fire weather index 0.11 (0-1). 3 detections in the last 30 days. Main driver: days since last detection (raises risk).", "evidence": ["power:2026-11-11", "firms:2026-11-14T08:07Z", "openmeteo:2026-11-14T08:42Z"], "anomalies": [], "status": "active", "model_version": "2026-11-14T09:35Z"}
{"id": "20261114T0935Z-amaravati-in-wildfire", "hazard": "wildfire", "place": 105, "place_id": "amaravati-in", "issued_at": "2026-11-14T09:35Z", "valid_from": "2026-11-14", "valid_to": "2026-11-28", "trigger": "z_above_2", "probability": 0.752, "severity": 0.082, "exposure": 5800000, "confidence": "high", "category": "extreme", "explanation": "75% chance of 3 or more fire detections within 50 km of Amaravati in the next 14 days (extreme). 30-day rainfall is 2.0 sd above normal. Forecast fire weather index 0.08 (0-1). 2 detections in the last 30 days. Main driver: days since last detection (raises risk).", "evidence": ["power:2026-11-11", "firms:2026-11-14T08:07Z", "openmeteo:2026-11-14T08:42Z"], "anomalies": ["rain"], "status": "active", "model_version": "2026-11-14T09:35Z"}
{"id": "20261114T0935Z-yangon-mm-wildfire", "hazard": "wildfire", "place": 116, "place_id": "yangon-mm", "issued_at": "2026-11-14T09:35Z", "valid_from": "2026-11-14", "valid_to": "2026-11-28", "trigger": "z_above_2", "probability": 0.752, "severity": 0.017, "exposure": 4088000, "confidence": "high", "category": "extreme", "explanation": "75% chance of 3 or more fire detections within 50 km of Yangon in the next 14 days (extreme). Forecast fire weather index 0.02 (0-1). 6 detections in the last 30 days. Main driver: days since last detection (raises risk).", "evidence": ["power:2026-11-11", "firms:2026-11-14T08:07Z", "openmeteo:2026-11-14T08:42Z"], "anomalies": [], "status": "active", "model_version": "2026-11-14T09:35Z"}
```

### series.json (lahore-pk, last 5 of 90)

```
rain_30d        [11.1, 7.2, 7.2, 6.7, 2.8]
rain_30d_norm   [15.7, 14.8, 14.1, 13.4, 12.9]
rain_30d_sd     [23.1, 22.0, 20.9, 19.9, 19.0]
tmax            [32.0, 31.8, 32.2, 32.6, 32.6]
tmax_norm       [28.5, 28.4, 28.1, 27.9, 27.7]
tmax_sd         [3.03, 3.02, 3.11, 3.14, 3.11]
soil_wet        [0.465, 0.465, 0.465, 0.465, 0.465]
soil_wet_norm   [0.46, 0.458, 0.457, 0.456, 0.455]
soil_wet_sd     [0.069, 0.068, 0.067, 0.066, 0.066]
fires_7d        [116, 83, 92, 69, 58]
```

Synthetic set (`--synth`, no product step injected): trend 11.6 s, features 12.6 s, hazards + publish 30.3 s; PR-AUC 0.576 vs fwi 0.482, Brier 0.109 vs 0.120; `power step · none` logged, every file validates.

## Real-data surprise: POWER's near-real-time product step (fixed in `trend/load.py`)

Before any hazard ran, the global mean of `soil_anom` across the 554 places was −0.3 sd until 2026-09-30 and −1.1 sd from 2026-10-01 on, and the first drought run put 68 places in "extreme". The raw POWER cache shows every variable except rain stepping on 2026-10-01 (cross-place mean one-day change in `soil_root` 0.10 against a normal 0.005): that is the day POWER stops serving final MERRA-2 and serves the near-real-time GEOS product. Net of the climatological change for those weeks: `soil_root` −0.051 (87 % of places jump by more than their own daily sd), `soil_top` −0.055, `wind_ms` −19 %, `rh_pct` −1 to −2 points; `t2m_max` and `rain_mm` show no step.

`load.power_step` now finds the step every run (largest cross-place mean |Δ soil_root| in the last 150 days, if > 5× the median and > 0.02) and estimates a per-place offset for soil (additive), humidity (additive, shrunk halfway to the global mean) and wind (ratio, shrunk the same way) as the 2026 jump across ±28 days minus the same calendar jump averaged over the earlier years; `load_power` removes it from the days at and after the step. Every reader (trend, features, hazards) goes through `load_power`, so `trends.json` changed too: soil_wet 90-day labels went from mostly "falling" to rising 262 / falling 206 / stable 82. After the fix the global `soil_anom` is flat at −0.3 across the step, the drought index mean is −0.05 (was −0.34) and "extreme" drought is 20 places (was 68). The step date will move forward as POWER backfills; the detection logs `power step · <date>` or `power step · none` each run.

## Calls I made (change freely)

1. **Early stopping** on the last 4 weeks of the training rows, never on the holdout. Isotonic fitted on the whole holdout is the map used at inference; the published Brier / buckets are cross-fitted (two time-ordered halves). Calibrated p is clipped to [0.002, 0.995] (never exactly 0 or 1); rain p to ≤ 0.995.
2. **Confidence** = completeness (valid share of tmax / rain / soil over the 90 history days, ignoring the POWER lag) × freshness (POWER ≤ 4 days old) × forecast present → high / medium / low; wildfire additionally capped at "low" if the model is not above the baseline on PR-AUC and Brier, "medium" if the lift is < 15 %, and "medium" for a place with no positive label in 12 months.
3. **Wildfire category thresholds raised** (reviewer approved, 10:05 UTC): `config.CATEGORY_THRESHOLDS["wildfire"]` is 0.30 / 0.60 / 0.90, was 0.10 / 0.25 / 0.50. With a 0.29 label base rate (≥ 3 MODIS detections in 14 days is common in the burning belts) the old lines put 134 of 554 places in "extreme"; now low 375 · elevated 76 · high 70 · extreme 33. Probabilities unchanged. Today's percentiles are 50 / 80 / 95 / 99 = 0.15 / 0.59 / 0.92 / 0.995; S3 set the globe ramp stops and `CATEGORY_V` from these (their handback).
4. **Heat** thresholds are whole-record percentiles (absolute heat for that place), **rain** thresholds are seasonal (±30 calendar days). Heat "high"/"extreme" also need ≥ 1 °C over the threshold on the hottest day (Lima: p95 is 25.3 °C, 11 days at 25.5 °C would otherwise be "extreme").
5. **Drought** weights 0.40 / 0.25 / 0.35 and ±4 clip; no forecast term, so it is an observation-based risk assessment.
6. **Rain** error model σ = 0.5 in log(mm + 1); not calibrated (no archived forecasts yet), the text says "Not a flood forecast" and the rain history is a perfect-prognosis hindcast.
7. **History** = the last 90 feature rows scored with the current model (wildfire), the index from the same rows (drought), and the observed future along the path (heat, rain), i.e. everything is a hindcast with today's model, labelled so in `honesty.mode`.
8. **Feed**: `z_above_2` and `new_anomaly` only fire when the category is not "low" (otherwise 0.001 → 0.01 would alert); replayed alerts carry the current run's severity / exposure / confidence and say so in `explanation`; `probability` is null for drought and heat.
9. `places.json` is written by `publish` from `data/places.parquet` (nothing else wrote it to `data/out/`).
10. `honesty.runs[0].duration_s` is the science-stage time; the gates stage owns the final run ledger.

## Not done

- Not run through `run.py` with S1's ingest in front (needs the FIRMS key); proven with the four science stages wired in-process the same way (`trend.run → features.run → hazards.run → publish.run` on one `ctx`), and standalone on the real and synthetic sets.
- `run.json` / gates (S1 wires), `fires_24h.json`, `freshness.json` are not mine.
- No LLM rewrite (M8, cut); sentences are templates bound to the record.
- No unit tests; validation is the shape checks in `publish.run`, the standalone runs, and the spot checks above.
- `dashboard/public/data/*.json` still holds the 20-place mock; the real files are in `pipeline/data/out/` for S3/S4 to copy if they want real data before the next cron run.

## Contract notes

- No schema change; dated note added at the bottom of `docs/contracts.md` (publish writes the five files, `ctx["metrics"]` for G5, stateful feed / honesty, `data/model/`, POWER step correction).
- Every per-place array is validated to the places count before writing; `risk.json` and `series.json` are 2.2 / 2.4 MB.
