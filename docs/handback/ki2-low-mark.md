# KI-2 · Low-risk places: a visible mark (dot at the world zoom, ring zoomed in)

15 Nov 2026, S3 (`s3-ki2`, branched from `origin/main` 7d33d5d). Fixes `docs/KNOWN_ISSUES.md` KI-2: places under the risk floor were a 3 px `muted` dot at 0.5 opacity, about 1.6:1 against the dark basemap, so most of the watch list was invisible (live file 20261115T0417Z, 666 places: 349 under the floor in wildfire next-14, 467 in category-today, 554 in rain next-14, 628 in heat).

## What changed

- `globe/colour.ts`: `PointState.low`; the low mark's constants (`LOW_COLOUR` `#c8c4bb`, `LOW_ZOOM_DOT` 2.5, `LOW_ZOOM_RING` 4.5, dot 2 px at 0.9, ring 3.5 px / 1.2 px stroke at 0.75) and `lowIsRing(zoom)` for the legend. `pointStates` gives a place under `RISK_FLOOR` the low state instead of the muted one; muted now means only "no assessment" (risk) or "not significant" (trend). Places outside the continent filter are still dimmed, never low.
- `globe/Globe.tsx`: `PLACE_PAINT`, the places layer's paint as zoom-crossfaded expressions: low places get the off-white fill (opacity 0.9 → 0 from zoom 2.5 to 4.5) and the off-white stroke (opacity 0 → 0.75), radius 2 → 3.5 px; everything else keeps the feature-state colour, radius and the 1 px dark stroke. Evaluated on the GPU, no JavaScript on zoom, no new layer, nothing on the load path. The globe tracks its zoom in view state, quantised to a quarter, and passes it to the legend.
- `globe/Legend.tsx`: `LowMark` (`data-low-mark="dot" | "ring"`) as the globe draws it at the current zoom; the probability legend gains "low · under 15 % · dot at the world zoom / ring when zoomed in"; the category legend's "low" swatch is the same mark instead of the grey disc.
- `dashboard/scripts/test-resolve.mjs` + `npm test`: `node --test` over `src/**/*.test.ts` with a resolver for the `@/` alias and extension-less imports (Node 26 strips the types). First test: `globe/colour.test.ts`, seven cases for the low state and `lowIsRing`. The dashboard had no test runner before.
- `docs/DESIGN.md` §4 risk-points and legend bullets; `docs/KNOWN_ISSUES.md` KI-2 → Fixed, plus KI-19 (ramp stops are a 14 Nov snapshot, legend says "today's") and KI-20 (null SHAP driver value blanks the dashboard for 38 places) found on the way.

## Proof

`docs/handback/ki2/ki2-proof.mjs` (headless Chromium 1600×1000, `dashboard/out` served by `python3 -m http.server`, the nine live data-branch files of run 20261115T0417Z copied over `out/data/`). It samples pixels from the screenshot (a 40-line PNG reader inside the script). Output in `ki2/ki2-proof.txt`:

```
ok   legend has 'low · under 15 %'
ok   legend low mark at the world zoom is a dot (got dot)
world hover: Yaoundé CM | 12% · low @ 482 546
ok   low place at the world zoom is a visible mark (max luminance 248 within 3 px, need ≥ 140)
ok   category legend's low swatch is the low mark
ok   legend low mark after the fly-to is a ring (got ring)
ok   ring is hollow: centre luminance 12 (need < 90)
ok   ring is visible: max luminance 255 at 2.5–4.5 px (need ≥ 140)
zoomed hover: São Tomé ST | 2% · low
console errors: 0 []
all checks passed
```

Before the change the same script measured Khartoum (20 %, the ramp's first stop) at a max luminance of 53 and found no low entry in the legend (`FAIL` on five checks).

- `ki2/ki2-globe-global.png` · world zoom, wildfire next 14 days: the low places are an off-white texture under the orange.
- `ki2/ki2-hover-global.png` · Yaoundé, 12 %, hovered at the world zoom.
- `ki2/ki2-globe-pakistan.png` · `?region=pk` at zoom 4.5: the 112 districts as separate rings, the Punjab cluster's orange dots on top.
- `ki2/ki2-hover-zoomed.png`, `ki2/ki2-globe-zoomed.png` · São Tomé after the fly-to (the white 2 px ring outside it is the selection ring, as before).
- `ki2/ki2-legend-global.png`, `ki2/ki2-legend-zoomed.png`, `ki2/ki2-legend-category.png` · the legend's low entry as dot, as ring, and in category mode.

`npm run lint`, `npm test` (7 pass) and `npm run build` pass. The proof needs the sandbox off (basemap tiles).

## Not done / calls

- **The ramp's first band is now the least visible thing on the globe.** The 118 places between the floor (15 %) and 30 % draw in the ramp's first stop, `rgba(140,45,15,0.45)` → `#9a3412`, luminance ≈ 50–70 on the basemap. A 2 % place is now brighter than a 20 % one. Hue still carries the risk, and the ramp's "below the 80th percentile is subdued" intent is deliberate, but the stop colours are shared with the chips and the hazards table (`RISK_STOPS`), so lifting the first stop is a §6 colour call for the layout work (L6) or part of KI-19, not done here.
- KI-20 (38 places crash the dashboard when selected) is S4's and serious enough to do before the demo; the proof skipped Malé because of it.
- KI-14 (places / fires / both toggle) and the fire heatmap (F1) are untouched; at the world zoom the fire cells still cover the burning belts.
