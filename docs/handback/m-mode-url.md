# M-MODE+URL handback · PRD M5 + M7 (mode switch wired through the screen, shareable URL state)

Branch `s4-panels` (worktree `../nasa-project-s4`), `origin/main` @ a2b90c0 merged in first · 2026-11-15 ~14:15 PKT (09:15 UTC).

## What works
- **Mode switch** in the title block's control row, labelled `mode · Now | Next 14 days` (tooltips say what each means). It drives:
  - **Globe colouring** (`globe/colour.ts` `pickColouring`): `now` colours each place by the category it is in today (the four category stops, so size and colour match the category chips); `next14` colours by the forecast probability on the risk ramp. Drought and heat publish no probability, so they stay category-coloured in both modes and the legend says so. The legend title reads `wildfire · category today` / `wildfire · next 14 days`.
  - **Hazards table** (`panels/HazardsTable.tsx`): the headline column and the small column swap. `next14` = `p 14d` (mono + ramp bar) … `cat` chip; `now` = `category` chip (with confidence dots) … `p 14d` mono. In `now` the rank is category-first, then the headline inside the category; sorting on either column follows what the column shows. Title changes ("which places are in the highest wildfire category today?" vs "who faces the highest wildfire risk in the next 14 days?") and the caption names the mode.
  - **Hazard cards** (`panels/HazardCard.tsx`): `now` = the category word as the 19 px headline with its ramp-colour dot, the number demoted to the sub line; `next14` = the number as the 22 px headline with the category chip (unchanged from H8). The section head reads "Which hazard category is Lahore in today?" / "What does it mean for the next 14 days?".
  - Table order in the aside (trends first in `now`) is unchanged from day 1.
- **Globe lens**: the trend select colours the globe by the chosen variable's 10-year slope (the day-1 behaviour), the hazard select colours it by the hazard; an accent dot before `hazard` / `trend` shows which one is driving the globe. The mode no longer flips implicitly when a select changes; alerts still force `next14` + hazard lens.
- **URL state** (`Dashboard.tsx` `readUrl` / `writeUrl`): `?place=<place_id>&hazard=&mode=&trend=` plus `globe=trend`, `continent=`, `gibs=&date=`. Read on load, written on every state change with `history.replaceState` (no history spam, defaults omitted so the bare URL stays bare). `place=` is the stable id from `places.json`, resolved once the data is in, then selected and flown to. Legacy `var=` and `selected=<index>` still parse and are rewritten in the new form.
- `npm run lint` → clean; `npm run build` → static export OK (mock data and `NEXT_PUBLIC_DATA_URL=/real`).

## PROOF
Real data (data branch run 20261114T1949Z, 554 places, served from `out/real/`), playwright headless, driver `m-mode-url/proof.mjs`, **zero console errors**:
- `m-mode-url/mode-now-wildfire.png` · mode Now: legend "WILDFIRE · CATEGORY TODAY", table headers `# · place · cc · category · hindcast · Δ 7d · p 14d · pop`, title "…highest wildfire category today?", URL `?mode=now`.
- `m-mode-url/mode-next14-wildfire.png` · after clicking Next 14 days: legend "WILDFIRE · NEXT 14 DAYS" with the probability ramp, headers `… p 14d · hindcast · Δ 7d · cat · pop`, URL back to bare (default).
- `m-mode-url/cards-now-lahore.png` vs `cards-next14-lahore.png` · Lahore's cards: Now = `extreme · category today · 94%`; Next 14 = `94% · p · 14 days · EXTREME` chip.
- `m-mode-url/table-now-wildfire.png` vs `table-next14-wildfire.png` · the two column layouts.
- `m-mode-url/mode-now-drought.png` / `mode-next14-drought.png` · category dots in both, legend line "no probability for this hazard · category in both modes".
- `m-mode-url/globe-trend-lens.png` · `?mode=now&globe=trend&trend=tmax_c`: globe by max-temperature slope, accent dot on `trend`.
- **Shareable URL, built through the UI** (toggle, selects, search):
  `?mode=now&hazard=heat&trend=tmax_c&place=lahore-pk&continent=Asia`
  `m-mode-url/share-built.png` → opened in a fresh page → `m-mode-url/share-reloaded.png`. The driver compared url, mode, hazard, trend, region, selected-place header, legend and hazards title: `ROUND TRIP SAME STATE: true`. On the live site the same link is
  `https://uzainmalik123.github.io/nasa-proj/?mode=now&hazard=heat&trend=tmax_c&place=lahore-pk&continent=Asia` (once this branch is on main).
- Driver log excerpt:
  ```
  NOW:    legend "WILDFIRE · CATEGORY TODAY"  headers [#, PLACE, CC, CATEGORY, HINDCAST, Δ 7D, P 14D, POP]
  NEXT14: legend "WILDFIRE · NEXT 14 DAYS"    headers [#, PLACE, CC, P 14D, HINDCAST, Δ 7D, CAT, POP]   url (bare)
  LEGACY ?mode=now&var=tmax_c&selected=1 → ?mode=now&trend=tmax_c&globe=trend&place=lagos-ng
  ROUND TRIP SAME STATE: true
  console errors: []
  ```

## Calls made
- "Current category" = `risk.now[i][hazard].category` (the `now` block of risk.json); "forecast probability" = `p`. The pipeline publishes no separate observation-based category, so Now and Next 14 are two views of the same assessment, labelled as such (legend, table caption, card sub line).
- The trend colouring was not dropped (H1 needs it): it moved from "mode = now" to an explicit lens, carried in the URL as `globe=trend` only when active. Selecting a trend variable (select or place-panel chip) switches the lens to trend; selecting a hazard (select, card or alert) switches it back.
- URL writes omit defaults; the shareable link is whatever the address bar shows.
- `globe/colour.ts`, `Legend.tsx` and the Globe header comment (S3's directory) were edited; the edit is a few lines and the `Globe` prop list is unchanged. Noted in contracts.md.
- On the real data most places are `extreme` for wildfire today (p ≥ 0.9 is the 95th pct), so the Now and Next 14 globes look alike for wildfire at world zoom; the difference shows in the legend, the ranked columns, and for heat / rain.

## NOT done
- The pipeline does not publish an observation-based "now" category (e.g. from fires in the last 7 days); if S2 adds one, `hazardMagnitude` and the table's `now` column are the two places to read it.
- No unit tests (the dashboard has no test runner); the round trip is proven by the driver above.
- `DESIGN.md` §3 still describes the title block without the mode semantics; not edited (docs are the integrator's).

## Contract notes
- `docs/contracts.md` bottom: 2026-11-15 14:00 PKT M-MODE+URL note (mode semantics, URL params, the two S3-directory edits, the new `mode` props). No JSON schema change.
