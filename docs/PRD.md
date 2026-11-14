# PRD · Earth System Trend Detective

NASA Space Apps 2026 · challenge "Be an Earth System Trend Detective" · 14–15 Nov 2026 · team of four · fresh repo on day 1.
Version 2, 13 Nov 2026 evening. Merges the team's Environmental Intelligence blueprint. Version 1 is kept as `PRD.v1.md`.

Anything marked **(call)** is a decision I made for you. Change it freely.

---

## 1. One-liner

A live globe that watches ~600 major places on Earth, tells you **what is changing, where, and by how much** in NASA's record for each place, and then **what that trend means for the next 14 days**: wildfire, drought, heat, and heavy rain, each as a calibrated probability with the evidence, the exposure, and the confidence shown separately.

Detect the trend. Predict the hazard. Explain both.

## 2. Why this, why now

The challenge asks for trend detection in Earth system data. Most entries will be a globe of 20-year trends with a statistics test. Ours does that for every watched place and then answers the question a judge actually asks next: so what happens here in the next two weeks? It is running during judging. Fire detections are from the last three hours, every trend and risk was recomputed this morning, and a judge can type their own city.

## 3. Goals, non-goals, anti-goals

**Goals**
- Trend first. Every place carries a per-variable trend over 10 years and 90 days with slope, direction, and significance. That is the challenge's rubric.
- Live. Every number was computed in the last few hours from free public APIs. "Valid for" and "retrieved at" on every panel.
- Global. ~600 named places, every continent, both hemispheres, expandable by one constant.
- Predictive. Four hazards for the next 14 days from one feature table.
- Honest. Observation, forecast, risk assessment, and trend are labelled as four different things. Probability, severity, exposure, and confidence are shown separately.
- Data-dense. Tables and charts carry the story. The globe is the hook.
- Free. No paid API, no server, no card.

**Non-goals**
- Multi-year backtests, flood modelling, seasonal and climate projections, cyclone tracking.
- Mobile layout, accounts, subscriptions, SMS.
- Replacing any official warning service.

**Anti-goals**
- A dashboard that only works on one laptop.
- A pipeline a human must click during the demo.
- Filled polygons over half a continent. Points only.
- A score called a probability that was never calibrated.

## 4. Users and the moment

A judge with four minutes. The globe turns with live fire detections. A ranked table shows the ten places with the strongest drying trend and the ten with the highest fire risk this fortnight. They click one and see the trend chart, the anomaly charts, the risk, the drivers, and a sentence. Then they type their city.

Secondary users from the blueprint, for the pitch: disaster management teams, planners, researchers. The same screen serves all three because exposure, confidence, and source metadata are always visible.

## 5. The product in one screen

```
┌───────────────────────────────────────────────┬──────────────────────────────┐
│  Earth System Trend Detective                 │ KPI KPI KPI KPI              │
│  live · 612 places · updated 2h ago           │ places on watch · fires 24h  │
│  mode: [Now] [Next 14 days]                   │ places drying · last-week hit│
│      ┌──────── globe ─────────┐               │──────────────────────────────│
│      │ • points coloured by   │               │ TRENDS · ranked table        │
│      │   selected hazard or   │               │  strongest ↑ / ↓ per variable│
│      │   trend                │               │──────────────────────────────│
│      │ ✦ live FIRMS fires     │               │ HAZARDS · ranked table       │
│      │ ▒ GIBS rain/NDVI/LST   │               │  wildfire · drought · heat · │
│      └────────────────────────┘               │  rain, 14-day probability    │
│  [search] [hazard: fire|drought|heat|rain]    │──────────────────────────────│
│  [trend variable] [continent]                 │ SELECTED PLACE               │
│                                               │  10-yr trend + 90-day trend  │
│                                               │  3 anomaly series vs normal  │
│                                               │  hazard cards: prob·sev·exp· │
│                                               │  confidence · drivers · text │
│                                               │──────────────────────────────│
│                                               │ MOVERS · CONTINENTS · FEED   │
│                                               │ HONESTY · FRESHNESS · SOURCES│
└───────────────────────────────────────────────┴──────────────────────────────┘
```

## 6. Data sources, all free, all verified 13 Nov

