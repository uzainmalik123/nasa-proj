# M-GIBS handback · GIBS imagery toggles + 30-day date slider (PRD M1)

Branch `s3-globe`, worktree `../nasa-project-s3`, `origin/main` (d45482c, post INTEGRATE d1) merged in first. Built against the 20-place mocks in `dashboard/public/data`; the imagery itself is live from NASA GIBS. `npm run lint` and `npm run build` pass (static export, 0 errors, 0 warnings). 2026-11-14 ~18:15 UTC.

## What works (proof: `docs/handback/m-gibs/*.png`, 1600×1000 headless Chromium on `dashboard/out`, live GIBS tiles)

| Screenshot | How | Shows |
|---|---|---|
| `gibs-imerg-on.png` | `/?mode=next14&hazard=wildfire`, click the **rain** chip | **the IMERG layer on**: rain-rate raster under the risk points, fires and country labels, opacity 0.55; bottom-centre panel with the three chips, slider at the right end (11-14), mono date `2026-11-14`, caption *"valid 2026-11-13 · observation · NASA GIBS · GPM IMERG half-hourly rate, one daily image · no image for 2026-11-14 yet, stepped back 1 day"*; legend gains the IMERG row |
| `gibs-imerg-control.png` | crop of the panel | chips · slider `10-16 ─── 11-14` · caption |
| `gibs-imerg-legend.png` | crop of the legend | wildfire ramp, then **rain rate (IMERG)** with the swatch from GIBS's own `GPM_Precipitation_Rate` colormap labelled `0.1 … 50 mm/h` and *valid 2026-11-13 · observation · NASA GIBS*, then the FIRMS dot |
| `gibs-imerg-minus12.png` | slider focused, ←×12 | IMERG for `2026-11-02`, caption without the step-back note |
| `gibs-ndvi-on.png` | click **vegetation** | MODIS NDVI 8-day for the same date (the date carries across layers), legend swatch `0 … 1 NDVI`, caption says "8-day composite, the period containing the date" |
| `gibs-lst-on.png` | click **surface temp** | MODIS LST day, swatch `−30 … 50 °C`, "daytime pass, land only" |
| `gibs-off.png` | before any click / click the active chip again | no raster, panel reads "NASA GIBS · last 30 days", legend has no imagery row |
| `gibs-404-stepback.png` | `/?gibs=rain&date=2026-11-14` (today) | the 404 fallback from the URL path too: requested 11-14, valid 11-13, "stepped back 1 day" |

Driver script and its console log: `m-gibs/gibs-proof.mjs`, `m-gibs/proof.log`. From the log:

```
GIBS tile responses: 190 × 200, 1 × 404
probes (HEAD):
   404 IMERG_Precipitation_Rate/default/2026-11-14/GoogleMapsCompatible_Level6/0/0/0.png
   200 IMERG_Precipitation_Rate/default/2026-11-13/GoogleMapsCompatible_Level6/0/0/0.png
   200 IMERG_Precipitation_Rate/default/2026-11-10/...   (one HEAD per slider day, memoised)
   200 MODIS_Terra_NDVI_8Day/default/2026-11-02/GoogleMapsCompatible_Level9/0/0/0.png
   200 MODIS_Terra_Land_Surface_Temp_Day/default/2026-11-02/GoogleMapsCompatible_Level7/0/0/0.png
console errors: 3   (the three "404 ()" lines are the probe HEADs and one empty tile; no page errors)
```

