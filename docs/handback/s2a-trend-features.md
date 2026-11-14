# S2-A handback · trend engine + features

Branch `s2-science` (worktree `../nasa-project-s2`, based on main 94a1f09). Owns `pipeline/trend`, `pipeline/features`, `pipeline/publish` (+ `pipeline/dev/` for the synthetic generator, as the prompt asked).

## What works

| Module | Does |
|---|---|
| `trend/load.py` | one daily frame per place with the contract variables (`rain_mm, tmax_c, rh_pct, wind_ms, soil_wet, fires`) from `cache/power/{id}.parquet` + `cache/firms_counts.parquet`; also loads the newest `cache/forecast/*.parquet` |
| `trend/mk.py` | Mann-Kendall (`pymannkendall.original_test`) + Sen's slope per place per variable on (a) 120 monthly means ending at the last complete POWER month and (b) the 90 calendar days ending yesterday. Slopes converted to per-year (x12 / x365.25). Labels per contracts: `rising`/`falling` at p < 0.05, `stable` otherwise, `insufficient` below 60 valid values. `trend.run(ctx)` writes `data/out/trends.json` and leaves it in `ctx["trends"]` |
| `features/build.py` | one row per place per day for the last 13 months → `data/features.parquet`; `features.run(ctx)` uses `ctx["trends"]` and leaves the table in `ctx["features"]` |
| `publish/write_json.py` | `meta(ctx)`, `clean()` (numpy → python, NaN/inf → null), `write_json(name, payload, out_dir, n_places=, per_place=[...])` which validates one entry per place and warns over the 5 MB G6 limit |
| `dev/synth.py` | synthetic S1 caches with the §4 schema under `data/synth/` (`--synth` flag on both stages) |

## PROOF · real data branch (`origin/data` fde91a4, cold run 2026-11-14 04:16 UTC, 554 places)

### Runtimes (laptop, single process)

| Stage | Command | Time |
|---|---|---|
| trend | `uv run python -m trend.mk` | 10.4 s for 554 places x 6 variables x 2 windows (limit was 2 min) |
| features | `uv run python -m features.build` | 10.5 s, 219,938 rows |
| synthetic generator | `uv run python dev/synth.py` | 4.7 s |

### trends.json (`data/out/trends.json`, 2.72 MB, all p in [0, 1], no NaN)

`months`: `2016-11` → `2026-10` (120). Label counts over 554 places:

```
rain_mm   long  {'stable': 515, 'rising': 21, 'falling': 18}
rain_mm   short {'stable': 266, 'falling': 155, 'rising': 133}
tmax_c    long  {'stable': 482, 'rising': 72}
tmax_c    short {'falling': 407, 'rising': 101, 'stable': 46}      ← season, see call 2
rh_pct    long  {'stable': 432, 'falling': 69, 'rising': 53}
soil_wet  long  {'stable': 346, 'falling': 114, 'rising': 91, 'insufficient': 3}
fires     long  {'insufficient': 554}                               ← 12 months of history, see call 3
fires     short {'stable': 426, 'rising': 71, 'falling': 57}
```

Three places (slope per year in the contract unit, p, label):

```
== lahore-pk (index 102)
  rain_mm   mm/yr    10y  0.04839  p=0.2139   stable        90d   -1.985  p=1.8e-09  falling
  tmax_c    °C/yr    10y  0.008839 p=0.9729   stable        90d  -18.26   p=1.7e-08  falling
  rh_pct    pct/yr   10y  1.287    p=0.01457  rising        90d -225.4    p=0        falling
  wind_ms   m/s/yr   10y -0.01083  p=0.2813   stable        90d    0      p=0.9386   stable
  soil_wet  frac/yr  10y  0.006393 p=0.002068 rising        90d   -1.632  p=0        falling
  fires     det/yr   10y  null     p=null     insufficient  90d    0      p=1.4e-08  rising   (crop-burning season ramp)
  series_long rain_mm last 6 months: [2.099, 1.986, 9.999, 5.024, 2.684, 0.445]   fires last 3: [0.0, 0.3, 5.968]

== sydney-au (index 490)
  rain_mm   10y  0.05136  p=0.2391  stable    90d   2.922  p=0.0045  rising
  tmax_c    10y -0.05444  p=0.594   stable    90d  14.99   p=0.0006  rising
  rh_pct    10y  0.1297   p=0.38    stable    90d  -0.152  p=0.9912  stable
  wind_ms   10y -0.005008 p=0.5784  stable    90d   3.338  p=0.0073  rising
  soil_wet  10y  0.003611 p=0.04768 rising    90d   0.2609 p=2.8e-08 rising
  fires     10y  null                insufficient  90d 0  p=0.4608  stable

== sao-paulo-br (index 509)
  rain_mm   10y -0.07372  p=0.2615   stable    90d  12.69  p=0.0005  rising
  tmax_c    10y  0.1373   p=0.09548  stable    90d -13.22  p=0.0305  falling
  rh_pct    10y -0.6623   p=0.00097  falling   90d  45.62  p=7.7e-05 rising
  wind_ms   10y  0.001755 p=0.8792   stable    90d  -5.97  p=1.5e-06 falling
  soil_wet  10y -0.005663 p=5.9e-05  falling   90d   0     p=0.5386  stable
  fires     10y  null                insufficient  90d 0  p=0.00815 stable
```

