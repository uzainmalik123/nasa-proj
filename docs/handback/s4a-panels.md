# S4-A handback · tables + freshness

Branch `s4-panels`, worktree `../nasa-project-s4`. Built against the 20-place mocks in `dashboard/public/data`. `origin/main` and `origin/s3-globe` are merged in, so the real `<Globe/>` renders inside the shell.

## What works (proof: `docs/handback/s4a/*.png`, 1920×1080 headless Chromium on `npm run build` static export, zero page errors)

| Screenshot | State | Shows |
|---|---|---|
| `full-next14-wildfire.png` | `?mode=next14&hazard=wildfire&selected=3` | KPI row, Hazards table (19 rows after the continent filter = world; rank, place, cc, p 14d mono + ramp bar, 14-day hindcast sparkline with ramp fill, Δ 7d chip, category chip with confidence dots, population), Trends table under it, selected row ring on Luanda, globe flown to it |
| `full-now-rain-trend.png` | `?mode=now&var=rain_mm&selected=3` | Trends table first (rank by \|slope\| with significant places first, 10-y Sen's slope mono + diverging bar orange/blue/grey, p, 12-month rolling-mean sparkline, Δ 90d chip), hover tooltip on a sparkline ("12 mo to Feb 24 · 55.4 mm") |
| `full-sources-scrolled.png` | `?mode=next14&hazard=drought`, aside scrolled to the bottom | Selected-place stub, **Freshness** (source, last fetch relative, budget, records, green/amber/red dot; run id, generated time, 6/6 gates) and **Sources** (source, kind chip, valid for, retrieved at, status dot; plus our own Trend engine and Hazard modules rows labelled `trend` / `risk assessment`), footer safety line |

Text pulled from the rendered Sources panel (valid / retrieved, UTC):

```
NASA FIRMS   VIIRS_NOAA21_NRT   OBSERVATION   2026-11-14 00:38   2026-11-14 03:30
NASA POWER   daily point, AG    OBSERVATION   2026-11-11 03:38   2026-11-14 03:20
Open-Meteo   16-day daily       FORECAST      2026-11-14 02:38   2026-11-14 03:26
NASA GIBS    IMERG · LST · NDVI OBSERVATION   2026-11-13 03:38   2026-11-14 03:12
Natural Earth ne_10m_populated_places OBSERVATION 2026-11-13 21:38 2026-11-14 03:06
Trend engine  Mann-Kendall + Sen's slope · 10y & 90d  TREND  2026-11-01 00:00  2026-11-14 03:38
Hazard modules xgb_wildfire … PR-AUC 0.31 vs 0.19  RISK ASSESSMENT  2026-11-14 00:00  2026-11-14 03:38
```

- `npm run lint` → 0 problems. `npm run build` → compiled, TypeScript clean, static export of `/`.
- **Dashboard.tsx** owns all app state per contracts §5: `mode, hazard, trendVar, selected, continent, flyTo` (+ S3's `gibsLayer, gibsDate`). Globe gets props and `onSelect` only. Reads `?mode=&hazard=&var=&continent=&selected=&gibs=&date=` on load (one-way; M7 makes it two-way).
- Layout per DESIGN §3: globe column flex 1.15 with title block + status pill ("live · updated 5h ago", green ≤ 6 h else amber "stale") + controls (mode toggle, hazard, trend variable, region, imagery); 560 px aside, only thing that scrolls.
- Tables per DESIGN §5: 28 px rows, 11 px, mono numbers right-aligned, border-only separation, sticky sortable headers with a thin caret (every column except the sparkline), ramp bar 40×4, sparkline 64×16 at 1.2 px, Δ chip orange/blue, scroll inside at ~20 rows. Rows are `role=button`, keyboard-selectable; click = select + flyTo; Escape clears.
- Charts: hand-built SVG with d3-scale/d3-shape (`charts/Sparkline.tsx`, `charts/RampBar.tsx`, `charts/Tooltip.tsx`, `charts/ramp.ts`), `lib/useSize.ts` ResizeObserver hook with the width > 0 guard for S4-B's measured charts. Sparkline tooltip is nearest-point over one transparent rect, viewport-positioned so it escapes the scrolling table, flips left past 62 % of the window.
- Continent filter applies to both tables and the KPI counts.

## Calls I made (change freely)

1. **Table order follows mode.** `now` → Trends first, `next14` → Hazards first. Picking a hazard switches mode to `next14`; picking a trend variable switches to `now`, so the globe always colours by what you just chose.
2. **Trends rank** = position by |10-y slope| with significant (p < 0.05) places first; default sort is rank. Non-significant rows show the slope in muted ink and a grey bar.
3. **Trends sparkline is a 12-month rolling mean** of `series_long`, not the raw 120 monthly values: at 64 px the seasonal cycle was pure noise. Caption says so.
4. **Trends Δ chip = the 90-day Sen's slope** (same unit); the contract has no "value 7 days ago" for trends.
5. **Hazard headline per hazard**: wildfire/rain `p` as %, drought `index` signed, heat `days_above`. Ramp position uses `p` for the probability hazards and the category's ramp stop (0.03/0.30/0.55/0.85, same as the globe) for drought/heat. Drought ranks most-negative first; its Δ colour flips so "drier" is orange.
6. **Freshness budgets** (green ≤ budget, amber ≤ 2×, red beyond or `missing`): FIRMS 6 h, Open-Meteo 12 h, POWER 4 d, GIBS/other 24 h, Natural Earth always green (static). From PRD §11/§13 G3.
7. **Sources panel appends two synthetic rows** for the trend engine and hazard modules from `trends.meta` / `risk.meta` + `risk.model`, so all four product-language kinds are visible on screen.
8. **KPI row**: places on watch (+ gates passed), fires 24 h (sum of `fires_24h` bin counts), places drying (negative 10-y rain slope, sub = how many significant), top-20 hit rate vs baseline from `honesty.json`.
9. **`PlacePanel.tsx` is a stub**: name/coords/pop, the chosen variable's 10-y trend line, four headline hazard numbers with category chips, the wildfire sentence. S4-B replaces the body with TrendChart, AnomalySeries, HazardCards, DriverBars.
10. Added `src/lib/format.ts` and `src/lib/useSize.ts` (both listed in contracts §1 repo layout). `format.ts` carries HAZARD/VARIABLE labels; S3 has its own copies in `globe/colour.ts`, deliberately not cross-imported so neither session breaks the other.

## Not done

- Place search (S3-B), feed panel, place panel charts, movers, continent bars, honesty panel (S4-B / day 2).
- URL state is read on load only (M7).
- No unit tests; proof is the static build + screenshots.
- Header labels are English only; no mobile layout (non-goal).

## Contract notes

None. No schema changed; `contracts.md` untouched. `types.ts` unchanged (S0's version already mirrors §3).
