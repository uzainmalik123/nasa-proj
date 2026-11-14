# S4-B handback · place panel + feed

Branch `s4-panels`, worktree `../nasa-project-s4` (origin/main merged, S3's globe in the shell). Builds on S4-A.

## What works (proof: `docs/handback/s4b/*.png`, headless Chromium on `npm run build` static export, zero page errors in every shot)

| Screenshot | Data | State | Shows |
|---|---|---|---|
| `place-luanda-wildfire.png` | mocks | `?mode=next14&hazard=wildfire&var=rain_mm&selected=3` | the whole PlacePanel: TrendChart (10-y monthly rainfall, Sen's slope dashed, mono label `→ +1.4 mm/yr · p=0.79`; 90-day inset `↓ −1.0 mm/yr · p=0.04`), one chip per other variable with its own 10-y label, three AnomalySeries (30-day rain, max temperature, soil wetness vs the ±1σ normal band, red-ringed flags at \|z\| > 1.5, cursor on the last day), four HazardCards (46 % / +0.7 / 1 d / 1 %, each with category chip, severity, exposure, confidence, valid window, coloured left border), SHAP DriverBars for wildfire (orange raises, blue lowers, mono SHAP at bar end, feature value at right), the sentence |
| `place-luanda-drought-drivers.png` | mocks | `hazard=drought&var=soil_wet` | same panel with the drought card selected: soil-wetness trend, threshold reasons instead of SHAP, drought sentence |
| `feed.png` | mocks | – | Feed: newest first, hazard dot (pulse ring on the newest), place · cc · hazard, headline (p for wildfire/rain, severity for heat/drought), category chip, issued UTC, trigger, anomaly chips (`rain` `soil` `tmax`), `updated` status chip, valid window, explanation |
| `full-feed-scrolled.png` | mocks | after clicking the Nairobi heat alert | alert row ringed, place panel switched to Nairobi with the **heat** card selected and heat reasons shown, globe flown to it, hazard select = heat |
| `place-kinshasa-real-trends.png`, `full-real-trends-kinshasa.png` | **S2's real `trends.json`** (run `20261114T0852Z`, 554 places) + `places.json` built from S2's `places.parquet`; everything else still mock | `?mode=now&var=tmax_c&selected=2` | Kinshasa max temperature `↑ +0.13 °C/yr · p<0.001` with the Sen's line through 120 real monthly means; humidity `↓ −0.36 pct/yr`, soil `↓ −0.021 frac/yr`, fires `insufficient data` (108 of 120 months null, handled); Trends table over 554 real places, Dallas +0.54 °C/yr on top |

- `npm run lint` → 0 problems. `npm run build` → compiled, TypeScript clean, static export.
- Built with `NEXT_PUBLIC_DATA_URL=/real` for the real-data shots, served from `out/real/`. The published data branch holds only `out/freshness.json` as of 14:30 UTC, so `risk.json`, `series.json`, `feed.json` are not testable on real rows yet; the code reads only the contract shapes in `types.ts` and S2's real `trends.json` loaded without changes.

## Files (all inside S4's directories)

- `charts/chart.ts` – pure helpers: Sen's line (median-residual intercept), y domain/ticks, z-score, nearest-point index.
- `charts/TrendChart.tsx` – DESIGN §5 trend chart: long window + inset, dashed Sen's line in both, hover tooltip with observed and fitted value.
- `charts/AnomalySeries.tsx` – line over ±1σ band, dashed normal, flags, cursor, tooltip with value / normal / z.
- `charts/DriverBars.tsx` – diverging SHAP bars, plus `ReasonList` for the threshold hazards.
- `panels/HazardCard.tsx` – the card, `fmtSeverity` (unit per contract §3), `fmtWindow`.
- `panels/Feed.tsx` – the feed.
- `panels/PlacePanel.tsx` – composition; `Dashboard.tsx` passes `hazard`, `onHazard`, `onTrendVar` and a `pickAlert` handler.

## Calls I made (change freely)

1. **90-day inset reads `series.json`** because `trends.json` has no daily values: rain_mm → `rain_30d` (labelled "30-day total"), tmax_c → `tmax`, soil_wet → `soil_wet`, fires → `fires_7d`. Humidity and wind have no daily series, so the inset is omitted and a note says the 90-day slope is the pipeline's. The 90-day Sen's line is drawn from `trends.short.slope` through those values.
2. **One TrendChart, not six stacked.** The aside is 560 px; six 150 px charts would push the hazards off screen. The selected variable gets the chart, the other five get a chip with their 10-y label and switch the app's `trendVar` (without changing mode).
3. Sen's intercept is the median residual, the Theil–Sen definition, so the dashed line sits through the data instead of starting at the first point.
4. **Clicking a hazard card sets the app hazard** (globe and hazards table follow). Clicking an alert sets place + hazard, switches to `next14`, flies the globe.
5. Feed headline: probability for wildfire/rain, severity for heat/drought (the category chip is already on the row). The feed respects the continent filter and caps at 50 rows, scroll inside at ~7.
6. Anomaly flags at |z| > 1.5, the PRD's alert threshold. Time cursor on the last observed day.
7. Variable colours: rainfall, humidity and soil are blue (moisture), max temperature yellow, fires orange, wind `ink2`; no new colours.
8. The mock `risk.json` carries a bogus heat reason ("peak 42107 C"); displayed as published, not my data.

## Not done

- Real `risk.json` / `series.json` / `feed.json` not yet on the data branch → hazard cards, anomaly series, drivers and feed proven on mocks only. Re-run the three mock shots against the data branch once S2 publishes; no code change expected.
- Movers, continent bars, honesty panel, two-way URL state (M3, M4, M2, M7) – day 2.
- No unit tests; proof is lint + build + screenshots.

## Contract notes

None. `contracts.md` and `types.ts` untouched.

---

## Addendum · 2026-11-14 15:10 · wildfire category thresholds 30 / 60 / 90 % (S2-B note 10:05)

Follow-up applied on `s4-panels` (commit after `1ffea3a`), in S4's files plus the shared `lib/palette.ts`. S3's `globe/colour.ts` and `globe/Legend.tsx` are not touched (S3's directory); they must get the identical `CATEGORY_V` and the legend labels, see "For S3" below.

### 1. `CATEGORY_V` · `components/charts/ramp.ts`

| category | before | after | why |
|---|---|---|---|
| low | 0.03 | 0.03 | unchanged, below the first stop so it stays muted |
| elevated | 0.30 | **0.30** | `CATEGORY_THRESHOLDS["wildfire"].elevated` |
| high | 0.55 | **0.60** | `…high` |
| extreme | 0.85 | **0.90** | `…extreme` |

New export `WILDFIRE_THRESHOLDS_PCT` = `"30 / 60 / 90 %"` derived from `CATEGORY_V`, so a legend cannot drift from the mapping.

### 2. `RISK_STOPS` · `lib/palette.ts` (colours unchanged)

| stop | before | after | = |
|---|---|---|---|
| 0 | 0.00 | 0.000 | transparent end |
| 1 | 0.05 | **0.150** | 50th pct of today's wildfire p |
| 2 | 0.20 | **0.590** | 80th |
| 3 | 0.40 | **0.920** | 95th |
| 4 | 0.65 | **0.995** | 99th |
| 5 | 1.00 | 1.000 | bright end |

Verified against the real `risk.json` (run `20261114T0949Z`, 554 places): categories low 375 · elevated 76 · high 70 · extreme 33; percentiles 50/80/95/99 = 0.153 / 0.594 / 0.924 / 0.995. Matches the follow-up's numbers.

### 3. Where S4 quotes thresholds

Nothing in S4 quoted the old 10 / 25 / 50 numbers. The HazardsTable caption now reads, derived from the two constants:
- `risk ramp 15 · 59 · 92 · 99.5 % = 50 / 80 / 95 / 99th percentile of today's wildfire p`
- `… elevated / high / extreme at 30 / 60 / 90 %` (wildfire unit note, also the column tooltip)

Side effect fixed: with the new stops the ramp colour at 0.30 and 0.60 is too dark to use as chip *text*. Added `CategoryChip` (`panels/ui.tsx`): a dot in exactly `riskColour(CATEGORY_V[cat])` (low = muted, extreme glows) with the label in `ink-2`. Used in HazardsTable, HazardCard and Feed; the dot colour equals the globe point colour for the same category.

### 4. Screenshots on the real files (`../nasa-project-s2/pipeline/data/out/`, wildfire selected)

`run.json` is not written by S2 (the gates stage owns it), so one was synthesised from `risk.meta` + `honesty.runs[0]` for the build; that is why the KPI tile says `0/0 gates`. `fires_24h.json` is still the mock (S1's file). Everything else is S2's real output.

| Path | Shows |
|---|---|
| `s4b/real-full-wildfire-bamako.png` | full screen, `?mode=next14&hazard=wildfire&selected=28`: globe with the new stops, Hazards table 554 places, Bamako selected |
| `s4b/real-hazards-table-wildfire.png` | Hazards table: 19 of the 33 extreme rows at 94–100 %, ramp bars and 14-day hindcast fills in the new colours, category dots, caption quoting 15 · 59 · 92 · 99.5 % and 30 / 60 / 90 % |
| `s4b/real-place-bamako-wildfire.png` | PlacePanel on real rows: rainfall trend (10 y → 0.000 mm/yr p=0.76; 90 d ↓ −20 mm/yr p<0.001 on the 30-day total), max temperature +1.3σ with flagged days, hazard cards 100 % extreme / −0.6 elevated / 0 d low / 0 % low, five real SHAP drivers (detections in the last 30 days +1.66 top), the published sentence |
| `s4b/real-feed.png` | real feed: 50 alerts, Lima heat (capped at elevated, 0.2 °C over threshold), Santiago wildfire 94 %, Khartoum drought 65 % deficit, Porto Alegre rain 88 % |

**Globe:** with the new stops the globe reads as calm over Europe, the Americas' north and East Asia (small muted dots), the ~33 extreme places are the bright yellow points (Sahel, Kuwait/Iraq, India, NE Brazil, Perth), and the ~70 high places form an orange band over India and the Sahel. Calm except where it matters, but the orange band in South Asia is dense enough that "except the ~33 extreme places" is only true at the yellow level.

### For S3 (not done here, their files)

- `globe/colour.ts` `CATEGORY_V` → `{ low: 0.03, elevated: 0.30, high: 0.60, extreme: 0.90 }` (currently 0.03 / 0.30 / 0.55 / 0.85 on `origin/s3-globe`).
- `globe/Legend.tsx` still labels the ramp `0 / 50 / 100 %`; DESIGN §2 wants the stop values: `0 · 15 · 59 · 92 · 99.5 · 100 %`. `RISK_STOPS` itself is already shared via `lib/palette.ts`, so the globe points in the screenshots above already use the new stops.
