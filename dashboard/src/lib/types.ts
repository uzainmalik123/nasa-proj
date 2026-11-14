// Mirrors docs/contracts.md §3 exactly. Do not add fields here without a
// dated note in contracts.md.

export type Hazard = "wildfire" | "drought" | "heat" | "rain";
export const HAZARDS: Hazard[] = ["wildfire", "drought", "heat", "rain"];

export type Variable = "rain_mm" | "tmax_c" | "rh_pct" | "wind_ms" | "soil_wet" | "fires" | "ndvi";
export const VARIABLES: Variable[] = ["rain_mm", "tmax_c", "rh_pct", "wind_ms", "soil_wet", "fires"];

export type Kind = "observation" | "forecast" | "risk_assessment" | "trend";
export type Confidence = "high" | "medium" | "low";
export type Category = "low" | "elevated" | "high" | "extreme";
export type TrendLabel = "rising" | "falling" | "stable" | "insufficient";
export type SourceStatus = "ok" | "stale" | "missing";
export type AlertTrigger = "category_up" | "z_above_2" | "new_anomaly";
export type AlertStatus = "active" | "updated" | "expired";
export type Mode = "now" | "next14";

export interface Meta {
  run_id: string;       // YYYYMMDDTHHMMZ
  generated_at: string; // ISO 8601 Z
  tier: number;
}

// ---- places.json ----------------------------------------------------------
export interface Place {
  id: string;
  name: string;
  country: string;
  continent: string;
  lat: number;
  lon: number;
  pop: number;
  radius_km: number;
  capital: boolean;
}
export interface PlacesFile { meta: Meta; places: Place[] }

// ---- trends.json ----------------------------------------------------------
export interface TrendWindow {
  window: string;                 // "10y" | "90d"
  slope: (number | null)[][];     // [place][variable]
  p: (number | null)[][];         // [place][variable]
  label: TrendLabel[][];          // [place][variable]
}
export interface TrendsFile {
  meta: Meta;
  variables: Variable[];
  units: string[];
  long: TrendWindow;
  short: TrendWindow;
  series_long: (number | null)[][][]; // [place][variable][month], 120 values
  months: string[];                   // "YYYY-MM"
}

// ---- risk.json ------------------------------------------------------------
export interface HazardBase {
  severity: number;
  exposure: number;
  confidence: Confidence;
  category: Category;
}
export interface WildfireNow extends HazardBase { p: number }
export interface DroughtNow extends HazardBase { index: number }
export interface HeatNow extends HazardBase { days_above: number }
export interface RainNow extends HazardBase { p: number }
export interface RiskNow {
  wildfire: WildfireNow;
  drought: DroughtNow;
  heat: HeatNow;
  rain: RainNow;
}
export interface ShapDriver { feature: string; label: string; shap: number; value: number }
export interface ReasonDriver { reason: string }
export interface Drivers {
  wildfire: ShapDriver[];
  drought: ReasonDriver[];
  heat: ReasonDriver[];
  rain: ReasonDriver[];
}
export type HazardText = Record<Hazard, string>;
export interface ModelInfo {
  name: string;
  version: string;
  pr_auc: number;
  baseline_pr_auc: number;
  brier: number;
  holdout: [string, string];
}
// movers / continents: additive blocks, contracts.md note 2026-11-14 23:00 PKT (S2-C).
// Older runs on the data branch lack them; lib/aggregate.ts recomputes the same
// thing in the browser when they are missing.
export interface MoverRow {
  place: number;          // index into places
  id: string;
  value: number | null;   // today's headline (p / index / days_above)
  ago: number | null;     // hindcast value on `since`
  delta: number | null;   // value − ago, native units; for drought a rising mover has delta < 0
  category: Category;
  exposure: number;
}
export interface MoversBlock {
  key: "p" | "index" | "days_above";
  since: string;          // history day 7 days before today
  up: MoverRow[];         // ≤ 10, most risk gained first
  down: MoverRow[];       // ≤ 10, most risk lost first
}
export type Movers = Record<Hazard, MoversBlock>;
export type CategoryCounts = Record<Category, number>;
export interface Continents {
  names: string[];                               // sorted, continents present
  n: number[];                                   // places per continent
  pop: number[];                                 // summed exposure
  counts: Record<Hazard, CategoryCounts[]>;      // [continent]
  mean_now: Record<Hazard, (number | null)[]>;   // [continent], headline mean
  mean_history: Record<Hazard, (number | null)[][]>; // [continent][day], history_days axis
}
export interface RiskFile {
  meta: Meta;
  hazards: Hazard[];
  valid_from: string;
  valid_to: string;
  now: RiskNow[];                               // per place
  history_days: string[];                       // 90 dates
  history: Record<Hazard, (number | null)[][]>; // [place][day]
  forecast_days: string[];                      // 16 dates
  fwi_forecast: (number | null)[][];            // [place][day]
  drivers: Drivers[];                           // per place
  text: HazardText[];                           // per place
  model: ModelInfo;
  movers?: Movers;
  continents?: Continents;
}

