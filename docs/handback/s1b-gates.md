# S1-B handback · gates + cron + deploy

Branch `s1-ingest`, merged with `origin/main` (S2-A/B, S3-B, S4-B) first. PR to main: https://github.com/uzainmalik123/nasa-proj/pull/9 (open, see "Not done").

## What works

| Item | Where | Proof |
|---|---|---|
| `fires_24h.json` (contracts §3) | `pipeline/ingest/fires24.py`, written by the ingest stage next to `freshness.json` | sample below: 43,566 VIIRS rows → 8,954 bins |
| G1–G7 → `run.json` | `pipeline/publish/gates.py`; `run.py` always runs it last and exits 1 on a failed stage or gate | standalone run on S2's real data below; 19 pytest cases |
| `honesty.json` `runs[0]` rewritten with final ok / failed_gate / duration_s, last 10 kept | gates stage | `runs[0]` below |
| Snapshot `cache/published/{run_id}.parquet` of the published risk | gates stage, green runs only | `test_green_run` asserts the parquet, columns `run_id, place_id, valid_from, valid_to, wildfire_p … rain_category, model_version` |
| Workflow: gate summary in the job summary, failed-run artifact, push + deploy only on success, G7 polls the live `run.json` for the new run id (3 min) before triggering the deploy | `.github/workflows/pipeline.yml` | YAML parses; steps: checkout, setup-uv, sync, restore, run, gate summary, artifact, push, G7, deploy |
| Cron `0 */3 * * *` | unchanged, `pipeline` workflow is `active` (`gh api …/actions/workflows`) | the new steps become live once PR #9 is on main |
| Open-Meteo batched 25 places per request | `pipeline/ingest/openmeteo.py` | 60 places in 1.5 s (was ~1.6 s **per place**: the 08:27 run spent 903 s in the forecast alone, over the 900 s G1 budget) |
| Dashboard loads on real data once `run.json` exists | `docs/handback/s1b/local-real-data-with-run-json.png` | built with `NEXT_PUBLIC_DATA_URL=/real` over S2's real JSON + my `fires_24h.json` + `run.json`; no console errors; the "fires 24 h 44k · 8,954 bins" tile reads the new file |

## Proof

### fires_24h.json (from the local `cache/firms_live.parquet`, 14 Nov 01:28Z pull)

```
{"meta": {"run_id": "20261114T0949Z", "generated_at": "2026-11-14T10:31:11Z", "tier": 1}, "source": "VIIRS_NOAA21_NRT", "newest_acq": "2026-11-14T01:28Z", "bins": [[24.9, -22.9, 224, 157.3], [23.1, -25.9, 174, 147.2], [124.1, -17.1, 147, 97.8], "…"]}
```

### Gates standalone on S2's real data (`uv run python -m publish.gates --data-dir …`)

```
INFO gates: G1_time      FAIL  value=2567.3  incremental run, limit 900 s
INFO gates: G2_coverage  PASS  value=1.0     554/554 places complete · power 554 · forecast 554 (20261114T0827Z.parquet) · firms 554
INFO gates: G3_freshness PASS  value=2.44    firms 2.4 h (≤ 6 h) · power 3.0 d (≤ 4 d) · forecast 1.9 h (≤ 12 h)
INFO gates: G4_sanity    PASS  value=0.2991  firms rows 51833 · wildfire p std 0.2991 · risks and trend p in [0, 1]
INFO gates: G5_model     PASS  value=0.7909  PR-AUC 0.791 vs baseline 0.437 · Brier 0.1370 vs baseline 0.2131
INFO gates: G6_output    FAIL  value=2.725   trends.json from run 20261114T0933Z; freshness.json from run 20261114T0827Z
INFO gates: G7_deploy    skip  value=None    checked by the workflow against the live run.json
INFO gates: stage gates · 0.6s · ok=False · failed gate G1_time
```

G1 and G6 fail here because the standalone run measures from `risk.json`'s `generated_at` (09:50) and S2's local `out/` mixes files from four local runs; both are exactly what the gates are for. Against the 08:27 parquet (fetched before the fallback fill existed) G2 reads 533/554: 21 European places had an all-null day 16, see the fill below. The next CI run writes a parquet without those holes.

`run.json` written by that run:

```
{
 "run_id": "20261114T0949Z",
 "tier": 1,
 "n_places": 554,
 "started": "2026-11-14T09:50Z",
 "finished": "2026-11-14T10:33Z",
 "duration_s": 2567,
 "gates": {
  "G1_time": {
   "value": 2567.3,
   "pass": false,
   "detail": "incremental run, limit 900 s"
  },
  "G2_coverage": {
   "value": 0.9621,
   "pass": false,
   "detail": "533/554 places complete · power 554 · forecast 533 (20261114T0827Z.parquet) · firms 554"
  },
  "G3_freshness": {
   "value": 2.44,
   "pass": true,
   "detail": "firms 2.4 h (≤ 6 h) · power 3.0 d (≤ 4 d) · forecast 1.9 h (≤ 12 h)"
  },
  "G4_sanity": {
   "value": 0.2991,
   "pass": true,
   "detail": "firms rows 51833 · wildfire p std 0.2991 · risks and trend p in [0, 1]"
  },
  "G5_model": {
   "value": 0.7909,
   "pass": true,
   "detail": "PR-AUC 0.791 vs baseline 0.437 · Brier 0.1370 vs baseline 0.2131"
  },
  "G6_output": {
   "value": 2.725,
   "pass": false,
   "detail": "trends.json from run 20261114T0933Z; freshness.json from run 20261114T0827Z"
  },
  "G7_deploy": {
   "value": null,
   "pass": null,
   "detail": "checked by the workflow against the live run.json"
  }
 },
 "ok": false,
 "metrics": {
  "pr_auc": 0.7909356217466212,
  "baseline_pr_auc": 0.43717931116715153,
  "brier": 0.13699677138499808
 },
 "failed_gate": "G1_time",
 "failed_stage": null,
 "cold": false,
 "timings": {}
}
```

