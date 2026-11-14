# PRD · Earth System Trend Detective (global, live)

NASA Space Apps 2026 · 48-hour build · team of four · fresh repo on day 1.
Written 13 Nov 2026 as preparation. Supersedes the regional synthetic spike in this folder.

Reviewer note: anything marked **(call)** is a decision I made for you, not something the team agreed. Change it freely.

---

## 1. One-liner

A live globe that watches ~600 places on Earth, scores each one every few hours for wildfire risk over the next 14 days using NASA observations plus a public weather forecast, flags the places that are drifting away from their own normal, and explains why in a sentence.

## 2. Why this, why now

The challenge asks for trend and anomaly detection across connected Earth systems. Most hackathon entries show a static map of last year's data. Ours is a system that is running during the judging: fire detections from the last three hours are on the globe, every location's risk was recomputed this morning, and the forecast reaches two weeks past today. Judges can look up their own city.

## 3. Goals, non-goals, anti-goals

**Goals**
- Live. Every number on screen was computed in the last few hours from free public APIs. A visible "updated 2h ago" stamp.
- Global. Every continent, both hemispheres, ~600 named places.
- Predictive. The headline number is risk for the next 14 days, not a replay of the past.
- Explainable. Every alert has a driver list and a sentence.
- Data-dense. Tables and charts carry the story; the globe is the hook.
- Free. No paid API, no credit card anywhere in the stack.

**Non-goals**
- Multi-year backtests, academic evaluation, gridded risk over whole countries.
- Mobile layout. It is a desktop demo on a projector.
- Accounts, auth, user settings, notifications.
- Pixel-level fire perimeters or evacuation guidance.

**Anti-goals (what would make it a failure even if it runs)**
- A dashboard that only works on the one laptop with the data.
- A pipeline that needs a human to click AppEEARS during the demo.
- "Orange blocks over half of America." Points, not fills.
- Predictions with no honesty check at all. One small "last week's calls vs what happened" panel keeps it credible.

## 4. Users and the moment

A judge with 4 minutes. They see the globe turning with live fire detections, a ranked table of the ten places most at risk this fortnight, click one, and get the anomaly charts and the sentence. Then they type their city into the search box.

## 5. The product in one screen

```
┌───────────────────────────────────────────────┬──────────────────────────────┐
│  Earth System Trend Detective                 │ KPI  KPI  KPI  KPI           │
│  live · 612 places · updated 2h ago           │ (places on watch, fires 24h, │
│                                               │  forecast window, last-week  │
│      ┌──────── globe ─────────┐               │  hit rate)                   │
│      │  • points sized/coloured│              │──────────────────────────────│
│      │    by 14-day risk       │              │ TOP RISK · table, ranked,    │
│      │  ✦ live FIRMS fires     │              │ sparkline + Δ vs last week   │
│      │    (last 24h, binned)   │              │──────────────────────────────│
│      │  ▒ optional GIBS layer  │              │ SELECTED PLACE               │
│      │    (rain / NDVI / LST)  │              │  fire-weather curve 14 d     │
│      └────────────────────────┘               │  rain / temp / soil vs normal│
│  [search a place]  [layer toggles]            │  drivers (SHAP) + sentence   │
│  [continent filter]                           │──────────────────────────────│
│                                               │ MOVERS · biggest Δ this week │
│                                               │ CONTINENT BREAKDOWN · bars   │
│                                               │ LIVE FEED · alerts, newest   │
│                                               │ HONESTY · last week vs truth │
│                                               │ DATA FRESHNESS · per source  │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

## 6. Data sources (all free, all verified 13 Nov)

| Need | Source | Access | Latency | Key? | Cost |
|---|---|---|---|---|---|
| Fire detections, live and 12 months history | NASA FIRMS | `/api/area/csv/{KEY}/{SOURCE}/world/{1..10}` and `/…/world/10/{DATE}` | ~3 h (NRT) | MAP_KEY, free | 5000 req / 10 min |
| Daily weather observations per place, 40-yr history | NASA POWER | `/api/temporal/daily/point?parameters=T2M,T2M_MAX,PRECTOTCORR,RH2M,WS2M,GWETROOT,GWETTOP&community=AG&longitude=&latitude=&start=&end=&format=JSON` | ~2 days | none | no hard limit; be polite (~1 req/s) |
| Weather forecast next 16 days per place | Open-Meteo | `/v1/forecast?latitude=&longitude=&daily=temperature_2m_max,precipitation_sum,relative_humidity_2m_min,wind_speed_10m_max&forecast_days=16` | real time | none | <10k/day, 600/min, non-commercial |
| Rain, NDVI, LST imagery layers on the globe | NASA GIBS WMTS | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{LAYER}/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level{N}/{z}/{y}/{x}.png` | 1 to 8 days by layer | none | unlimited |
| Vegetation index per place (stretch) | AppEEARS point sample, MOD13A2.061 | REST, async, minutes for 600 points | 16-day product | Earthdata login | free |
| Place list | Natural Earth `ne_10m_populated_places` | one static file | n/a | none | public domain |