| Need | Source | Access | Newest data on 13 Nov | Key |
|---|---|---|---|---|
| Fire detections, live and 12 months history | NASA FIRMS | `/api/area/csv/{KEY}/{SOURCE}/world/{1..5}[/{DATE}]` (world is capped at 5 days; bbox requests allow 10) | ~3 h (NRT); SP archive lags months | MAP_KEY, free, have it |
| Daily weather observations per place, 10-year record | NASA POWER | `/api/temporal/daily/point?parameters=T2M,T2M_MAX,PRECTOTCORR,RH2M,WS2M,GWETROOT,GWETTOP&community=AG&longitude=&latitude=&start=&end=&format=JSON` | 10 Nov (3-day lag, measured); the newest ~6 weeks are near-real-time GEOS, not MERRA-2, see §10 | none |
| 16-day forecast per place | Open-Meteo | `/v1/forecast?latitude=&longitude=&daily=temperature_2m_max,precipitation_sum,relative_humidity_2m_min,wind_speed_10m_max,et0_fao_evapotranspiration&forecast_days=16` | today | none, non-commercial |
| Rain, NDVI, LST imagery on the globe | NASA GIBS WMTS | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{LAYER}/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level{N}/{z}/{y}/{x}.png` | IMERG 12 Nov, LST 13 Nov, NDVI 8-day | none |
| NDVI per place (stretch) | AppEEARS point sample, MOD13A2.061 | REST, async | 16-day composite | Earthdata login, have it |
| Place list with population | Natural Earth `ne_10m_populated_places` | static file | n/a | none |

Rules check: NASA data must be used and visibly is. Open-Meteo is a supplement, allowed by the submission guide, and labelled as such everywhere it appears. POWER's precipitation is itself derived from GPM IMERG.

## 7. How it works

### 7.1 Places
~600 **(call)**: national capitals plus populated places over 1M, deduplicated within 50 km, each with a 50 km watch radius and its population as exposure. Tiers in §13.

### 7.2 Pipeline, Python, GitHub Actions cron every 3 hours
GitHub Actions has a fast network and free minutes on a public repo. No download ever touches a laptop.

1. **FIRMS**: `world/1` for the VIIRS NRT source that is live on the day (SNPP returned zero rows on 13 Nov; test NOAA20 and NOAA21 and set `FIRMS_LIVE_SOURCE` in config) for live dots, and MODIS_NRT for counts. Count detections within 50 km of each place with a KD-tree. Filter `type` to vegetation fires. One-time history: MODIS_SP world in **5-day chunks** (the API caps `world` requests at 5 days, verified 13 Nov) for 12 months, 73 requests.
2. **POWER**: per place, from the last cached date to today. First run fetches 10 years. Parquet cache in the data branch.
3. **Open-Meteo**: 16-day forecast per place.
4. **Trend engine** (the challenge's core): per place and per variable (rain, max temperature, humidity, soil wetness, fire count, and NDVI if the stretch lands), Mann-Kendall test with Sen's slope on two windows: 10 years of monthly means, and the last 90 days of daily values. Output: slope in units per year, direction, p-value, and a plain label such as "drying, significant". The 10-year slope answers "how much has changed"; the 90-day slope answers "what is changing now".
5. **Features per place per day**: 7/30/90-day rain and anomaly vs the place's own 10-year normal for that calendar window; temperature and humidity anomaly; soil wetness and 30-day change; fire weather index over the observed window and the next 14 days; detections in the last 7/30 days; days since last detection; the trend slopes; latitude, longitude, day-of-year.
   Forecast slots in training use POWER's observed next 14 days ("perfect prognosis") **(call)**; at inference they come from Open-Meteo. The honesty caption says so until two weeks of real published forecasts exist.
6. **Hazard modules**, one feature table, four outputs:
   | Hazard | Method | Output |
   |---|---|---|
   | Wildfire | XGBoost on 12 months of FIRMS labels (≥3 detections within 50 km in the next 14 days), time-ordered split, final 6 weeks held out, isotonic calibration. Baseline: fire weather index. | calibrated probability |
   | Drought | 30- and 90-day rainfall deficit vs normal, soil wetness anomaly, trend slope; standardised index with fixed categories | index with category |
   | Heat | forecast max temperature vs the place's own 95th and 99th percentiles, days above, heat index from temperature and humidity | days-above count and category |
   | Heavy rain | forecast 3-day and 7-day totals vs the place's own percentiles | probability of an unusually wet week, labelled "not a flood forecast" |
   Thresholds are per place from its own record, which is what the blueprint asks for and what makes a global version honest.
   Category lines live in `config.CATEGORY_THRESHOLDS`. Wildfire was reset on 14 Nov after the first real scoring run to 0.30 / 0.60 / 0.90: three or more detections in 14 days is common in the burning belts (label base rate 0.29), so the original 0.10 / 0.25 / 0.50 put a quarter of the world in "extreme". The probability is the honest number; the category marks what is unusual for the world right now (DESIGN.md §2). Heat needs at least 1 °C over the place's 95th percentile on the hottest day before "high" or "extreme" (Lima's 95th percentile is 25.3 °C).
7. **Risk record per place per hazard**: probability or index, **severity** (expected magnitude: forecast fire weather, deficit depth, degrees above threshold, millimetres), **exposure** (population within the radius), **confidence** (data completeness × held-out skill, three levels), valid window, model version, source records. The four are shown separately and never multiplied into one number without saying how.
8. **Risk history (call)**: each run scores the last 90 days of feature rows with the current model and writes a per-place series. Every run also appends the risk it actually published to a snapshot store; the honesty panel reads that store once it is two weeks old and the held-out hindcast until then, labelled.
9. **Alerts (call)**: events persisted in `feed.json`. A place raises one when a hazard crosses its high category upward, its risk is more than 2σ above its own 90-day mean, or a new |z| > 1.5 anomaly flag appears. One per place per hazard per 7 days. Fields follow the blueprint's alert record: id, hazard, place, issued, valid from and to, probability, severity, exposure, confidence, evidence records, explanation, status, model version. Seeded on the first run by replaying the last 30 days.
10. **Explain**: SHAP per place for wildfire, threshold reasons for the others, top drivers, sentence from a template. LLM rewrite is a stretch and may only reword structured numbers.
11. **Write** `places.json`, `trends.json`, `risk.json`, `fires_24h.json`, `feed.json`, `freshness.json`, `honesty.json`, `run.json` to an orphan data branch, then deploy.
12. **Schedule**: every 3 hours **(call)**. First cold run ~40 min, later runs under 15.

### 7.3 Dashboard, Next.js static export, GitHub Pages or Vercel free
Reads JSON from the data branch with a cache-buster. No server. Two modes, Now and Next 14 days, as the blueprint's horizons. See DESIGN.md.

### 7.4 Product language, from the blueprint
Four words, never mixed: **observation** (POWER, FIRMS), **forecast** (Open-Meteo), **risk assessment** (our hazard outputs), **trend** (Mann-Kendall result). Every panel shows valid time and retrieved time. The footer carries the safety statement: an informational tool, not an official warning service, follow local authorities.

## 8. Features by priority

High is the demo. Medium is what makes judges lean in. Low is the last six hours.

### High, green by the evening of day 1
| # | Feature | Done when | Est. hours |
|---|---|---|---|
| H1 | Place list, globe points coloured by the selected hazard or trend, hover name and value | points visible | 4 |
| H2 | Live FIRMS detections binned to 0.25°, refreshed by the cron | dots change between runs | 3 |
| H3 | POWER and Open-Meteo ingest with parquet cache, running in Actions | end to end under 15 min incremental | 6 |
| H4 | Trend engine: 10-year and 90-day Mann-Kendall per place per variable | `trends.json` with slope, p, label | 4 |
| H5 | Feature table and wildfire model with calibration and baseline | `risk.json`, PR-AUC above baseline | 6 |
| H6 | Drought, heat, heavy-rain modules from thresholds | four hazards per place | 5 |
| H7 | Trends ranked table and hazards ranked table, sortable, click flies the globe | both tables live | 5 |
| H8 | Selected place panel: trend chart, three anomaly series, four hazard cards with probability, severity, exposure, confidence, drivers, sentence | works for any place | 7 |
| H9 | Alert feed with the full alert record | updates each run | 3 |
| H10 | Freshness and sources panel with valid and retrieved times | real timestamps | 2 |
| H11 | Cron, run gates, data branch, static deploy | site updates by itself | 5 |
| H12 | Place search | typing a city selects it | 2 |

### Medium, day 2 morning
| # | Feature | Est. hours |
|---|---|---|
| M1 | GIBS imagery toggles with a 30-day date slider | 3 |
| M2 | Honesty panel: published vs observed by bucket, top-20 hit rate | 3 |
| M3 | Movers tables, up and down, per hazard and per trend | 2 |
| M4 | Continent breakdown bars and small multiples | 3 |
| M5 | Now / Next-14-days mode switch wired through the whole screen | 2 |
| M6 | AppEEARS NDVI per place, adds the vegetation trend | 4 |
| M7 | Shareable URL state | 1 |
| M8 | LLM rewrite of sentences with template fallback, numbers bound to the record | 3 |
| M9 | Dense Pakistan tier (~150 districts) with the app opening on Pakistan | 3 |

### Low, last six hours only
L1 parks and heritage sites as a point set · L2 compare two places · L3 CSV export · L4 30-day risk time-lapse · L5 Open-Meteo seasonal outlook as a display-only card · L6 Discord webhook alerts · L7 lag-correlation and seasonal calendar charts from the spike.

### Deferred to the post-hackathon roadmap, from the blueprint
FastAPI, PostGIS, Celery and Docker stack · flood screening with terrain and GloFAS · seasonal, annual, and CMIP6 climate projections · cyclone and severe storm · subscriptions, SMS, accounts · exposure beyond population (infrastructure, vulnerability layers).

## 9. Team: one reviewer, four Claude sessions (call)

The team is one person with ~16 hours across both days, reviewing, plus Claude Code sessions building in parallel. That changes the bottleneck from writing code to **integration and review**. Rules that follow from it:

1. **Contracts before code.** The first hour of day 1 is one session writing `docs/contracts.md`: the JSON schemas for every file in §7.2 step 11, the place id scheme, the repo layout, and the CSS tokens from DESIGN.md. Every other session reads it and does not change it without a note in the file.
2. **Four sessions, not six.** Each owns a directory and a branch. More sessions than that means more merge conflicts than code.
   | Session | Owns | Day 1 | Day 2 |
   |---|---|---|---|
   | S1 Ingest | `pipeline/ingest/`, `.github/workflows/`, data branch | H2, H3, H11 | honesty store, M9 Pakistan tier |
   | S2 Science | `pipeline/trend/`, `pipeline/model/`, `pipeline/hazards/`, JSON writers | H4, H5, H6, H9 | M2, M3, M4 data |
   | S3 Globe | `dashboard/src/components/Globe*`, search | H1, H12 | M1, M5, L4 |
   | S4 Panels | `dashboard/src/components/{tables,place,feed,freshness}` | H7, H8, H10 | M3, M4, M7, polish |
   One session at a time, S1 on day 1 and S4 on day 2, also acts as **integrator**: merges branches to main, runs the build, fixes the seams.
3. **Review by outcome, not by diff.** The reviewer's 16 hours go to: decisions, the first cold run, screenshots of each panel on real data, the run gates, the README, and the pitch. Reading diffs of four parallel sessions does not fit in 16 hours and is not where the value is.
4. **Every session ends with proof.** A session's handback must include: the build and lint passing, a screenshot or the JSON output, and what it did not finish. Nothing is "done" on description alone.
5. **Mock JSON on minute one.** S2 writes sample files matching the contracts in the first 30 minutes so S3 and S4 render against them while S1's cold run is still fetching.

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| POWER throttles 600 sequential requests | 1 req/s with retries; only the first run is big; start with 200 places if blocked |
| FIRMS history too large | MODIS_SP instead of VIIRS, 6 months instead of 12 |
| Wildfire model weak on 12 months | ship the fire weather index as the risk, model as a toggle; UI unchanged |
| Trend test noisy on 90 days | show only p < 0.1 as a label; always show the 10-year one |
| POWER's newest ~6 weeks come from a different model (near-real-time GEOS, not MERRA-2) and soil wetness, wind and humidity step on the switch day for every place at once (seen 2026-10-01: soil −0.05, wind −19 %) | `trend/load.power_step` detects the step each run and removes a per-place offset; every reader goes through `load_power`. Found and fixed 14 Nov. |
| Actions cron drifts | manual dispatch; demo on the last good run |
| Open-Meteo quota at higher tiers | forecast every 2nd run |

## 11. Success at demo time

- Freshness panel: every source within 24 h, FIRMS within 6.
- A judge names a city; it is found, scored, and has a trend.
- The trends table holds at least one place in a known multi-year drying or warming story, and the hazards table at least one place in the news.
- The honesty panel shows the model above baseline over the last two weeks.
- Every number on screen has a valid time, a source, and a label saying which of the four kinds it is.

## 12. Open decisions for the team

1. Hindcast on screen until the cron is two weeks old: show it labelled (recommended) or leave panels empty?
2. Pre-pulling data caches before the clock starts: allowed under the rules or not? Check the text.
3. Hosting: GitHub Pages or Vercel?
4. LLM in scope at all? Template text is enough for the demo.

## 13. Runs, gates, tiers, freeze

### 13.1 Gates
A run is one pipeline execution. It grades itself and writes `run.json`; any failed gate skips the deploy.

| Gate | Pass condition |
|---|---|
| G1 Time | incremental < 15 min; first cold run < 60 min |
| G2 Coverage | ≥ 98% of places have POWER through 4 days ago, a full forecast, and a FIRMS count |
| G3 Freshness | FIRMS ≤ 6 h, POWER ≤ 4 days, forecast ≤ 12 h |
| G4 Sanity | FIRMS world/1 > 1,000 rows; risks in [0, 1]; no NaN; risk std across places > 0.01; trend p-values in [0, 1] |
| G5 Model | held-out PR-AUC above the fire-weather baseline, Brier at or below it |
| G6 Output | every JSON under 5 MB; `generated_at` newer than the previous run |
| G7 Deploy | the live `run.json` returns the new run id |

### 13.2 Tiers
| Tier | Places | Forecast refresh |
|---|---|---|
| 1 | capitals + cities over 1M, ~600 | every run |
| 2 | + cities over 300k, ~1,500 | every 2nd run |
| 3 | + parks and heritage sites, ~2,500 | every 4th run |

Climb only after three green runs, last run under 10 min, forecast quota projection under 80%, and before 12:00 on day 2. Climb on a branch with a manual run; merge on green; revert is one line. Pipeline code freezes at 15:00 on day 2.

## 14. Schedule and honest estimate, one reviewer plus four sessions

Event: Saturday 14 to Sunday 15 November 2026. Reviewer time: ~8 hours each day. Session time is not the constraint; integration and review are.

Reference point: the synthetic spike, a full pipeline plus the globe dashboard, took one session a few hours. The High tier is roughly three spikes of work spread over four sessions, so the code fits in day 1. What does not compress is waiting: the cold run (~40 min), the cron cadence, API pacing, and real-data surprises. Budget 25% of every block for those.

| Tier | Sessions × hours | Reviewer hours | Verdict |
|---|---|---|---|
| High (H1–H12) | 4 × ~5 h | ~6 h | yes, day 1 |
| Medium M1–M5, M7, M9 | 3 × ~3 h | ~4 h | yes, day 2 morning |
| Medium M6 AppEEARS, M8 LLM | | | **cut**: async and risky for a one-reviewer team |
| Low | | ~1 h | L4 time-lapse only, if everything is green by 13:00 day 2 |
| README, pitch, rehearsal | 1 × 2 h | ~4 h | day 2 afternoon |

| Day 1, reviewer present ~8 h | |
|---|---|
| 09:00 | S1 creates repo, secrets, skeleton, and `docs/contracts.md` (one session, 1 h). Reviewer answers §12 decisions. |
| 10:00 | S1 starts the cold run in Actions. S2 writes mock JSON, then the trend engine. S3 and S4 start on the mocks. |
| 12:00 | Reviewer checkpoint 1: cold run green? globe with points? Decide tier if the run was slow. |
| 14:00 | S2 has real `trends.json` and `risk.json`. S3 and S4 switch from mocks to real. |
| 16:00 | Reviewer checkpoint 2: screenshots of every High panel on real data. S1 merges, first full cron deploys. |
| 18:00 | All High green or explicitly cut. Cron runs unattended overnight. |

| Day 2, reviewer present ~8 h | |
|---|---|
| 09:00 | Reviewer checks overnight runs in the freshness panel. Three sessions on Medium. |
| 12:00 | Tier 2 decision per §13.3. Reviewer checkpoint 3. |
| 15:00 | Pipeline freeze. One session on polish, one on README. Reviewer writes the pitch from the live site. |
| 17:00 | Rehearsal on the live site. Submission. |

The single biggest risk is unchanged: if the cold run has not started by 11:00 on day 1, everything slips half a day. The second biggest is new: four sessions editing one repo without a contract. Hour one exists to prevent it.
