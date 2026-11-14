# INTEGRATE day 1 handback · main

14 Nov 2026, 22:00–22:45 PKT (17:00–17:45 UTC). One session on `main` in the main checkout (`~/Projects/hackathons/NASA/nasa-project`, now on `main`; the three worktrees stay on their branches).

**Live URL: https://uzainmalik123.github.io/nasa-proj/** · data from the `data` branch, run `20261114T1423Z` (554 places, 6/6 gates). Deploy of this integration: run 43620789272 (success, `a9e8742`).

## Merge

`s1-ingest`, `s2-science`, `s3-globe`, `s4-panels` merged into `main` in that order. `s2`, `s3`, `s4` were already on `origin/main` through PRs #8, #7, #6 (each had merged `origin/main` first, so S4's `Dashboard.tsx` is the resolution for the globe/panels seam, as planned). `s1-ingest` brought its last five commits (KNOWN_ISSUES.md, S1-B proof). No conflicts; nothing in contracts.md was contradicted by any branch.

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run build` (with `NEXT_PUBLIC_DATA_URL` = raw data branch) | pass, static export |
| `uv run --project pipeline ruff check pipeline` | pass (`uv run ruff check pipeline` from the repo root has no project to resolve `ruff` from; the `--project` form or `cd pipeline && uv run ruff check .` are the working spellings) |
| deploy.yml on push to main | success, 43620789272 |

## H1–H12 against the live site

Walked with `dashboard/scripts/walk.mjs` (headless Chromium, swiftshader) against https://uzainmalik123.github.io/nasa-proj/ at 17:35 UTC. Screenshots under `docs/handback/integrate-d1/`. No console errors during the walk; "data visible" (the subtitle reads 554 places) after 11.6 s on this link.

| # | Feature · done when | Result | Screenshot |
|---|---|---|---|
| H1 | globe points coloured by hazard or trend, hover name + value | **PASS** · wildfire ramp in next-14 mode; max-temperature Sen's slope ramp in now mode; hover tooltip "Lahore PK · 94% · extreme" | `h1-globe-wildfire-next14.png`, `h1-globe-trend-tmax-now.png`, `h1-hover-tooltip.png` |
| H2 | live FIRMS bins, refreshed by the cron · dots change between runs | **PASS** · 35k VIIRS NOAA-21 detections in 7,385 bins (KPI tile); the 01:28Z pull in the S1-B handback had 8,954 bins, so the layer does move between runs. One caveat below under H11. | `h2-fires-globe.png` |
| H3 | POWER + Open-Meteo ingest with parquet cache in Actions · end to end < 15 min incremental | **PASS** · run 43604599930: 629 s, `timings.ingest` 553.7 s, G1 pass; freshness panel shows POWER valid 2026-11-11 and Open-Meteo 14:30Z | `h10-freshness.png`, `h11-actions-runs.png` |
| H4 | 10-y and 90-d Mann-Kendall per place per variable · `trends.json` with slope, p, label | **PASS** · trends table: Dallas +0.54 °C/yr p 0.05 rising, 216 places drying (p<0.05, 10-yr rain); 90-day Δ column | `h4-trends-table.png` |
| H5 | feature table + wildfire model with calibration and baseline · PR-AUC above baseline | **PASS** · Sources row "xgb_wildfire 2026-11-14T14:23Z · PR-AUC 0.79 vs 0.44", KPI top-20 hit rate 99 % vs 50 % baseline (hindcast) | `h10-sources-h5-model.png` |
| H6 | drought, heat, heavy-rain modules · four hazards per place | **PASS** · four cards on every place panel; globe recolours per hazard; drought table sorted by deficit | `h8-place-panel.png`, `h6-globe-drought.png`, `h6-globe-heat.png`, `h6-globe-rain.png`, `h6-hazards-table-drought.png` |
| H7 | ranked trends + hazards tables, sortable, click flies the globe | **PASS** · row 3 (N'Djamena) click flies to Chad with the selected ring; "place" header re-sorts; trends row (Dallas) flies to Texas | `h7-hazards-row-click-flies.png`, `h7-hazards-table-sorted-by-place.png`, `h7-trends-row-click-flies.png` |
| H8 | selected place panel: trend chart, three anomaly series, four hazard cards with p / severity / exposure / confidence, drivers, sentence | **PASS** for Lahore: 10-y + 90-d trend charts, six variable chips, rain / tmax / soil anomaly bands, four cards, five SHAP drivers, template sentence | `h8-place-panel.png` |
| H9 | alert feed with the full alert record · updates each run | **PASS** · 50 alerts, run 20261114T1423Z, trigger / valid window / evidence anomalies / explanation per row | `h9-feed.png` |
| H10 | freshness + sources with valid and retrieved times · real timestamps | **PASS** · FIRMS valid 13:29Z retrieved 14:23Z, POWER 11 Nov, Open-Meteo 14:30Z, GIBS 13 Nov, Natural Earth; run line with gates | `h10-freshness.png`, `h10-sources-h5-model.png` |
| H11 | cron, run gates, data branch, static deploy · site updates by itself | **PASS with a caveat** · gates G1–G6 pass and G7 is checked by the workflow; data branch force-pushed on green; Pages deploy on push and after a green run. Caveat: only one *scheduled* run has fired so far (13:14Z for the 12:00Z slot; it went red on G2, the 21 European all-null day-16 rows, fixed in the 14:23Z dispatch). The 15:00Z slot has not fired as of 17:45Z, which is GitHub's usual delay/skip for new repos; the next slots are 18:00Z and 21:00Z. Nothing to fix in the workflow; watch that a scheduled run goes green overnight. | `h11-actions-runs.png`, `h10-freshness.png` |
| H12 | place search · typing a city selects it | **PASS** · `/` focuses, "lahore" lists Lahore PK · Asia, Enter selects, fills the box "Lahore, PK" and flies the globe | `h12-search-typing.png`, `h12-search-selected-flown.png` |

## Seams fixed (on main, commit `a9e8742`)

1. **Load time, KI-7 step 1a** (`dashboard/src/lib/data.ts`, `Dashboard.tsx`): `loadAll()` fetched `run.json` first and the other eight only after it. Now all nine go in parallel; the cache-buster is the 5-minute window (`?v=<floor(now/5min)>`) so viewers in the same window share raw.githubusercontent's CDN copy (max-age=300) and no viewer sees a run more than one window late. The pill reads "loading N of 9 files" instead of "connecting" (`ki7-loading-pill.png`). Measured on the same link in headless Chromium: local real-data build 24.6 s → 9.8 s; live site 11.6 s after deploy. Signature is `loadAll(onProgress?)`, additive; contracts.md note added.

No field-name or null-guard seams were found: every panel renders on the real files with no console errors, and the contracts §3 shapes are what the pipeline publishes.

## NOT DONE (owner named)

- **KI-7 step 1b, progressive render (S4, small):** render globe + KPIs as soon as `places` + `risk` arrive and the tables as `trends` arrives, instead of waiting for all nine. `Data` is all-or-nothing today, so this touches every panel's props. Then step 2 (S2 + S4, day 2) splits `series_long` / history / drivers / text into per-place files.
- **KI-10, missing-file tolerance (S4, small):** one 404 still blanks the dashboard (`could not load data: … HTTP 404`); the new pill shows "failed". Fetch independently and show a per-file "missing" row in the freshness panel.
- **KI-1 / KI-2 / KI-14 / KI-15 (S3):** fire-bin tooltip and legend text, low-risk dot legibility, places/fires/both toggle, zoom buttons. All visible in `h1-globe-wildfire-next14.png` (the fire bins dominate the globe at world zoom).
- **H11 scheduled run:** no code change; needs one green *scheduled* run as proof. Check `gh run list --workflow pipeline.yml` after 18:00Z / 21:00Z.

## Notes for day 2

- Walk recipe: `node dashboard/scripts/walk.mjs <base-url> <out-dir>` (base `http://localhost:8761` over `python3 -m http.server 8761` in `dashboard/out`, or the Pages URL). It waits for the subtitle text, not `tbody tr` (skeleton rows match that immediately).
- Chromium logs eleven minified `tO` console errors only when the page is navigated away mid-tile-load (MapLibre's aborted tile fetches); none during normal use, search, fly, or hazard switches.
- `git push origin main` from the session was allowed; `gh pr merge` / `gh workflow run` still need the reviewer (see memory note).
