# S3-A handback · globe

Branch `s3-globe`, worktree `../nasa-project-s3`. Built against the 20-place mocks in `dashboard/public/data`.

## What works (proof: `docs/handback/s3a/*.png`, 1600×900 headless Chromium on the static export)

| Screenshot | State | Shows |
|---|---|---|
| `globe-wildfire.png` | `?mode=next14&hazard=wildfire&selected=3` | 20 places coloured by wildfire probability on `RISK_STOPS`, radius 3→11 px, <5 % places as 3 px muted dots, white 2 px ring on the selected place, hover tooltip "Kinshasa CD · 30% · high", gradient legend 0/50/100 % + FIRMS dot |
| `globe-rain-trend.png` | `?mode=now&var=rain_mm&selected=3` | same places coloured by the 10-year Sen's slope of rainfall: rising orange, falling blue, p ≥ 0.05 grey; diverging legend labelled in mm/yr |
| `globe-drought.png` | `?mode=next14&hazard=drought` | categorical hazard: low/elevated/high/extreme swatches, points at the category's ramp position |
| `globe-gibs-rain.png` | `…&gibs=rain` | IMERG daily rain raster under the points at 0.55 opacity (live GIBS tiles, 2-day lag) |

- MapLibre 6.18 `globe` projection, OpenFreeMap `dark`, `atmosphere-blend` 1→0 over zoom 0→8, worker served from `/public` via `setWorkerUrl`.
- Basemap symbol layers hidden except country/state/region/city/capital names, which are dimmed to 55 % opacity.
- Layer order: GIBS raster → places → selected ring → fire glow → fire dots (646 mock bins, radius by count).
- Props exactly contracts §5: `places risk trends fires mode hazard trendVar selected onSelect flyTo gibsLayer gibsDate`. No React state inside Globe; refs only. Colour/radius pushed through `setFeatureState`, so switching hazard or variable never re-uploads the source.
- `flyTo` = `{ lon, lat, zoom? }`; a new object identity flies (`zoom max(current, 5.2)`, `speed 0.9`). Clicking a point calls `onSelect(index)`.
- `npm run lint` and `npm run build` pass (static export, 0 errors).

## Calls I made (change freely)

1. **Which colouring is active comes from `mode`.** `mode === "now"` → trend colouring by `trendVar`; `mode === "next14"` → hazard colouring by `hazard`. The contract has no separate "colour by" prop and PRD §5 pairs Now with "what is changing" and Next 14 days with the risk assessment. If `trendVar` is null or `trends` is missing it falls back to the hazard.
2. **Trend window is the 10-year one** (`trends.long`), since that is the challenge's rubric. 90-day is one constant away (`colour.ts`, `trendScale`/`pointStates`).
3. **Trend colour scale per variable** = median |slope| over significant places, so half of the significant points are saturated and a single outlier cannot grey the rest. Legend prints ± that value in the variable's unit. Significant points never shrink below radius ~4.6 px.
4. **Categorical hazards (drought, heat)** map `low/elevated/high/extreme` to ramp positions 0.03/0.30/0.55/0.85; `low` renders as the muted dot. Wildfire and rain use `p` directly.
5. **Fires always on**, both modes, no toggle (DESIGN §4 lists them as fixed layers).
6. **GIBS registry** in `Globe.tsx` (`GIBS_LAYERS`): `rain` IMERG daily (Level6, 2-day lag), `ndvi` MODIS Terra 8-day (Level9), `lst` MODIS Terra LST day (Level7), `truecolor` (Level9). `gibsLayer` takes one of those keys; `gibsDate` null = today minus the layer's lag. Tile sets and lags checked against GIBS capabilities on 14 Nov. That is most of M1 already.
7. **Temporary `src/components/Dashboard.tsx` and `src/app/page.tsx`.** s4-panels had no Dashboard at 27bfd17, so a throwaway shell is in place: loads `loadAll()`, controls for mode/hazard/variable/GIBS, a 20-row place list that selects + flies. Reads `?mode=&hazard=&var=&gibs=&date=&selected=` for dev links. **S4 should replace both files wholesale** and keep only the `<Globe …/>` block and the `next/dynamic` `{ ssr: false }` import.

## Not done

- Search (`Search.tsx`) is S3-B, not started.
- Tooltip and legend are DOM-driven; no Playwright/unit tests.
- Fly-to and GIBS are verified by code and the rain overlay screenshot only; no screenshot of a flight in progress.
- Fires glow/dot radius scale is `count 1→60`; retune once real bins land (mock max is 39).
- No pulse ring on the newest alert (DESIGN §7 is the feed's, S4).

## Contract notes

None. No schema changed. `contracts.md` untouched. `GlobeProps`, `FlyTarget`, `GibsLayerKey` are exported from `Globe.tsx` for S4.