**Why POWER instead of raw IMERG and MODIS LST for the per-place numbers (call):** POWER's precipitation already comes from GPM IMERG and its temperature from MERRA-2, it is point-based, needs no login, and one request returns a 10-year daily history for anomaly baselines. Raw IMERG and MODIS stay in the product as GIBS layers on the globe, so the NASA sources named in the challenge are visibly used. AppEEARS NDVI is a stretch because it is asynchronous and the only piece that can stall.

## 7. How it works

### 7.1 Places
~600 points **(call)**: all national capitals plus populated places over 500k from Natural Earth, deduplicated within 50 km. Each place has a 50 km watch radius. Day 2 stretch adds "structures": UNESCO World Heritage sites and large national parks, if a free list is quick to find.

### 7.2 Pipeline (Python, runs in GitHub Actions on a cron)
GitHub Actions has fast network and a free 2,000 minutes per month, so no download ever touches a teammate's laptop.

1. **FIRMS**: pull `world/1` for VIIRS_SNPP_NRT (live dots) and MODIS_NRT (counts). Count detections within 50 km of each place with a KD-tree. Append to a parquet keyed by place and date. One-time history: MODIS_SP world in 10-day chunks for the last 12 months, ~37 requests.
2. **POWER**: for each place, fetch from the last cached date to today. First run fetches 10 years. Cache as parquet in the repo's data branch.
3. **Open-Meteo**: 16-day daily forecast per place. One request each, ~600 requests, under the limit.
4. **Features per place per day**: 7/30/90-day rain totals and their anomaly vs the place's own 10-year normal for that calendar window; temperature and humidity anomaly; soil wetness and its 30-day change; a simple fire weather index (temp, humidity, wind, days since rain) over the observed window and over the next 14 days; detections in the last 7/30 days; days since last detection; latitude, longitude, day-of-year sin/cos.
   **Forecast features in training (call):** historical rows have no archived 14-day forecast, so training uses POWER's *observed* next 14 days in the forecast slots ("perfect prognosis"). At inference the slots are filled from Open-Meteo. This is the standard approach; it means the hindcast overstates skill slightly, and the honesty panel says so in its caption until it has two weeks of genuinely published forecasts.
5. **Label**: at least 3 MODIS detections within 50 km in the following 14 days. Filter FIRMS `type` to vegetation fires so flares and volcanoes do not label cities.
6. **Model**: XGBoost, trained on the last 12 months of place-days where the label is known, time-ordered split with the final 6 weeks held out. One model for the whole globe; latitude and day-of-year let it learn hemispheres. Output is calibrated to a probability (isotonic on the held-out weeks) and that probability is what the UI shows as "risk %". Retrain daily, score every 3 hours.
7. **Risk history (call):** the repo is two days old at judging, so every "vs last week" number comes from a **hindcast**: each run scores the last 90 days of feature rows with the current model and writes a per-place daily series. `risk.json` is therefore a time series per place (90 days back, one headline number for the next 14 days), not a scalar. Separately, every run appends the risk it actually published to a snapshot store in the data branch; the honesty panel reads that store once it is two weeks old and, until then, the held-out 6 weeks of the hindcast, labelled "held-out hindcast".
8. **Anomaly flags**: z-score of each driver vs the place's own history, flag at |z| > 1.5. **Trend**: Mann-Kendall test with Sen's slope on the last 90 days of soil wetness and rain anomaly per place.
9. **Alerts (call):** an alert is an *event*, persisted in `feed.json` across runs. A place raises one when its 14-day risk crosses 40% upward, or its risk is more than 2σ above its own 90-day hindcast mean, or a new |z| > 1.5 anomaly flag appears on a driver. One event per place per 7 days. The feed shows the newest 50. On the first run the feed is seeded by replaying these rules over the last 30 days of the hindcast so it is never empty during the demo.
10. **Explain**: SHAP per place, top 5 drivers. Sentence from a template; an LLM rewrite is a stretch.
11. **Write** `places.json`, `risk.json`, `fires_24h.json`, `feed.json`, `freshness.json`, `honesty.json` to the `data` branch (orphan branch, force-pushed, so the repo does not bloat), then trigger the site deploy. Split `risk.json` per continent if it passes 3 MB.
12. **Schedule**: every 3 hours **(call)**. FIRMS NRT updates about that often; everything else is daily. The first run on a cold cache takes ~30 to 40 min (600 places × 10 years of POWER at 1 req/s, plus 12 months of FIRMS). Every later run is incremental and should finish under 15 min.

