# S4-D handback · M-MOVERS+CONTINENTS, half 2 (dashboard)

Branch `s4-movers` (worktree `../nasa-project-s4c`), branched from `s4-panels` at 858ab87 (S4-C Honesty) with `s2-science` merged in · 2026-11-14 23:40 PKT (18:40 UTC).

**Why not on `s4-panels` directly:** the `s4-panels` worktree was being used by another live session (S4-C committed there at 22:53 PKT while this one was reading it), so a merge into it was aborted and the work moved to its own worktree and branch. PR targets `s4-panels`.

## What works
- `panels/Movers.tsx` (M3): two tables side by side, ▲ up (orange Δ) and ▼ down (blue Δ), ranked-table row anatomy (rank · place · cc · headline mono + ramp bar · Δ chip); click selects + flies the globe; caption states the Δ definition, drought's inverted sign, counts and the data source.
- `panels/Continents.tsx` (M4): one stacked bar per continent (low / elevated / high / extreme in the ramp's category colours, "low" in axis grey, bar length = places on watch, counts in mono inside segments, n and today's mean at the right, full tally + population on hover); six small multiples in a row, 60 px tall, shared y, mean 90-day hindcast per continent with hover tooltips; clicking a row or a tile sets / clears the region filter.
- `lib/aggregate.ts`: browser twin of `pipeline/publish/aggregate.py`, used when the run predates the blocks (today's data branch, run 20261114T1423Z) and for movers under a continent filter (the published top-10 is global). Captions say which path was used.
- `lib/types.ts`: `MoverRow`, `MoversBlock`, `Movers`, `CategoryCounts`, `Continents`; `RiskFile.movers?` / `continents?` optional.
- `Dashboard.tsx`: Movers and Continents sit between the selected-place panel and the feed (PRD §5 order MOVERS · CONTINENTS · FEED).
- `npm run lint` → clean; `npm run build` → static export OK.

## PROOF
Real data (S2's run 20261114T1751Z, served from `out/real/` via `NEXT_PUBLIC_DATA_URL=/real`, playwright headless, zero console errors):
- `s4d/real-movers-wildfire.png` · up: Yangon 75 % +58 pt, Lucknow 68 % +55 pt, Cape Town 75 % +50 pt — identical to the pipeline sample in `s2c-movers-continents.md`.
- `s4d/real-movers-{drought,heat,rain}.png`
- `s4d/real-continents-wildfire.png` · Africa 52/7/11/10 of 80, Asia 151/42/46/13 of 252, Europe 76/2/0/0 … means 33 / 35 / 9 / 21 / 18 / 45 %.
- `s4d/real-continents-{drought,heat,rain}.png`, `real-continents-hover.png` (tally + population tooltip).
- `s4d/real-mover-click-full.png` · clicking the top mover selected Yangon (place panel header "Selected place · Yangon, MM").
- `s4d/real-continents-wildfire-asia-active.png` + `real-movers-wildfire-asia-filter.png` · clicking Asia set the region select to Asia; Movers re-titled "… in Asia?" and recomputed in the browser.
- Fallback on the live data branch's risk.json (no `movers` / `continents`): `s4d/fallback-movers-wildfire.png`, `fallback-continents-wildfire.png`, captions read "computed in the browser (run predates movers / continents)".

## Calls made
- Movers under a region filter are recomputed client-side rather than filtering the global top-10 (which would often leave 0–2 rows).
- Ramp position for drought / heat movers is the category stop (as the hazards table does); wildfire / rain use p.
- The mock set (`public/data`) has only African places (first 20 of places.parquet), so its Continents panel shows one row; the real-data screenshots are the proof.

## NOT done
- No unit tests for `lib/aggregate.ts` (the dashboard has no test runner); equality with the pipeline is shown by the matching movers rows above.
- Not yet on the live site: needs this PR into `s4-panels`, then main, then a green pipeline run for the published blocks (the fallback covers the gap).

## Contract notes
- None beyond S2-C's additive note (merged in from `s2-science`). `types.ts` mirrors it.
