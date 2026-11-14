# S3-B handback · search + live fires + GIBS prep

Branch `s3-globe`, worktree `../nasa-project-s3`, `origin/main` (post S4-A merge) merged in first. Built against the 20-place / 646-bin mocks in `dashboard/public/data`. `npm run lint` and `npm run build` pass (static export, 0 errors).

## What works (proof: `docs/handback/s3b/*.png`, 1600×900 headless Chromium on `dashboard/out`)

| Screenshot | How it was produced | Shows |
|---|---|---|
| `search-open-fires.png` | `/?mode=next14&hazard=wildfire`, press `/`, type `da`, press ↓ | 646 FIRMS bins as glow + dot layers over the globe; search box focused by `/`; dropdown with 8 fuzzy hits for "da" (Dar es Salaam, Dakar, Durban, Addis Ababa, Luanda, Ibadan, Alexandria, Abidjan), capital chip + continent per row, second row highlighted by ↓ |
| `search-enter-flyto.png` | then Enter | Dakar selected: white ring on the point, hazards table row 10 highlighted, globe flown to zoom 5.2, input reads "Dakar, SN" |
| `continent-africa-addis-close.png` | `/?…&continent=Africa`, search "addis", Enter, hover | Addis Ababa at 46 % wildfire, full orange, tooltip "46% · high" |
| `continent-asia-addis-close.png` | same with `continent=Asia` | same point dimmed to a 3 px 12 %-opacity dot (ring + tooltip still work); every mock place is African so Asia dims all 20 |
| `continent-asia-dims-all.png` | `/?…&continent=Asia`, globe zoom | the orange risk dots vanish globe-wide; fires unaffected; KPIs read 0 of 20 (S4's filter agrees) |

Playwright console during the run:
```
search 'da' → ["Dar es Salaam TZcapitalAfrica","Dakar SNcapitalAfrica","Durban ZAAfrica","Addis Ababa ETcapitalAfrica","Luanda AOcapitalAfrica","Ibadan NGAfrica","Alexandria EGAfrica","Abidjan CIcapitalAfrica"]
focused: search places
after Enter: input = Dakar, SN
```

### Pieces
- **Fires** (`fires_24h.json` → `fires-glow` + `fires-dot` circle layers, DESIGN §4 colours/radii) were already in from S3-A; verified rendering above on 646 bins, radius by `count`, on top of the risk points and the selected ring.
- **`globe/Search.tsx`**: `<Search places onPick limit? className? />`. `/` anywhere outside a text field focuses + selects the box; typing lists the top 8 matches; ↑/↓ move, Enter or click picks → `onPick(i)`; after a pick the box shows "Name, CC" and blurs. Esc closes the list, a second Esc clears the text, and only an empty closed box lets Esc reach the app (which clears the selection). `role=combobox` / `listbox` / `option` with `aria-selected`.
- **`globe/fuzzy.ts`**: dependency-free scorer. Query must be a subsequence of `"name country"` (diacritics folded, case-insensitive); word-start, consecutive-run and string-start bonuses; ties broken by population. "lagos ng", "dar", "addis", "cape", "ZA" all behave; unknown text shows "no place matches".
- **Continent filter**: `Globe` prop `continent?: string | null`. `pointStates(..., keep)` in `colour.ts` now takes the kept index set (`continentSet(places, continent)`); non-members get `{ v: 0, color: muted, o: FILTERED_OPACITY = 0.12 }` so they shrink to 3 px and nearly disappear. Selected ring, hover and click still work on dimmed points.
- **GIBS prep**: `GIBS_WMTS_TEMPLATE` (PRD §6 URL with `{layer} {date} {level} {ext}` placeholders, `{z}/{y}/{x}` left to MapLibre) and `gibsTileUrl(key, date)` exported from `Globe.tsx`. The raster source is added only when `gibsLayer` is non-null; its default is null, which is the "prop default false" the brief asks for. M-GIBS is a `gibsLayer` + `gibsDate` toggle away; S4's imagery `<select>` already drives `gibsLayer` and `?gibs=rain&date=YYYY-MM-DD` works today.
- **Wiring in `Dashboard.tsx` (S4's file, two additive lines + one import):** `<Search places={places} onPick={(i) => select(i, true)} />` first in the controls row, `continent={s.continent}` on `<Globe>`. Noted in contracts.md. Nothing else in `panels/` or `Dashboard.tsx` touched.

## Calls I made (change freely)

1. **Search lives in the controls row**, left of the mode toggle, 150 px input + `/` kbd hint, dropdown 260 px. PRD §5 puts `[search]` with the other controls; S4's comment reserved the slot.
2. **Enter = select + fly** via the parent's `select(i, true)`; the globe never flies itself (DESIGN §7: fly only on explicit pick).
3. **Dim = 12 % opacity + 3 px**, not hidden, so the world still reads as watched and a dimmed place can still be hovered/clicked. Fires are never filtered (they are not per-place).
4. **No `gibs: boolean` prop.** Adding one default-false would silently disable S4's existing imagery select; `gibsLayer: null` already is the off state. If you want the explicit boolean anyway it is a two-line change in `Globe.tsx`.
5. **Fuzzy without a dependency** (no `fuse.js`), ~60 lines, enough for 600 places; if typo tolerance is wanted later, swap `score()` only.
6. **Search matches `name` + ISO country code**, not country names (the places file has no country names). Typing "pakistan" will not find Lahore; "lahore pk" will.

## Not done

- No unit tests for `fuzzy.ts` (checked by running it against the mocks, output above).
- Mock has only Africa, so the region `<select>` cannot be set to Asia from the UI; the Asia proofs use the `?continent=` URL param S4 already reads.
- Fire glow/dot radii still scale `count 1→60`; retune on real bins.
- Search does not read `?q=` from the URL (M7 territory).

## Contract notes

Dated note appended to `docs/contracts.md` (2026-11-14 15:10): optional `continent` prop on `Globe`, new `Search.tsx`, the two Dashboard lines, GIBS template exports. No JSON schema changed.

---

# S3 follow-up · wildfire category thresholds 0.30 / 0.60 / 0.90 (2026-11-14, same branch)

Per the S2-B notes in contracts.md (09:40, 10:05) and s2b-hazards.md call 3. Probabilities are unchanged; only the chip and the ramp moved.

## Diff of the two tables

`src/components/globe/colour.ts` · `CATEGORY_V` (the probability at which each category starts):

| category | before | after |
|---|---|---|
| low | 0.03 | 0.03 |
| elevated | 0.30 | 0.30 |
| high | 0.55 | **0.60** |
| extreme | 0.85 | **0.90** |

`src/lib/palette.ts` · `RISK_STOPS` (colours unchanged; values = today's 50 / 80 / 95 / 99th percentiles of wildfire p, run 20261114T0949Z, 554 places):

| stop | before | after | colour |
|---|---|---|---|
| 0 | 0.00 | 0.00 | rgba(255,120,40,0) |
| 1 | 0.05 | **0.15** | rgba(140,45,15,0.45) |
| 2 | 0.20 | **0.59** | #9a3412 |
| 3 | 0.40 | **0.92** | #ea580c |
| 4 | 0.65 | **0.995** | #fbbf24 |
| 5 | 1.00 | 1.00 | #fef3c7 |

Verified against the real `risk.json`: p50 0.153 · p80 0.594 · p95 0.924 · p99 0.995; categories low 375 · elevated 76 · high 70 · extreme 33 (matches the brief).

Knock-ons in `globe/`:
- `RISK_FLOOR` is now derived from `RISK_STOPS[1][0]` (0.15) instead of a literal 0.05, so "below the first stop = 3 px muted dot" still holds; 375 low places render as watched dots.
- Legend bar spaces the six stops evenly (the ramp encodes rank, DESIGN §2) and labels them **0 · 15 · 59 · 92 · 100 %** with the caption "ramp stops = today's 50 / 80 / 95 / 99th pct". The 0.995 stop is unlabelled because it would sit on top of 100.
- New `CATEGORY_THRESHOLD_P` in `colour.ts` (wildfire 0.30 / 0.60 / 0.90, rain 0.10 / 0.25 / 0.50, mirrors `config.py`). The wildfire and rain legends now quote **elevated ≥ 30 % · high ≥ 60 % · extreme ≥ 90 %**. Before this change nothing in `globe/` quoted a threshold number; the tooltip shows "p% · category" and the categorical legend shows unlabelled swatches.
- `charts/ramp.ts` `CATEGORY_V` is S4's file and is **not** edited here; it must read the same 0.03 / 0.30 / 0.60 / 0.90. `lib/palette.ts` is shared; if S4 makes the identical `RISK_STOPS` edit the hunks merge cleanly.

## Screenshots (real S2 files from `../nasa-project-s2/pipeline/data/out/` + mock `fires_24h.json` and `run.json`, which S2 does not write)

| Screenshot | Shows |
|---|---|
| `s3b/real-wildfire-global.png` | 554 places, wildfire selected, new ramp and legend |
| `s3b/real-wildfire-legend.png` | legend crop: 0 · 15 · 59 · 92 · 100 % labels, percentile caption, 30 / 60 / 90 % thresholds |
| `s3b/real-wildfire-lusaka.png` | search "lusaka" → Enter: ring on Lusaka (≥ 0.92, #ea580c) with neighbouring points |
| `s3b/real-drought-global.png` | categorical legend unchanged in shape; elevated now sits at ramp 0.30 (darker than before) |

The status pill reads "stale" because `run.json` is the mock; S4's imagery select wraps to a second row at 1600 px once the region list has seven continents (S4's control row, not changed here).

## Is the globe calm except for the ~33 extreme places?

**Closer now, after a second commit that makes radius follow the ramp's rank breakpoints.** Before it (`real-wildfire-global-before-rank-radius.png`), radius ran linearly 3 → 11 px on p, so the ~70 "high" places at 0.60–0.92 were 8–10 px and the globe showed ~100 strong dots. After it (`real-wildfire-global.png`), radius is 3 px below the 50th pct, 3.5 → 5 px to the 80th, 5 → 8 px to the 95th and 8 → 11 px only above the 95th, so the 33 extreme places are the only bright 8–11 px dots and the high band reads as 5–7 px mid-orange. It is calm outside the burning belts; the belts themselves (Sahel, India, SE Asia, Brazil's north-east, southern Africa) still carry a cluster each, which is what the data says.

Implementation: `PointState` gained `r` (px), computed in `colour.ts` by a d3 `scaleLinear` from `RISK_STOPS` values → `[3, 3.5, 5, 8, 11, 11]`, so retuning the stops retunes the radii. Trend mode keeps its own linear `trendRadius(v)` (3 → 11 px on the normalised |slope| floored at 0.2) so the "now" mode did not shrink (`real-rain-trend-global.png`). Categorical hazards go through `CATEGORY_V` → risk radius, so elevated drought/heat sit at ~4 px (`real-drought-global.png`). `Globe.tsx` `RADIUS` is now `["coalesce", ["feature-state", "r"], 3]`.
