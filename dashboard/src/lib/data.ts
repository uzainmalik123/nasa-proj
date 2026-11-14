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

/**
 * Cache-buster. raw.githubusercontent serves with max-age=300, so the value
 * changes every 5 min: viewers inside the same window share the CDN copy and
 * nobody sees a run older than one CDN window after it lands.
 */
function bust(): string {
  return `?v=${Math.floor(Date.now() / 300_000).toString(36)}`;
}

export async function loadJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_URL}/${file}${bust()}`, { cache: "no-store" });
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
