# M-PAKISTAN handback · S1 · 2026-11-15 (PRD M9)

Branch `s1-ingest` (fast-forwarded onto `main` first), worktree `../nasa-project-s1`.

## What works

- **112 new places, 554 → 666.** `pipeline/places/pk_districts.csv` holds 131 Pakistani districts (GADM 4.1 level 3; level 2 is only the 32 divisions) with the 2017 census population from OCHA COD-PS as exposure. `places.pakistan.append_tier` appends the ones whose centroid is ≥ 30 km from every global place and from every more populous district already taken (19 dropped: Lahore, Faisalabad, Gujranwala, Hyderabad, Islamabad, Peshawar, Rawalpindi, Abbottabad, Sheikhupura, the four Karachi districts, …). Rows carry `tier: "pk"`, `radius_km: 30`, `capital: false`, ids `<slug>-district-pk`; global rows carry `tier: null`. The global constants (`PLACE_TIER`, `RADIUS_KM`, `DEDUPE_KM`) are untouched.
- **Same caches.** The tier goes through `ingest.load_places` (appended once, written back to `places.parquet`, so the data branch carries it), FIRMS counts (KD-tree now uses each place's own `radius_km`), POWER (first run fetches 2016 → today for the 112, paced at `POWER_PACE_S`), Open-Meteo (places absent from the previous forecast file get the 92-day history in their own batches, also when a cached run would otherwise be reused).
- **Budget.** A run with ≥ 50 uncached places uses the cold G1 budget once (`run.json.cold = true`). Afterwards tier places re-fetch POWER only on runs whose UTC hour divides by 6 (every 2nd cron run; `power.is_due`), or when uncached / about to fall outside G2's 4-day window, so the steady-state run costs ~554 + 112/2 POWER seconds.
- **Dashboard.** `?region=pk` opens with a fly-to to lon 69.35, lat 30.4, zoom 4.5 (`REGIONS` in S4's `Dashboard.tsx`, one line in `initialState`); `Place.tier?: "pk" | null` in `types.ts`.
- Tests: `tests/test_pakistan.py`, `test_power.py`, `test_firms_counts.py`, two new cases in `test_openmeteo.py`; 42 pass. `uv run ruff check` + `ruff format --check` clean; `npm run lint && npm run build` pass.

## Proof

- Local full run (`uv run python run.py`, caches copied from the s2 worktree, hour 03 UTC): see the log excerpt below.
- `region-pk.png`: the built dashboard served from `dashboard/out` with this run's JSON, opened at `/?region=pk`.

```
08:44:48 INFO places.pakistan: places: +112 pk-tier rows → 666 (PRD M9)
08:44:48 WARNING ingest: 112/666 places without a POWER cache: cold run (G1 budget 3600 s)
08:44:48 INFO ingest.openmeteo: forecast: 666 places in 28 batches · past_days 2 (112 new places at 92) · previous 20261114T0827Z.parquet
08:45:33 INFO ingest.firms: counts: 253080 rows (666 places x 380 dates), 24302 non-zero → firms_counts.parquet
08:46:15 INFO ingest.openmeteo: forecast done: 666 places ok, 0 failed, 71928 rows (49860 carried over) → 20261115T0344Z.parquet
08:56:57 INFO ingest.power: power done: 666 ok (0 tier places not due, cache kept), 0 failed, 2642688 rows, newest 2026-11-11
08:58:05 INFO gates: G1_time      PASS  value=796.5  cold run, limit 3600 s
08:58:05 INFO gates: G2_coverage  PASS  value=1.0  666/666 places complete · power 666 · forecast 666 (20261115T0344Z.parquet) · firms 666
08:58:05 INFO gates: G3_freshness PASS  value=1.97  firms 2.0 h (≤ 6 h) · power 4.0 d (≤ 4 d) · forecast 0.2 h (≤ 12 h)
08:58:05 INFO gates: G4_sanity    PASS  value=0.2998  firms rows 50827 · wildfire p std 0.2998 · risks and trend p in [0, 1]
08:58:05 INFO gates: G5_model     PASS  value=0.7855  PR-AUC 0.785 vs baseline 0.303 · Brier 0.1236 vs baseline 0.2058
08:58:05 INFO gates: G6_output    PASS  value=3.27  8 files · largest 3.27 MB · first run
08:58:05 INFO gates: G7_deploy    skip  value=None  checked by the workflow against the live run.json
08:58:05 INFO run: done in 797.16s · ok=True · failed_gate=None · failed_stage=None · {'ingest': 730.51, 'places': 0.0, 'trend': 16.518, 'features': 14.256, 'hazards': 34.226, 'publish': 0.957, 'gates': 0.692}
```

## Calls made

1. GADM level 3, not level 2: level 2 for Pakistan is the 32 divisions; level 3 is the 141 districts (GADM's vintage is pre-2018, so newer districts such as Chiniot or Qambar Shahdadkot are inside their parents). Excluded: GADM's two "Disputed Area" polygons, Kargil, Leh, Kupwara (India-administered) and Rann of Kutch (uninhabited).
2. Population = 2017 census district totals (HDX COD-PS adm2). Azad Kashmir and Gilgit-Baltistan are not in that file: rounded 2017 figures are hard-coded in `build_pk.py` (`pop_source` column says which). Karachi's five districts share the census "Karachi City" row by the 2017 district shares; all five fall inside the global Karachi place anyway.
3. Dedupe at 30 km against global places and within the tier, most populous first, so Islamabad district (8 km from the global Rawalpindi) and Lahore district are not duplicated.
4. POWER refresh every 2nd run for the tier (PRD §13.2's own pattern for tier 2) instead of raising `POWER_PACE_S`; keeps the incremental run near 11 min instead of ~13.
5. Touched outside S1: `publish/__init__.py` (S2, `+"tier"` column in `places.json`, null-safe records), `dashboard/src/components/Dashboard.tsx` and `lib/types.ts` (S4). Contract note added at the bottom of `docs/contracts.md`.

## Not done

- ~~Actions run~~ **Done after the merge**: run [43676065551](https://github.com/uzainmalik123/nasa-proj/actions/runs/43676065551) on main, dispatched 04:16:54 UTC (09:16 PKT), green at 04:30:57 UTC: **14 min 3 s wall clock, `run.json` duration 802 s** (ingest 666 s, science ~130 s), `cold: true` (112 uncached places), G1–G6 pass, G7 pass; live `places.json` has 666 places, 112 with `tier: "pk"`. The original note follows for the record.
- **Actions run (before the merge).** Auto mode cannot merge or dispatch: the PR is open, the user must `! gh pr merge <n> --merge` and `! gh workflow run pipeline.yml --ref main`. The first run after the merge fetches 112 × 10 years of POWER (cold budget, ~2 min extra) and ~860 extra Open-Meteo calls; expected duration ~13–14 min on the runner (locally 797 s: ingest 731 s of which POWER 729 s for 666 places, science 65 s); the steady-state incremental run on an odd 3-hourly slot skips the 112 tier places' POWER fetch and should sit near 11 min, an even slot near 13 min. The live site shows 666 places only after that run is green.
- Open-Meteo answers the 92-day burst with a few `429 Retry-After 4 s`; `_http` retries them (seen locally, harmless), but it is a per-IP minute limit the shared runner may hit harder.
- The hazards-table caption (S4) still says "within 50 km"; the per-place sentence in `risk.json.text` now quotes the place's own radius (`hazards/common.PlaceInputs.radius_km`, S2 dir, one field). The caption is a one-line S4 follow-up.
- No separate "Pakistan" filter in the UI (the continent filter covers Asia; `?region=pk` is the entry point PRD M9 asks for). Tier places render like global ones; a smaller dot for the 30 km tier is a one-line S3 follow-up in `globe/colour.ts` if wanted.
