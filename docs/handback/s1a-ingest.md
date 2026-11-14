# S1-A handback · ingest + cold run

Branch `s1-ingest`. Cold run dispatched 2026-11-14 04:15:55 UTC (09:15 PKT) from the branch via `workflow_dispatch`.

## Cold run (proof)

- Actions run: https://github.com/uzainmalik123/nasa-proj/actions/runs/43555770268 · **success**
- Duration: **41 min 07 s** end to end (pipeline step 04:16:05 → 04:56:45, 2,438 s; G1 cold gate is 60 min)
- Data branch `data` pushed: 939 files, 122 MB (`cache/`, `out/freshness.json`, `places.parquet`)

| Cache | Files | Rows | Notes |
|---|---|---|---|
| `cache/power/{place_id}.parquet` | 554 | 2,197,718 | 2016-01-01 → 2026-11-10 per place (3,967 days), 0 failed, 0 throttled |
| `cache/firms/{date}.parquet` | 380 | 3,514,565 history + 49,433 live | 2025-11-01 → 2026-11-14; MODIS_SP ≤ 2026-08-31, MODIS_NRT after; VIIRS_NOAA21_NRT last 24 h |
| `cache/firms_counts.parquet` | 1 | 209,966 | 554 places × 379 dates, 22,059 non-zero |
| `cache/firms_live.parquet` | 1 | 49,433 | VIIRS N21 40,276 + MODIS_NRT 9,157, newest acq 2026-11-14T01:58Z |
| `cache/forecast/20261114T0416Z.parquet` | 1 | 8,864 | 554 places × 16 days, 0 failed |
| `places.parquet` | 1 | 554 | built in CI from Natural Earth (gitignored on main) |

`out/freshness.json` as published (https://raw.githubusercontent.com/uzainmalik123/nasa-proj/data/out/freshness.json):

```
NASA FIRMS     ok  product=VIIRS_NOAA21_NRT  valid_for=2026-11-14T01:58Z  retrieved_at=2026-11-14T04:16Z  records=49433
NASA POWER     ok  valid_for=2026-11-10       retrieved_at=2026-11-14T04:25Z  records=2197718
Open-Meteo     ok  valid_for=2026-11-14T04:18Z retrieved_at=2026-11-14T04:18Z records=8864
NASA GIBS      ok  valid_for=2026-11-13       retrieved_at=2026-11-14T04:56Z  records=null
Natural Earth  ok  valid_for=2026-11-14T04:16Z records=554
```

Run log excerpt:

```
04:16:07 ingest: places: places.parquet missing; building from Natural Earth → built 554
04:16:08 firms: live VIIRS_NOAA21_NRT: 47408 rows in world/2, 40276 in last 24h, newest 2026-11-14 01:28
04:16:08 firms: live MODIS_NRT: 9761 rows in world/2, 9157 in last 24h, newest 2026-11-14 01:58
04:16:10 firms: history: 76 chunks planned (2025-11-01..2026-11-13), 0 already cached, 76 to fetch
04:18:37 openmeteo: forecast done: 554 places ok, 0 failed, 8864 rows
04:25:21 power: power done: 554 ok, 0 failed, 2197718 rows, newest 2026-11-10
04:56:40 firms: history 76/76 chunks · 3514565 rows so far
04:56:44 firms: counts: 209966 rows (554 places x 379 dates), 22059 non-zero → firms_counts.parquet
04:56:45 run: done in 2438.07s · ok=True
```

## What works

- `pipeline/ingest/power.py` · per-place POWER cache, incremental (re-fetches the last 7 days so late-filled days overwrite), `-999 → null`, 1 req/s global pace across 2 workers, 3 retries with backoff on 429/5xx.
- `pipeline/ingest/firms.py` · live `world/2` for `FIRMS_LIVE_SOURCE` + `MODIS_NRT` filtered to the last 24 h and de-duplicated across runs; 12-month history in 5-day chunks with a manifest so later runs skip it; cKDTree join on unit vectors within `RADIUS_KM`; quota-aware pacing.
- `pipeline/ingest/openmeteo.py` · 16-day forecast per place, one request each, wind in m/s.
- `pipeline/ingest/__init__.py` · runs the three upstreams in parallel threads, builds `places.parquet` in CI when missing, writes `freshness.json` (contracts §3).
- `.github/workflows/pipeline.yml` · persists `places.parquet` and `firms/_history.json` on the data branch; `workflow_dispatch` inputs `place_limit` and `power_workers` for the PRD §10 fallback.
- `uv run ruff check pipeline/ingest` passes.

## Calls made (not in the prompt)

1. **FIRMS quota is transactions, not requests.** The MAP_KEY allows 5,000 transactions per rolling 10 min and a 5-day world chunk costs ~200, so a local test hit `400 Exceeding allowed transaction limit` after 22 chunks. The history loop now caps itself at 18 chunks per 10 min and polls `mapkey_status`. That cap is what made the cold run 41 min (four ~9.5 min pauses); POWER itself finished in 9 min. Incremental runs skip history entirely.
2. **MODIS_SP ends 2026-08-31**, so Sep 1 onward comes from `MODIS_NRT`, which has no `type` column; those rows count as vegetation fires.
3. **PLACE_TIER fallback was not needed**: POWER returned 554/554 with zero 429s from the runner.
4. POWER freshness is judged on calendar days (newest 2026-11-10 on 2026-11-14 = 4 days = ok), matching G2 "through 4 days ago".
5. GIBS freshness is a tile probe on MODIS Terra true colour for yesterday; the M-GIBS session should swap in the real layer ids.
6. Local FIRMS runs share the quota with CI. Do not run `ingest/firms.py` history locally while the workflow is running.

## Not done

- Nothing from the S1-A scope. S1-B (cron, gates, deploy wiring) is a separate session; the gates stage is still the S0 stub, so this run did not grade itself.
- The workflow's final "Trigger deploy" step dispatched `deploy.yml`, which will fail until Pages is enabled on the repo (it already failed on the S0 push). Not S1-A's concern but worth knowing.

## Contract notes

See `docs/contracts.md` change log, 2026-11-14 09:20 (additive columns `acq_date`, `satellite` on `firms/{date}.parquet`; new `cache/firms_live.parquet`; dense `firms_counts.parquet`; `firms/_history.json` and `places.parquet` on the data branch; forecast `wind_max` is 10 m wind in m/s).