`honesty.json` `runs[0:2]` after it: `{'run_id': '20261114T0949Z', 'ok': False, 'failed_gate': 'G1_time', 'duration_s': 2567}, {'run_id': '20261114T0935Z', 'ok': True, …}`

### Tests and lint

```
$ uv run pytest -q tests          19 passed in 0.46s
$ uv run ruff check .             All checks passed!
$ uv run ruff format --check .    33 files already formatted
$ npm run lint                    (dashboard, unchanged) ok
```

`tests/test_gates.py` breaks each gate in turn (slow run, missing POWER file, stale FIRMS, < 1,000 FIRMS rows, flat wildfire p, p > 1, trend p > 1, NaN in risk, PR-AUC below baseline, Brier above baseline, missing file, file from an older run) and asserts `failed_gate`, `ctx["ok"] is False`, the honesty ledger and that no snapshot is written; the green case asserts the snapshot parquet and `duration_s`.

### Open-Meteo benchmark (14 Nov 10:30 UTC)

```
past=92 n_loc=1   1.00s   past=92 n_loc=5   0.51s   past=92 n_loc=20  0.79s
openmeteo.run(60 places) → 60 ok, 0 failed, 6480 rows, 1.5 s, 108 rows per place, same 9 columns
```

Expected incremental run: FIRMS ~10 s + POWER ~555 s (parallel with the ~20 s forecast) + science ~55 s + gates ~2 s ≈ 10.5 min, inside the 15 min G1 budget. POWER (`POWER_PACE_S = 1.0`, 554 places) is now the floor.

### Day-16 fill (reviewer asked for the source to be fixed, not the gate)

Probe, 14 Nov 10:50 UTC, per model, nulls among the 16 forecast days for Amsterdam / Dublin / Helsinki / Lahore:

```
best_match     1 1 1 0     (Europe's tail is ECMWF IFS, a 15-day model)
gfs_seamless   0 0 0 0
ecmwf_ifs025   1 1 1 1
icon_seamless  9 9 9 9
gem_seamless   6 6 6 6
```

`openmeteo.run` now re-fetches any place with an all-null forecast day from `gfs_seamless` and patches only those rows (`fill_missing_days`, unit-tested). Live, 40 European + 20 other places:

```
forecast fill: 10 places had all-null days (10 rows); gfs_seamless filled 10, 0 left
places with 16 non-null forecast days: 60 of 60 | min 16
```

G2 therefore requires all 16 days again (`config.FORECAST_DAYS`).

## Not done

- **Merge and dispatch.** `gh pr merge 9` and `gh workflow run pipeline.yml --ref …` were both denied by the auto-mode permission classifier, so there is no green CI run, no data branch with nine files, no live G7 and no Pages screenshot yet. To finish: merge PR #9, then `gh workflow run pipeline.yml --ref main`, watch for the "G7 · live run.json carries the new run id" step, then open https://uzainmalik123.github.io/nasa-proj/ (the dashboard reads the data branch at runtime, so the data needs no rebuild; the run triggers one anyway).
- The Pages dashboard keeps failing with `run.json: HTTP 404` until that first green run pushes the data branch.

## Calls made

- `fires_24h.json` bins only the `FIRMS_LIVE_SOURCE` rows of `firms_live.parquet`; the MODIS_NRT rows in the same file are the same fires seen by another sensor and would double count. Fallback to all rows if the VIIRS slice is empty.
- G2 "full forecast" = all 16 days non-null from today; the ingest fills Europe's day 16 from GFS so this holds (see above).
- G1 "cold" = no `cache/power/*.parquet` at the start of the ingest stage (`ctx["cold"]`).
- G5 also requires Brier ≤ `baseline_brier` (the fire-weather baseline's Brier, which the metrics dict carries).
- G6 requires every published file's `meta.run_id` to equal this run and `generated_at` to be after the previous `run.json`'s `started`.
- G7 is `null` in `run.json`; the workflow step after the push is the check (fails the job, which skips the deploy trigger, if the raw URL never serves the new id within 3 min).
- Gates run even after an earlier stage raised, so every run writes `run.json`; a failed run's `run.json` is uploaded as a workflow artifact since the data branch only takes green runs.
- `pytest` added as a dev dependency; `tests/*` exempt from E501.

## Contract notes

One dated note at the bottom of `docs/contracts.md` (17:40): additive `run.json` keys (`detail`, `failed_gate`, `failed_stage`, `cold`, `timings`), the GFS fill for Europe's day 16, the VIIRS-only bins, the new `cache/published/{run_id}.parquet`, the honesty `runs[0]` rewrite, and the batched (schema-unchanged) forecast fetch.