### 7.3 Dashboard (Next.js static export, GitHub Pages or Vercel free)
Fetches the JSON from the data branch via raw.githubusercontent, which allows cross-origin reads. No server. See DESIGN.md for the look and the chart grammar.

### 7.4 Honesty check
Each run keeps the risk it published 14 days ago and compares to what FIRMS then observed. Shown as one small panel: predicted vs observed by risk bucket, plus "of the top 20 we flagged two weeks ago, N had fire." Small, but it is the difference between a demo and a toy.

## 8. Features by priority

High means the demo fails without it. Medium is what makes judges lean in. Low is for the last six hours if everything else is green.

### High (day 1, must all be green by the evening of day 1)
| # | Feature | Done when |
|---|---|---|
| H1 | Place list with 600 points, globe renders them as points sized and coloured by risk | points visible, hover shows name and risk |
| H2 | FIRMS live detections on the globe, binned to 0.25°, refreshed by the cron | dots change between two runs |
| H3 | POWER and Open-Meteo ingest for every place with parquet cache | pipeline runs end to end in Actions under 15 min |
| H4 | Feature table, XGBoost, 14-day risk per place | risk.json produced, PR-AUC beats the fire-weather-index baseline |
| H5 | Ranked table of top-risk places with a sparkline of the last 14 days of hindcast risk and Δ vs 7 days ago | sortable by column, click flies the globe |
| H6 | Selected place panel: headline 14-day probability, a daily fire-weather curve for the next 14 days from the forecast (today marked), three anomaly series vs normal band, SHAP drivers, sentence | works for any clicked place |
| H7 | Live alert feed, newest first, with anomaly chips | updates each run |
| H8 | Freshness panel: per source, last fetch time and record count | shows real timestamps |
| H9 | Cron on GitHub Actions and static deploy | site updates without anyone touching it |
| H10 | Search box for a place | typing a city name selects it |

### Medium (day 2 morning)
| # | Feature | Why |
|---|---|---|
| M1 | GIBS imagery toggles on the globe: IMERG precipitation, MODIS NDVI, MODIS LST, with a date slider for the last 30 days | puts raw NASA imagery on screen for about 40 lines of code |
| M2 | Honesty panel (section 7.4) | credibility |
| M3 | Movers table: ten places with the largest risk rise and fall this week | tells the "trend" story in one table |
| M4 | Continent breakdown: stacked bars of places by risk bucket per continent, and a small-multiples row of each continent's mean risk over 90 days | global story at a glance |
| M5 | Mann-Kendall trend badge per place ("drying 90 days, p<0.05") | the literal trend detective |
| M6 | AppEEARS NDVI point sample, weekly | adds the vegetation leg of the chain |
| M7 | Shareable URL state (`?place=nairobi`) | judges can send a link |
| M8 | LLM rewrite of alert sentences via a free-tier model, template fallback | nicer prose, zero risk if it fails |

### Low (last six hours, only if everything above is green)
| # | Feature |
|---|---|
| L1 | Structures layer: UNESCO sites and large national parks as a second point set |
| L2 | Compare two places side by side |
| L3 | Export the current table as CSV |
| L4 | Drought mode: swap the headline to a 30-day soil-moisture-deficit score with its own ranking |
| L5 | Time-lapse of the last 30 days of risk on the globe |
| L6 | Push alerts to a Discord webhook from the cron |

## 9. Team split (call)

| Who | Day 1 | Day 2 |
|---|---|---|
| Pipeline A | FIRMS + POWER + Open-Meteo ingest, parquet cache, Actions cron | honesty check, Mann-Kendall, AppEEARS |
| Pipeline B | features, model, SHAP, JSON writers | movers, continent aggregates, LLM text |
| Frontend A | globe, points, live fires, search, fly-to | GIBS layers, time-lapse |
| Frontend B | tables, place panel, charts, feed, freshness | movers, continent charts, URL state, polish |

Pitch and README are everyone's from 14:00 on day 2.

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| POWER throttles 600 sequential requests | run at 1 req/s with retries; cache means only the first run is big; if blocked, start with 200 places |
| FIRMS history download too large | use MODIS_SP (smaller than VIIRS) and 6 months instead of 12 |
| Model is weak with 12 months of labels | ship the fire weather index as the risk with the model as a "beta" toggle; the UI does not change |
| GitHub Actions cron drifts or queues | also allow manual dispatch; demo with the last good run |
| Open-Meteo terms | non-commercial use is explicitly allowed; cite it |
| Globe performance with 600 points and 20k fire bins | points as a circle layer with feature-state, fire bins as a heatmap layer; both are GPU-side |