Strongest significant 10-year soil drying (frac/yr): kinshasa-cd −0.0206, monrovia-lr −0.0172, ganzhou-cn −0.0145, luan-cn −0.0142, new-york-us −0.0139.

### features.parquet (`data/features.parquet`, 13.6 MB)

```
shape (219938, 41) · 554 places · dates 2025-10-14 → 2026-11-14
columns: date, place_id, place, rain_7d, rain_anom_7d, rain_30d, rain_anom_30d, rain_90d, rain_anom_90d,
  tmax, tmax_anom_7d, rh, rh_anom_7d, soil_wet, soil_anom, soil_wet_change_30d, days_since_rain,
  fwi_obs_7d, fwi_14d, fwi_14d_max, future_observed_days, fires_7d, fires_30d, days_since_fire,
  label_fires_14d, label_valid, label, rain_trend_10y, rain_trend_90d, tmax_trend_10y, tmax_trend_90d,
  rh_trend_10y, rh_trend_90d, soil_trend_10y, soil_trend_90d, fires_trend_90d, lat, lon, doy_sin, doy_cos, split
dtypes: 34 float32 · 3 string · 2 bool · place int32 · future_observed_days int16

label_valid rows 202,210 of 219,938 · label rate 0.293  (≥ 3 MODIS detections within 50 km in the next 14 days)
split  train 178,942 rows (label rate 0.287) · holdout 23,268 (0.336, final 6 weeks) · inference 17,728
label window: FIRMS 2025-11-01 → 2026-11-13 (today's partial NRT day excluded)
places with at least one positive label: 492 / 554
label rate by continent: Africa 0.31 · Asia 0.35 · Europe 0.16 · N America 0.24 · Oceania 0.13 · S America 0.36
nan share: days_since_fire 0.21 (before a place's first detection), fires_30d 0.12 / fires_7d 0.06 (first month, no FIRMS yet), everything else ≤ 0.01
```

Sanity: every anomaly z has mean within ±0.2 and sd 0.93–1.12 across all rows. The label carries signal before any model: in train rows `fwi_14d` averages 0.140 where label=1 vs 0.066 where label=0, and `fires_30d` 32.8 vs 3.2. `fwi_14d` ranges 0–0.91.

