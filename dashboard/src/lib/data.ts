import type {
  Data, FeedFile, FiresFile, FreshnessFile, HonestyFile, PlacesFile, RiskFile, RunFile,
  SeriesFile, TrendsFile,
} from "./types";
import { acceptRun, probeVerdict, readStored, runIdOf, writeStored } from "./cache";

/**
 * Where the JSON lives. In production NEXT_PUBLIC_DATA_URL points at the raw
 * `data` branch (…/data/out); locally it falls back to the mock set in
 * public/data/. The base path is prepended for GitHub Pages sub-paths.
 */
export const DATA_URL: string =
  process.env.NEXT_PUBLIC_DATA_URL?.replace(/\/$/, "") ??
  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data`;

export const FILES = {
  places: "places.json",
  trends: "trends.json",
  risk: "risk.json",
  series: "series.json",
  fires: "fires_24h.json",
  feed: "feed.json",
  freshness: "freshness.json",
  honesty: "honesty.json",
  run: "run.json",
} as const;

/**
 * Cache-buster. raw.githubusercontent serves with max-age=300, so the value
 * changes every 5 min: viewers inside the same window share the CDN copy and
 * nobody sees a run older than one CDN window after it lands.
 */
function bust(): string {
  return `?v=${Math.floor(Date.now() / 300_000).toString(36)}`;
}

export async function loadJson<T>(file: string): Promise<T> {
  // "default", not "no-store": inside one 5-minute window the URL is the same, so a reload may reuse the HTTP cache
  const res = await fetch(`${DATA_URL}/${file}${bust()}`, { cache: "default" });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const FILE_COUNT = Object.keys(FILES).length;

/**
 * Fetch every published file, all nine in parallel (KI-7: the old run.json-
 * first step cost a round trip on every load). `onProgress(done, total)` fires
 * as each file lands so the UI can show "loading 3 of 9" instead of a bare
 * "connecting"; a run whose files disagree on run_id is still returned, the
 * freshness panel shows the ids.
 */
export async function loadAll(onProgress?: (done: number, total: number) => void): Promise<Data> {
  let done = 0;
  const get = async <T,>(file: string): Promise<T> => {
    const out = await loadJson<T>(file);
    onProgress?.(++done, FILE_COUNT);
    return out;
  };
  const [places, trends, risk, series, fires, feed, freshness, honesty, run] = await Promise.all([
    get<PlacesFile>(FILES.places),
    get<TrendsFile>(FILES.trends),
    get<RiskFile>(FILES.risk),
    get<SeriesFile>(FILES.series),
    get<FiresFile>(FILES.fires),
    get<FeedFile>(FILES.feed),
    get<FreshnessFile>(FILES.freshness),
    get<HonestyFile>(FILES.honesty),
    get<RunFile>(FILES.run),
  ]);
  return { places, trends, risk, series, fires, feed, freshness, honesty, run };
}

// ---- run-id keyed cache (KI-7 step 1c) -------------------------------------

/** Re-probe interval. raw.githubusercontent's CDN max-age is 300 s: a probe sooner cannot see a newer run. */
export const PROBE_MS = 5 * 60_000;

export type DataSource = "cache" | "network";
/** What the probe is doing, for the live pill. */
export type ProbeState = "checking" | "current" | "updated" | "offline";

export interface LoadHandlers {
  onProgress: (done: number, total: number) => void;
  onData: (data: Data, source: DataSource) => void;
  onProbe: (state: ProbeState) => void;
}

/**
 * Load for first paint: the cached run first, if any (instant, no network),
 * then the probe decides whether a fetch is needed. Rejects only when there is
 * no cached run and the network fails, as `loadAll` did.
 */
export async function loadData(h: LoadHandlers): Promise<void> {
  const cached = await readStored();
  if (cached) h.onData(cached.data, "cache");
  await probeAndRefresh(cached?.runId ?? null, h, cached != null);
}

/**
 * Fetch run.json fresh and compare. Same id → nothing else moves (one ~1 KB
 * request). A different id → fetch the nine files; they replace the cached run
 * only when they agree on one newer id (`acceptRun`), else the CDN is
 * mid-publish and the next probe retries. Returns the run id now on screen.
 */
export async function probeAndRefresh(cachedRunId: string | null, h: LoadHandlers, haveCache = cachedRunId != null): Promise<string | null> {
  h.onProbe("checking");
  const probe = await loadJson<RunFile>(FILES.run).then((r) => r.run_id, () => null);
  if (probeVerdict(cachedRunId, probe) === "current") {
    h.onProbe(probe ? "current" : "offline");
    return cachedRunId;
  }
  let fresh: Data;
  try {
    fresh = await loadAll(h.onProgress);
  } catch (e) {
    if (!haveCache) throw e;
    h.onProbe("offline");
    return cachedRunId;
  }
  if (!acceptRun(fresh, cachedRunId)) {
    h.onProbe("current");
    return cachedRunId;
  }
  const runId = runIdOf(fresh) ?? fresh.run.run_id;
  h.onData(fresh, "network");
  h.onProbe("updated");
  void writeStored({ runId, savedAt: Date.now(), data: fresh });
  return runId;
}