## 11. Success at demo time

- The freshness panel shows every source updated within the last 24 hours and FIRMS within 6.
- A judge names a city and it is found and scored.
- The top-risk table contains at least one place that is currently in the news for fire or drought.
- The honesty panel shows the model beating the baseline over the last two weeks, even modestly.

## 12. Open decisions for the team (answer before day 1 starts)

1. **Hindcast on screen.** Every "vs last week" number and the honesty panel come from scoring the past with today's model until the cron has run for two weeks. Acceptable for the demo if labelled, or should those panels stay empty until real? My recommendation: show the hindcast, label it.
2. **What may happen before the clock starts.** Credentials, package caches, and reading are clearly fine. Pre-pulling the 10-year POWER history and 12 months of FIRMS into a cache is a grey area under "no work before the event". If allowed, the pipeline has real rows within the first hour of day 1. If not, budget 40 min for the first cold run. Check the rules text.
3. Hazard framing: wildfire risk as the headline with drought as a driver and an optional mode (my recommendation), or two equal headlines?
4. Place count: 600 (recommended) or go to 1,500 and accept a slower first run?
5. Hosting: GitHub Pages (simplest, same repo) or Vercel (nicer URL, previews)?
6. Is an LLM in scope at all, given "all free"? Template text alone is fine for the demo.

## 13. What a successful run is, and how we scale up

### 13.1 A "run" and its gates
A run is one execution of the pipeline job in GitHub Actions, scheduled or manual. The pipeline checks its own gates at the end and writes `run.json`. If any gate fails the job exits non-zero and **the deploy step does not execute**, so the site keeps the last good data. The freshness panel shows the last 10 runs as green or red dots with the failing gate's name on hover.

| Gate | Pass condition | Why |
|---|---|---|
| G1 Time | incremental run < 15 min; the first cold run < 60 min | keeps the 3-hourly schedule honest |
| G2 Coverage | ≥ 98% of places have POWER data through 4 days ago, a full 16-day forecast, and a FIRMS count | a place with holes gets a wrong risk |
| G3 Freshness | FIRMS ≤ 6 h old, POWER ≤ 4 days, forecast ≤ 12 h | the "live" claim on screen is true |
| G4 Sanity | FIRMS world/1 returned > 1,000 rows; all risks in [0, 1]; no NaN; risk standard deviation across places > 0.01 | catches an empty CSV or a collapsed model |
| G5 Model | on the held-out 6 weeks: PR-AUC above the fire-weather-index baseline, Brier at or below it | the model earns its place or the index ships instead |
| G6 Output | every JSON under 5 MB; `generated_at` newer than the previous run's | the site can load it |
| G7 Deploy | after deploy, a fetch of the live `run.json` returns the new run id | what the judges see is what we built |

`run.json` holds: run id, tier, place count, start and end time, each gate's value and pass/fail, and the model metrics. Runs append to `runs.jsonl` in the data branch for the panel.

### 13.2 Tiers
One constant in config, `PLACE_TIER`:

| Tier | Places | Roughly | Forecast refresh |
|---|---|---|---|
| 1 | national capitals + cities over 1M | ~600 | every run |
| 2 | tier 1 + cities over 300k | ~1,500 | every 2nd run |
| 3 | tier 2 + large national parks + UNESCO natural sites | ~2,500 | every 4th run |

Day 1 ships tier 1. Nothing else in the code knows about tiers.

### 13.3 When we may climb a tier
All four must be true:
1. Three consecutive green runs at the current tier.
2. The last incremental run took under 10 minutes, leaving headroom for the new places.
3. Projected Open-Meteo calls per day at the next tier are under 8,000 (80% of the limit).
4. It is before 12:00 on day 2. After that the pipeline is frozen for the demo.

### 13.4 How to climb
1. Branch, bump `PLACE_TIER`, push.
2. Trigger the pipeline manually with `workflow_dispatch` on that branch. The POWER cache means only the new places are fetched, so a tier 1 to 2 climb pulls ~900 histories, about 55 min.
3. Watch that run's `run.json`. All gates green means merge; the cron continues at the new tier.
4. Any gate red means do not merge. The main branch and the site are untouched. Fix or abandon.
5. Rollback after a merge is a one-line revert. The cached extra places stay in the data branch harmlessly.

### 13.5 Freeze
At 15:00 on day 2 the pipeline code is frozen. The cron keeps running, but nobody changes the tier, features, or model. The last six hours are for the UI, the README, and the pitch, against data that is not moving under us.
