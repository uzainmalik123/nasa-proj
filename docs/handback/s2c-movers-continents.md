# S2-C handback · M-MOVERS+CONTINENTS, half 1 (pipeline)

Branch `s2-science` · 2026-11-14 23:00 PKT (18:00 UTC) · run 20261114T1751Z on the laptop (`uv run python -m hazards` in the s2 worktree against the 0949Z caches).

## What works
- `pipeline/publish/aggregate.py`: `movers(places, risk)`, `continents(places, risk)`, `attach()`, `validate()`.
- `publish.run` attaches both blocks to `risk.json` and validates their shape before `write_json`; `publish/mock.py` does the same for the 20-place mock set (`dashboard/public/data/` regenerated).
- `uv run --project pipeline ruff check pipeline` → `All checks passed!`; `ruff format --check` clean.
- Science tail on the real feature table: 37.9 s (hazards 37.5 s, publish 0.4 s); `risk.json` 2,173 KB (G6 limit 5 MB).

## PROOF · JSON sample (real data, run 20261114T1751Z)
Movers, wildfire, top 3 each way (`place` → name resolved from places.json):

| side | place | ago (7 Nov) | today | Δ | category |
|---|---|---|---|---|---|
| up | Yangon | 0.174 | 0.752 | +0.578 | high |
| up | Lucknow | 0.130 | 0.680 | +0.550 | high |
| up | Cape Town | 0.252 | 0.752 | +0.500 | high |
| down | Sacramento | 0.584 | 0.174 | −0.410 | low |
| down | Aleppo | 0.596 | 0.235 | −0.361 | low |
| down | Almaty | 0.594 | 0.235 | −0.359 | low |

Heat up: Ibadan 7 → 12 days (+5, extreme), Maceió 3 → 8, Dakar 6 → 10. Rain up: Yerevan 9 % → 86 %, Reykjavík 6 % → 79 %, Busan 4 % → 76 %. Drought up (index falling): Las Vegas 3.22 → 1.90 (Δ −1.32).

```json
{"movers": {"wildfire": {"key": "p", "since": "2026-11-07",
  "up":   [{"place": 116, "id": "yangon-mm", "value": 0.752, "ago": 0.174, "delta": 0.578, "category": "high", "exposure": 4088000}, …×10],
  "down": [{"place": 448, "id": "sacramento-us", "value": 0.174, "ago": 0.584, "delta": -0.41, "category": "low", "exposure": 1604000}, …×10]},
  "drought": {"key": "index", …}, "heat": {"key": "days_above", …}, "rain": {"key": "p", …}},
 "continents": {
  "names": ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"],
  "n": [80, 252, 78, 80, 19, 45],
  "pop": [138078824, 702025102, 140031430, 204335718, 16189958, 142456761],
  "counts": {"wildfire": [{"low": 52, "elevated": 7, "high": 11, "extreme": 10}, {"low": 151, "elevated": 42, "high": 46, "extreme": 13}, …×6], "drought": […], "heat": […], "rain": […]},
  "mean_now": {"wildfire": [0.329, 0.353, 0.087, 0.214, 0.181, 0.446], "drought": [-0.347, 0.079, -0.315, -0.273, -0.279, 0.754], "heat": [0.988, 0.004, 0.0, 0.013, 0.0, 0.956], "rain": [0.098, 0.058, 0.212, 0.057, 0.089, 0.217]},
  "mean_history": {"wildfire": [[90 values] ×6], "drought": […], "heat": […], "rain": […]}}}
```
All values verbatim from `pipeline/data/out/risk.json` of that run.

## Calls made
- Δ is in the hazard's native unit against `history[-7]` (the same "Δ 7d" the hazards table already shows), not a category change; `up` is oriented to "more risk" for every hazard, which for drought means a negative Δ.
- Continent means are plain means of the headline value (p, index, days) per continent, not exposure-weighted; `pop` is published so the dashboard can weight if wanted.
- Both blocks are attached at publish time, not in `hazards.compute`, so the hazards stage's own outputs are untouched and the mock generator reuses the same code.

## NOT done
- No pipeline unit tests (the pipeline has no test suite); the shape check is `aggregate.validate` at publish time plus this run.
- The data branch does not carry the new keys until a green CI run lands after merge; the dashboard half tolerates their absence.

## Contract notes
- Additive note appended to `docs/contracts.md` (2026-11-14 23:00 PKT).