### Pieces (all in `dashboard/src/components/globe/`)
- **`gibs.ts`** (new): the layer registry (`GIBS_LAYERS`: IMERG_Precipitation_Rate / Level6, MODIS_Terra_NDVI_8Day / Level9, MODIS_Terra_Land_Surface_Temp_Day / Level7, plus `truecolor` for the URL), `GIBS_WMTS_TEMPLATE` + `gibsTileUrl` (moved from `Globe.tsx`, re-exported there), `GIBS_SLIDER_DAYS = 30`, `gibsDateRange` / `clampGibsDate` (30 days ending today UTC), and **`resolveGibsDate`**: HEAD on the zoom-0 tile for the requested day; a 404 steps back one day, up to `GIBS_MAX_STEP_BACK = 7`; results memoised per layer+day so scrubbing never re-probes. GIBS sends `access-control-allow-origin: *` on the 404 too (checked with curl), so the probe works from the browser.
- **`GibsControl.tsx`** (new): bottom-centre floating panel (DESIGN §3, `rounded-2xl bg-black/55 backdrop-blur`): `imagery` label, three chips `rain · vegetation · surface temp` (radio behaviour, clicking the active chip turns imagery off; each chip carries its DESIGN series colour: rain blue, vegetation aqua, temperature yellow), `<input type=range>` over 30 days with mono end labels and the 12 px mono date, then the caption **"valid YYYY-MM-DD · observation · NASA GIBS · <what one image is>"** plus "no image for <date> yet, stepped back N day(s)" when the fallback fired, "checking NASA GIBS for <date>…" while it runs, and "no <layer> image within 7 days of <date>" if nothing is found. Keyboard: ←/→ on the slider.
- **`Globe.tsx`**: new optional prop `onGibsChange?(layer, date)`; when present the globe renders `GibsControl` and passes changes up (the parent keeps owning `gibsLayer` / `gibsDate`, contracts §5). The raster effect now resolves the day first and keeps the previous image up while the probe runs, then swaps the source. Raster inserted **before the basemap's first symbol layer**, so it sits above land/water/boundaries and below every label, the risk points, the selected ring and the fires (DESIGN §4 order). Opacity 0.55. `gibsValid` (what the fallback resolved to) is view state inside Globe, not app state.
- **`Legend.tsx`**: optional `gibs` prop → a row per active layer: colour dot + name, a 176 px swatch sampled (nine stops) from the layer's **own GIBS colormap** (`colormaps/v1.3/GPM_Precipitation_Rate`, `MODIS_NDVI`, `MODIS_Land_Surface_Temp`, fetched 14 Nov) with low/high labels, and *valid <date> · observation · NASA GIBS*.
- **`Dashboard.tsx`** (S4's, two lines): `onGibsChange` passed to `<Globe>`; the `imagery` `<Select>` removed from the controls row since the same choice now lives on the globe. `?gibs=rain&date=…` parsing untouched.

## Calls I made (change freely)

1. **Slider ends at today, the fallback finds the newest image.** S3-B's per-layer `lagDays` is gone: IMERG and NDVI usually lag a day, LST is same-day, and the honest thing is to let GIBS answer and say so in the caption ("no image for 2026-11-14 yet, stepped back 1 day"). Cost: one cached HEAD per day the user touches.
2. **Toggles + slider live on the globe, not in S4's controls row.** PRD §5 draws `▒ GIBS rain/NDVI/LST` on the globe and DESIGN §3 reserves bottom-centre for the slider; the controls row was already wrapping with six widgets. Removing the `imagery` select from `Dashboard.tsx` is the one non-additive touch of another session's file; it is a 5-line deletion and noted in contracts.md.
3. **Three chips, not four.** `truecolor` stays in the registry and works from `?gibs=truecolor` (it then appears as a fourth chip so it can be turned off), but the PRD asks for three.
4. **Legend swatches use NASA's colormap colours**, not the DESIGN palette: the swatch must match what is painted on the map. The chip dots and legend dots do use the DESIGN series colours (rain = `s1`, vegetation = `s3`, temperature = `s4`), which is where the "colour bound to meaning" rule applies.
5. **The date carries across layers** (clamped to the new layer's range), so comparing rain vs NDVI vs LST for the same day is one click.
6. **Raster goes under the labels**, not just under the points, so country names stay readable over bright IMERG cells.
7. **No play button.** DESIGN §7 defines one and L4 is the time-lapse; it is ~15 lines on top of the slider, left for L4.

## Not done

- No play / auto-advance (L4).
- Slider changes do not write `?date=` back to the URL; reading it works (M7 owns URL state).
- No per-pixel value on hover (GIBS has no GetFeatureInfo for these layers).
- One GIBS tile per run came back 404/500 at the globe edge (seen as a blank tile, no error surfaced); MapLibre skips it, nothing to do.
- Verified at 1600×1000 only; at a globe column narrower than ~800 px the panel would overlap the legend (both are `bottom-3`).

## Contract notes

Dated note appended to `docs/contracts.md` (2026-11-14 18:10 UTC): optional `onGibsChange` prop on `Globe`, `gibsDate: null` = today, 404 step-back semantics, GIBS helpers moved to `globe/gibs.ts` (re-exported), `GIBS_LAYERS` field changes, the two Dashboard lines. No JSON schema changed.
