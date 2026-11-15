# Data cache · a reload fetches 1 KB, not 2.1 MB (KI-7 step 1c)

15 Nov 2026 (`data-cache`, branched from `origin/main` 7d33d5d). Every reload re-downloaded all nine published files (2.1 MB gzipped, 10.6 MB parsed) because `loadJson` fetched with `cache: "no-store"` and a 5-minute cache-buster, while the pipeline publishes a new run only every 3–6 hours. The cache is keyed by run id and never trusted on its own, so staleness does not get worse: the worst case stays the CDN's 5-minute max-age, and an open tab now sees a new run within 5 minutes, where before it never updated.

## What changed

- `lib/cache.ts` (new): the pure decisions, tested: `fileRunId` (run.json carries the id at the top, the others under `meta`), `runIdOf` (the one id all nine agree on, else null), `probeVerdict` (nothing cached → refresh; probe failed → keep; else refresh iff the ids differ), `acceptRun` (a fetched set replaces a cached run only when consistent and newer; run ids are UTC timestamps so string order is time order; with nothing cached any set is shown, as before). Plus the IndexedDB store: one structured clone of `Data` under the key `current`, no JSON round trip; every failure (private mode, quota) is swallowed and the app behaves as before the cache existed.
- `lib/data.ts`: `loadData(handlers)` renders the cached run at once, then `probeAndRefresh` fetches `run.json` fresh and compares; same id → done (one ~1 KB request); a different id → `loadAll`, accepted only per `acceptRun`, then stored. `PROBE_MS` = 300 s, the CDN max-age: a sooner probe cannot see a newer run. `loadJson` uses `cache: "default"` so the HTTP cache serves repeat fetches inside one buster window.
- `components/Dashboard.tsx`: the load effect uses `loadData`; a timer re-probes every `PROBE_MS` while the tab is visible and when it comes back after that long; a newer run carries the selection over by place id (indices can move between runs) and drops it if the place is gone. Pill: "· checking for a newer run" during the probe, "· offline, showing the cached run" in `warning` when it fails; the tooltip adds "from the browser cache" / "from the network".
- `scripts/test-resolve.mjs` + `npm test`: the node test harness (same files as the KI-2 branch; identical content, merges clean). `lib/cache.test.ts`: eight cases.
- `docs/KNOWN_ISSUES.md` KI-7 step 1c; `docs/DESIGN.md` §3 pill wording.

## Proof

`docs/handback/data-cache/cache-proof.mjs` counts the data requests the local server logs per scenario (one browser context = one IndexedDB), mutating the served files' run ids between visits. Output in `data-cache/cache-proof.txt`:

```
[first visit] 10 data requests          · run 20261115T0417Z · from the network
[reload] 1 data requests: run           · run 20261115T0417Z · from the browser cache
[half-published run] 10 data requests   · still 20261115T0417Z from the browser cache (files disagree → kept)
[new run published] 10 data requests    · run 20261115T2359Z · from the network
[reload after the new run] 1 request    · run 20261115T2359Z · from the browser cache
[probe fails] 1 request                 · pill "live · updated 1h ago · offline, showing the cached run"
page errors: 0 · all checks passed
```

Timed against the real CDN (`NEXT_PUBLIC_DATA_URL=https://raw.githubusercontent.com/uzainmalik123/nasa-proj/data/out`, headless Chromium, swiftshader):

| | to first content | data requests |
|---|---|---|
| first visit | 9.9 s | 10 (probe + nine) |
| reload | 1.1 s | 1 (run.json) |

Screenshots `data-cache/cache-first-visit.png`, `cache-reload.png`, `cache-new-run.png`, `cache-offline.png` show the pill in each state. `npm run lint`, `npm test` (8 pass) and `npm run build` pass.

## Not done / calls

- **The first visit is unchanged at ~10 s** (2.1 MB on the wire, 10.6 MB parsed). That is KI-7 step 2: split the per-place detail (`trends.series_long`, `series.json`, risk `history` / `drivers` / `text`) into one small file per place fetched on select. Pipeline + contract change, S2 + S4, 2–3 h; the sketch is in KI-7.
- The probe fetches `run.json` and `loadAll` fetches it again on a refresh (the tenth request, 1 KB); not worth a special case.
- A newer run replaces the data on screen silently apart from the pill's age resetting. If a visible "updated to a newer run" note is wanted, `ProbeState` already has `"updated"`.