Lahore rows (2026-11-14 is today's inference row; forecast-driven values on the last line):

```
      date  rain_30d  rain_anom_30d   tmax  tmax_anom_7d     rh  soil_wet  soil_anom  days_since_rain  fwi_obs_7d  fwi_14d  future_observed_days  fires_7d  fires_30d  days_since_fire  label_fires_14d  label  label_valid     split
2025-11-23      0.71          -0.64  23.33         -0.81  47.04      0.53       1.37               47       0.208    0.215                    14       0.0        NaN              7.0              1.0  False         True     train
2026-05-02     36.66           0.47  40.63          0.09  35.26      0.40       0.26                2       0.342    0.254                    14      10.0       12.0              2.0             46.0   True         True     train
2026-10-16     41.54          -0.28  32.45          0.22  47.51      0.34      -1.50                1       0.157    0.389                    14      30.0       50.0              0.0            111.0   True         True   holdout
2026-10-29     13.79          -0.43  33.38          0.75  19.67      0.33      -1.54               14       0.472    0.510                    12      51.0      156.0              0.0            172.0   True         True   holdout
2026-11-14      1.60          -0.59  26.90          1.12  68.00      0.32      -1.86               30       0.461    0.062                     0      56.0      298.0              1.0              NaN  False        False inference
```

Caveat visible in that last row: Open-Meteo's humidity for Lahore this week (rh_min ≈ 49 %) is far above POWER's recent daily means (20–47 %), so `fwi_14d` drops from 0.46 observed to 0.06 forecast. Across 554 places the forecast-minus-observed humidity offset has median 0.2 but 129 places differ by more than 15 points and 28 by more than 25; the Punjab plain (Lahore, Gujranwala, Faisalabad, Rawalpindi, Peshawar, Amritsar) is 34–39 points wetter in the forecast. The per-place calibration in call 8 removes this as soon as the forecast cache carries past days. Across all places the inference-row `fwi_14d` mean (0.060) is close to the holdout mean (0.072).

Synthetic set (`dev/synth.py`, `--synth`): same shapes, 554 places, label rate 0.232, trends 9.6 s, features 9.7 s.

## Calls I made (change freely)

1. **Long window months** = the 120 complete months ending at the last month fully ≤ today − 3 days (POWER lag), so `months` is `2016-11 … 2026-10` today. A monthly mean needs ≥ 20 valid days. "Monthly mean" is the mean of the daily values (mm/day for rain, detections/day for fires), so the long slope unit is "daily value per year"; the contract's unit strings are kept as they are.
2. **Short window** = the 90 calendar days ending yesterday, NaN skipped (POWER's last 3 days are NaN, so ~87 values). The 90-day `tmax_c` slope is dominated by the season (every mid-latitude place is "falling" in November). That is what "the last 90 daily values" means; if the UI wants "what is changing now" net of season, S2-B can switch the short window to anomalies in one line (`daily − climatology`).
3. **`fires` long window** is `insufficient` everywhere by construction: FIRMS history is 12 months, so at most 12 of 120 monthly means exist.
4. **`soil_wet` = POWER `GWETROOT`** (`soil_root`), not `soil_top`.
5. **Constant series** (e.g. zero fires for 90 days) → slope 0, p 1, `stable`, not `insufficient`.
6. **Climatology** per feature is pooled over ±15 calendar days across the whole 10-year cache (the 13 feature months included; slight leakage, accepted). `z` is clipped to ±5 and `sd` floored at 1e-6.
7. **Gap days** between the last POWER day and today: tmax/rh/wind/soil carried forward (≤ 5 days), rain filled with the day-of-year climatological mean. Backward windows run on that gap-filled path so the newest rows are not NaN; today's row takes today's forecast values.
8. **Future weather for `fwi_14d`** = observed POWER where it exists ("perfect prognosis"), Open-Meteo beyond it. Forecast → POWER units, in order of preference: (a) when the forecast cache carries Open-Meteo `past_days` rows, a **per-place linear map** for tmax / rh / wind fitted on the ≥ 30 days both sources cover (slope clipped to 0.3–2); (b) otherwise `rh_mean` and `0.75 × wind_mean` (S1's additive columns, 2026-11-14); (c) otherwise `rh_min + 19`, `0.48 × wind_max`, the medians measured across 554 places on 2026-11-14. The log line says how many places got (a). On the synthetic set with an injected per-place humidity bias, (a) brings the mean |offset| from 10.4 pct to 0.0; on the real branch today it is 0 places until S1 adds `past_days=92`. `future_observed_days` says how many of the 14 days were observed.
9. **Fire weather index** (0–1, higher = more danger): Angstrom `I = rh/20 + (27 − tmax)/10`, `danger = clip((4 − I)/4)`, times a wind factor `0.6 + 0.4·clip(wind/8)` and a dryness factor `0.4 + 0.6·clip(days_since_rain/14)`; a rain day is ≥ 1 mm.
10. **Labels**: `label_fires_14d` = detections in d+1 … d+14; `label = label_valid & (≥ LABEL_MIN_DETECTIONS)`; `label_valid` only when the whole window lies inside the FIRMS cache, excluding the newest (partial NRT) day. **Split**: `inference` where the label is not valid, `holdout` for the final 6 weeks of valid labels, `train` before that.
11. **Trend slope features** are the current-run slopes copied onto every row of the place (constant per place). `fires_trend_10y` is omitted (always insufficient).
12. `features.parquet` lands at `data/features.parquet` (contracts §4) which the S1 workflow does **not** push to the data branch (it pushes `cache/*.parquet` only). S2-B/S1-B decide whether it should.

## Not done

- Nothing of S2-A's scope is missing. Not run inside `run.py` end to end (that needs S1's ingest to run first); each stage was run standalone against the real data branch and against the synthetic set.
- No unit tests; validation is the standalone runs and the spot checks above.

## Contract notes

- No schema change. `trends.json` matches §3 exactly (`variables`, `units`, `long`/`short` with `window`/`slope`/`p`/`label`, `series_long`, `months`), one entry per place in `places.parquet` order.
- `write_json.write_json` is the writer S2-B should use for `risk.json`, `series.json`, `feed.json`, `honesty.json` (pass `per_place=[...]` to get the length check).
