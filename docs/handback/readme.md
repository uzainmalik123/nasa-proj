# README handback (branch `main`, 2026-11-15 ~09:30 UTC / 14:30 PKT)

## What works
- `README.md` for judges: pitch, live URL (https://globalalert.earth), screenshot, what / where / how much / so what (trend engine + four hazards), data sources with link, latency and kind (Open-Meteo marked non-NASA supplement), cron + seven gates, honesty panel, limitations (POWER 3-day lag, 12-month labels, perfect-prognosis training, no flood modelling), safety statement, clean-clone run instructions.
- Numbers quoted are from run `20261115T0417Z` (all gates green): PR-AUC 0.785 vs 0.303, Brier 0.124 vs 0.206, top-20 hit rate 99 % vs 56 % (hindcast 2026-09-20 → 2026-10-31), 72 places significantly warming over 10 years, none cooling, soil wetness falling at 113.
- `media/screenshot.png`: the live site at `?place=lahore-pk`, 1600 × 1000, taken 15 Nov 08:40 UTC.

## Proof
- Rendered README (GitHub GFM API + github-markdown-css): `docs/handback/readme/readme-rendered.png`.
- Word count: 1,490 words of prose (code blocks, URLs and markdown-only tokens such as `|` and `---` excluded); raw `wc -w README.md` = 1,726.
- Run instructions tested in a fresh clone: `uv sync`, `uv run pytest -q` (43 passed), `uv run ruff check .` (clean), `npm ci && npm run lint && npm run build` (clean), `npm run dev` with `NEXT_PUBLIC_DATA_URL` pointing at the data branch loaded 666 places, and the warm-cache restore produced the nine `out/*.json` files plus the cache (143 MB), on which `uv run python -m trend.mk` ran. The restore needed `mkdir -p pipeline/data` in a clean clone, which the README now includes.

## Not done
- A full `uv run python run.py` was not run from the clean clone: it shares the FIRMS quota with the CI cron.
- `dashboard/README.md` is still the create-next-app default (not mine to change).

## Contract notes
None.
