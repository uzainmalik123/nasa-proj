# KI-1 · FIRMS fire dots: hover tooltip, legend, count-scaled radius

15 Nov 2026, S3 (`s3-globe`, branched from `origin/main` 0921438). Fixes `docs/KNOWN_ISSUES.md` KI-1: the gridded red-outlined dots ignored the mouse and nothing said they were 0.25° cells.

## What changed (globe/ only)

- `globe/fires.ts` (new): the layer's shared facts: `FIRE_CELL_DEG = 0.25`, fill/stroke colours, the radius law (dot 2 + 0.7·√count px, glow 4 + 1.8·√count px, drawn at 0.75 size at zoom 1.6 and full by zoom 5), `fireSourceLabel` ("VIIRS_NOAA21_NRT" → "VIIRS NOAA-21"), FRP / centre / acquisition-time formatters.
- `globe/Globe.tsx`: one map-level `mousemove` handler queries the places layer and the fire-dot layer; a place under the pixel wins (clickable), else the fire cell gets a three-line tooltip: `N active fire detections · 0.25° cell` / `max FRP x MW · centre 33.9°S 19.9°E` / `observation · VIIRS NOAA-21 · newest 14 Nov 19:28 UTC`. Fire cells keep the default cursor (not clickable). Small cells sort above big ones (`circle-sort-key`) so a single detection next to a 100-cell stays hoverable. The tooltip div carries `role="tooltip"`.
- `globe/Legend.tsx`: the fire row shows three sample dots sized by the same law for 1 / 10 / 50 detections, then "0.25° cells · 1 / 10 / 50 detections · hover for the count" and "VIIRS NOAA-21 · last 24 h · newest 14 Nov 19:28 UTC" from `fires_24h.json`.
- `docs/DESIGN.md` §4 fire bullets updated; `docs/KNOWN_ISSUES.md` KI-1 moved to Fixed.

## Proof

`docs/handback/ki1/ki1-proof.mjs` (headless Chromium, 1600×1000, `dashboard/out` served by `python3 -m http.server`, with the live `fires_24h.json` of run 20261114T1949Z from the `data` branch copied over `out/data/`: 8,265 bins, max count 174). Output in `ki1/ki1-proof.txt`:

```
legend: … | active fire detections (FIRMS) | 0.25° cells · 1 / 10 / 50 detections · hover for the count | VIIRS NOAA-21 · last 24 h · newest 14 Nov 19:28 UTC
global hover: 4 active fire detections · 0.25° cell | max FRP 21 MW · centre 33.9°S 19.9°E | observation · VIIRS NOAA-21 · newest 14 Nov 19:28 UTC @ 521,684
cursor on fire cell: (default)
tooltip after moving off: null
hover on the selected place: Lagos NG | 19% · low
zoomed hover: 1 active fire detection · 0.25° cell | max FRP 2.3 MW · centre 6.4°N 3.1°E | observation · VIIRS NOAA-21 · newest 14 Nov 19:28 UTC @ 509,501 (skipped 8 place hovers)
console errors: 0
```

- `ki1/ki1-hover-global.png` · tooltip on a Western Cape cell at the global zoom.
- `ki1/ki1-hover-zoomed.png` · tooltip on a single-detection cell next to Lagos after `?place=lagos-ng`; the cells read as separate dots of different sizes.
- `ki1/ki1-legend.png` · the legend's fire row.
- `ki1/ki1-globe-global.png`, `ki1/ki1-globe-zoomed.png` · full globe column at both zooms. Compare `integrate-d1/h2-fires-globe.png` (before): the global density is unchanged by design (cells are half a pixel apart at zoom 1.6, so a bigger radius only thickens the blobs).

`npm run lint && npm run build` pass. The proof needs the sandbox off (basemap tiles over the network); the places are the 20-place mock set, the fires are live.

## Not done / calls

- The grid look itself is the 0.25° binning (contracts §3). KI-1 said to decide finer bins or raw points above a zoom level after the tooltip lands; that is S1's call, untouched here.
- KI-14 (places / fires / both toggle) is the fix for the crowding at the global zoom; not part of this change.
- No unit tests: the dashboard has no test runner, and the behaviour lives in MapLibre hit-testing, so the proof is the headless hover above.
