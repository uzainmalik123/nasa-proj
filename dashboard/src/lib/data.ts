import type {
  Data, FeedFile, FiresFile, FreshnessFile, HonestyFile, PlacesFile, RiskFile, RunFile,
  SeriesFile, TrendsFile,
} from "./types";

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

/** Cache-buster: a fresh value per page load, or the run id once we know it. */
function bust(v?: string): string {
  return `?v=${v ?? Date.now().toString(36)}`;
}

export async function loadJson<T>(file: string, v?: string): Promise<T> {
  const res = await fetch(`${DATA_URL}/${file}${bust(v)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Fetch every published file. run.json is fetched first so the remaining
 * requests can use its run_id as a stable cache key.
 */
export async function loadAll(): Promise<Data> {
  const run = await loadJson<RunFile>(FILES.run);
  const v = run.run_id;
  const [places, trends, risk, series, fires, feed, freshness, honesty] = await Promise.all([
    loadJson<PlacesFile>(FILES.places, v),
    loadJson<TrendsFile>(FILES.trends, v),
    loadJson<RiskFile>(FILES.risk, v),
    loadJson<SeriesFile>(FILES.series, v),
    loadJson<FiresFile>(FILES.fires, v),
    loadJson<FeedFile>(FILES.feed, v),
    loadJson<FreshnessFile>(FILES.freshness, v),
    loadJson<HonestyFile>(FILES.honesty, v),
  ]);
  return { places, trends, risk, series, fires, feed, freshness, honesty, run };
}
