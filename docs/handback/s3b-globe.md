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