// ---- series.json ----------------------------------------------------------
export interface SeriesFile {
  meta: Meta;
  days: string[];
  rain_30d: (number | null)[][];
  rain_30d_norm: (number | null)[][];
  rain_30d_sd: (number | null)[][];
  tmax: (number | null)[][];
  tmax_norm: (number | null)[][];
  tmax_sd: (number | null)[][];
  soil_wet: (number | null)[][];
  soil_wet_norm: (number | null)[][];
  soil_wet_sd: (number | null)[][];
  fires_7d: (number | null)[][];
}

// ---- fires_24h.json -------------------------------------------------------
export type FireBin = [lon: number, lat: number, count: number, max_frp: number];
export interface FiresFile {
  meta: Meta;
  source: string;
  newest_acq: string;
  bins: FireBin[];
}

// ---- feed.json ------------------------------------------------------------
export interface Alert {
  id: string;
  hazard: Hazard;
  place: number;      // index into places
  place_id: string;
  issued_at: string;
  valid_from: string;
  valid_to: string;
  trigger: AlertTrigger;
  probability: number | null;
  severity: number;
  exposure: number;
  confidence: Confidence;
  category: Category;
  evidence: string[];
  anomalies: string[];
  explanation: string;
  status: AlertStatus;
  model_version: string;
}
export interface FeedFile { meta: Meta; alerts: Alert[] }

// ---- freshness.json -------------------------------------------------------
export interface SourceRow {
  name: string;
  kind: Kind;
  product: string;
  valid_for: string | null;
  retrieved_at: string | null;
  records: number | null;
  latency_doc: string;
  status: SourceStatus;
  url: string;
}
export interface FreshnessFile { meta: Meta; sources: SourceRow[] }

// ---- honesty.json ---------------------------------------------------------
export interface HonestyBucket { lo: number; hi: number; n: number; pred: number; obs: number }
export interface RunSummary {
  run_id: string;
  ok: boolean;
  failed_gate: string | null;
  duration_s: number;
}
export interface HonestyFile {
  meta: Meta;
  mode: "hindcast" | "published";
  window: [string, string];
  buckets: HonestyBucket[];
  top20_hit_rate: number;
  baseline_top20_hit_rate: number;
  runs: RunSummary[];
}

// ---- run.json -------------------------------------------------------------
export interface Gate { value: number | null; pass: boolean | null }
export interface RunFile {
  run_id: string;
  tier: number;
  n_places: number;
  started: string;
  finished: string;
  duration_s: number;
  gates: Record<string, Gate>;
  ok: boolean;
  metrics: { pr_auc: number; baseline_pr_auc: number; brier: number };
}

// ---- everything loadAll() returns ------------------------------------------
export interface Data {
  places: PlacesFile;
  trends: TrendsFile;
  risk: RiskFile;
  series: SeriesFile;
  fires: FiresFile;
  feed: FeedFile;
  freshness: FreshnessFile;
  honesty: HonestyFile;
  run: RunFile;
}
