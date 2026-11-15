# Handback · polish (UI only), 2026-11-15

Branch `s4-panels` (fast-forwarded to `origin/main` 9eb165c first), merged into `main`. Pipeline untouched. No contract change.

I walked the live site (https://globalalert.earth) at 1920×1080 with `docs/handback/polish/audit.mjs`. The script records console errors and warnings, page errors, failed requests and every `layout-shift` entry with its source nodes. It opens every tab, presses `/`, types a city, presses Enter, then presses Esc twice. `states.mjs` covers the error state, with every data request aborted, and the phone safety line at 390 px.

## What was wrong on live → what changed

| Found on live | Fix | Proof (before → after) |
|---|---|---|
| First paint was a black page until the JS chunk ran (0.3 s shot) | `page.tsx` prerenders a `LoadingShell` (top bar, left column, footer, "loading" pill) as `dynamic(..., { loading })`. Same markup as the app, so nothing moves when it mounts | `before-00-t0300ms` → `after-00-t0300ms` |
| CLS 0.095 when data landed: the hazards table grew from 1 "no risk yet" row to 20 rows, Movers was pushed down, the KPI tiles grew and the legend grew | `SkeletonRows` (static, real 28 px rows, 20 for the ranked tables, 10 per Movers side) while a file is missing. KPI subs reserve 2 lines. The legend reserves its valid-window and fire-source lines. Feed and Continents reserve their loaded height. The region select has a fixed width | audit log: **CLS 0.0946 → 0.0000 on load**. The only shift left is 0.0017, after the search fly-to, when the legend switches to the zoomed-in fire key |
| While loading, the tables said "no risk yet" / "no trends yet" (reads as "nothing here") | Skeleton rows while loading. "no places in this region" only when the data is in and the filter empties the table | `before-01` → `after-01-t1500ms` |
| Error state: on desktop only the pill said "failed"; the panels sat empty forever | The pill turns critical red and reads "could not load data". One card in the left column names the failure, shows the error and offers Retry. It uses the DESIGN tokens and the Card chrome | `after-07-error-state` |
| Safety statement only appeared at the bottom of the Sources tab | A 24 px footer bar on every desktop screen carries PRD §7.4: "Informational tool, not an official warning service. Follow local authorities." On phones the same line ends every tab | every `after-*` shot; `after-08-phone-safety` |
| Panels without valid/retrieved time: KPI row, Trends, Movers, Feed, Continents (run id only), Honesty (window only), place-panel trend section | A shared `Stamp` ("valid … · retrieved … UTC · kind") from each file's `meta.generated_at`. The KPI row gets one line under the tiles. The place-panel trend head shows its 10-year window. "generated" now reads "retrieved" | `after-02`, `after-03-tab-trends`, `after-04` |
| Numbers without a unit: FIRES 24 H "39k" (sub said "bins · VIIRS_NOAA21_NRT"), the trend chart's y axes, the anomaly chart y axes, the soil-wetness series, Trends "Δ 90d" values | The KPI sub reads "detections · 8,250 cells of 0.25°". Trend heads read "y in mm" / "30-day total · mm". Anomaly rows read "30-day rainfall · mm", "max temperature · °C" and "root-zone soil wetness (0–1)". The Trends column is now "90d mm/yr" | `before-04` → `after-04-place-selected` |
| Hazard cards in the place panel clipped their values and units ("p…", "37% d…", "6.6M…") | The cards are 2 × 2 instead of 4 in a row | `before-05` → `after-05-place-panel-bottom` |
| Trend chart x labels overlapped: inset "17 Au30 Sep14 Nov", long "Nov 16Nov 18" | The inset is labelled at both ends only. The long-window labels start one year in, all centred | `after-04` |
| Header misalignment: "HINDCAST" and "10 Y MEAN" sat higher than the sortable headers; Freshness read "LAST FETCH" over two lines and "BUDGETRECORDS" | `PlainHeader` uses the same inline-flex box as `SortHeader`. Freshness headers are `nowrap` with padding | `before/after-03-tab-sources`, `after-03-tab-trends` |
| Console warning on every load: `Image "circle-11" could not be loaded` (OpenFreeMap city labels) | `map.setMissingStyleImageResolver` answers with a transparent 1 px image | `console-after-local.txt` |

Keyboard: `/` focuses search and Esc clears the selection. Both already worked on live and are re-proved here. After `/`, `activeElement = INPUT:search place`. After Esc, `panel open = 0` and `?place=` is dropped from the URL.

## PROOF

- Screenshots: `docs/handback/polish/before-*.png` (live, 08:37 UTC) and `after-*.png` (this build against the live data branch, 08:43–08:52 UTC).
- Console: `docs/handback/polish/console-after-local.txt`, in full:
  - **0 console errors, 0 console warnings, 0 page errors, 0 HTTP ≥ 400.**
  - The 45 `requestfailed` lines left out of the file are all `tiles.openfreemap.org/... net::ERR_ABORTED`. MapLibre cancels those tile requests itself when the globe zooms or flies. They are network events, not console messages, and live shows the same aborts.
- `npm run lint` clean · `npm run build` static export OK · `npm test` 0 fail. Pipeline not touched, so ruff was not needed.

### Live, after deploy run 43696757845 (green, main 52d39f0, 08:57 UTC)
- `console-after-live.txt`, against https://globalalert.earth: **0 console errors or warnings, 0 page errors, 0 HTTP ≥ 400**. Load CLS is 0, plus 0.0017 after the user's fly-to. `/` focuses search and Esc closes the panel. The 45 `requestfailed` lines left out are all OpenFreeMap tile aborts.
- `live-after-00-t0300ms.png`: the first paint is the frame. `live-after-02-loaded-risk.png`: the loaded view.

## Calls I made
- I kept the loading state static (no shimmer), because DESIGN §7 says nothing animates on load.
- The Retry button reloads the page. That is simpler than re-running the loader in place, and the IndexedDB cache makes the reload cheap.
- The four-kinds sentence stays on the Sources tab. The footer carries the safety statement plus a short version of the four-kinds line.

## NOT done
- After merging `origin/main` (PR #29/#30, imagery select in the top bar), the bottom-right imagery bar overlaps the MapLibre attribution pill at 1920×1080. That arrived with #30 after my walk, so I left it to that session rather than move their component.
- The legend still grows 15 px when the user zooms past the dots/heatmap threshold. That is user-initiated, not a load jump.
- Phone layout (L8) was not reworked. I only checked that the safety line shows there.
- The before/after for the live deploy is only as fresh as the deploy run that main triggers. Re-run `node docs/handback/polish/audit.mjs https://globalalert.earth <dir>` once it is green.
