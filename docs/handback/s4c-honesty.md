# S4-C handback · M-HONESTY (branch `s4-panels`, 2026-11-14 ~17:55 UTC / 22:55 PKT)

## What works
- `dashboard/src/components/panels/Honesty.tsx`, mounted in `Dashboard.tsx` between Feed and Freshness (PRD §5 layout row "HONESTY · FRESHNESS · SOURCES").
- Bar pairs predicted (blue `s1`) vs observed (orange `s2`) per bucket from `honesty.json.buckets`; bucket range and `n` under each pair; y axis in %; hover tooltip with predicted, observed, place-days.
- Headline "top-20 hit rate X% vs baseline Y%" with the +pt difference in green (red if below baseline), and the largest-gap bucket in one line.
- Mode badge in the card heading: amber "held-out hindcast" or green "published", with the reason on hover.
- Last-10-runs dots from `runs[]`, oldest left, newest ringed, green ok / red failed, failing gate and duration on hover.
- Caption per PRD §7.2 step 5: perfect-prognosis training note, Open-Meteo at inference, baseline named (fire weather index). Hindcast and published variants of the sentence.
- Empty state when `honesty.json` is missing; null-tolerant for `top20_hit_rate` (the writer returns `None` when no date has 20 places).
- `npm run lint` clean (0 errors, 0 warnings), `npm run build` passes.

## Proof
- `docs/handback/s4c/honesty-mock.png` · mock data (6 buckets, 10 green runs).
- `docs/handback/s4c/honesty-real.png` · S2's real `honesty.json` from run 20261114T0949Z (8 buckets, hit rate 99 % vs 50 %, 5 runs).
- `docs/handback/s4c/honesty-published-failed.png` · the real file with `mode: "published"` and one injected failed run (G4_sanity) to prove the badge and the red dot.
- `*-hover-bucket.png` and `*-hover-run.png` · the two tooltips. Playwright read the run tooltip as `run 20261114T0940Z | gates | failed G4_sanity | duration | 41 s`.
- No page or console errors in any of the three loads.
- Palette check: `validate_palette.js "#3987e5,#d95926" --mode dark --surface "#1a1a19"` → all checks pass (CVD ΔE 26.8).

## Not done
- No "published" data exists yet (the `cache/published/` store is hours old, not two weeks), so the published branch is only exercised with the injected variant above; the copy and the badge colour are in place for when S1/S2 flip `mode`.
- No per-run gate detail beyond `failed_gate`; `runs[]` carries no gate values, so the hover shows the name and duration only.

## Calls made
- Bars are capped at 24 px with 4 px rounded tops and a 2 px gap in the pair (dataviz spec); plot height 110 px (DESIGN §8 fixed heights).
- Hit-rate delta coloured with the status colours (green above baseline, red below) since it is a judgement, not a series.
- The badge uses `warning` amber for hindcast so the labelled fallback (PRD §12 Q1) is visibly provisional.

## Contract notes
None. `honesty.json` schema unchanged.
