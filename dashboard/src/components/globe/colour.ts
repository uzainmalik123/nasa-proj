// Colouring rules for the globe points. Pure functions, no DOM, so the
// Legend and the hover tooltip derive from the same numbers as the layer.
import { interpolateRgb } from "d3-interpolate";
import { scaleLinear } from "d3-scale";
import { P, RISK_STOPS } from "@/lib/palette";
import type { Category, Hazard, Mode, RiskNow, TrendsFile, Variable } from "@/lib/types";

/** What drives colour and radius right now. Derived from props only. */
export type Colouring =
  | { kind: "risk"; hazard: Hazard; mode: Mode; continuous: boolean; validFrom?: string; validTo?: string }
  | { kind: "trend"; variable: Variable; unit: string; scale: number; window: string };

/** Per-feature state pushed to MapLibre: magnitude 0..1, radius px, colour, opacity. */
export interface PointState {
  v: number;
  r: number;
  color: string;
  o: number;
  sig: boolean;
}

/** Radius range for a place point (DESIGN.md §4: 3 px watched → 11 px). */
export const R_MIN = 3;
export const R_MAX = 11;

/**
 * Risk radius follows the same rank breakpoints as the colour ramp, so size
 * and colour agree on "unusual for the world right now": watched below the
 * 50th pct, small to the 80th, mid to the 95th, full at the 99th.
 */
const RISK_RADIUS_PX = [3, 3.5, 5, 8, 11, 11];
const riskRadius = scaleLinear<number>()
  .domain(RISK_STOPS.map((s) => s[0]))
  .range(RISK_RADIUS_PX)
  .clamp(true);

/** Trend radius: linear on the normalised |slope| (floored at TREND_FLOOR). */
export function trendRadius(v: number): number {
  return R_MIN + (R_MAX - R_MIN) * Math.max(0, Math.min(1, v));
}
export function riskRadiusPx(v: number): number {
  return riskRadius(v);
}

export const HAZARD_LABEL: Record<Hazard, string> = {
  wildfire: "wildfire",
  drought: "drought",
  heat: "heat",
  rain: "heavy rain",
};

export const VARIABLE_LABEL: Record<Variable, string> = {
  rain_mm: "rainfall",
  tmax_c: "max temperature",
  rh_pct: "humidity",
  wind_ms: "wind",
  soil_wet: "soil wetness",
  fires: "fire detections",
  ndvi: "vegetation (NDVI)",
};

/** Hazards whose headline number is a calibrated probability. */
export const CONTINUOUS_HAZARD: Record<Hazard, boolean> = {
  wildfire: true,
  rain: true,
  drought: false,
  heat: false,
};

/**
 * Where each category sits on the risk ramp: the probability at which it
 * starts (config.CATEGORY_THRESHOLDS["wildfire"], 14 Nov 2026), so a chip and
 * a globe point for the same place get the same colour. Keep identical to
 * charts/ramp.ts.
 */
export const CATEGORY_V: Record<Category, number> = {
  low: 0.03,
  elevated: 0.3,
  high: 0.6,
  extreme: 0.9,
};
export const CATEGORIES: Category[] = ["low", "elevated", "high", "extreme"];

/** Category thresholds quoted in the legend for the probability hazards (config.py). */
export const CATEGORY_THRESHOLD_P: Record<"wildfire" | "rain", Record<Exclude<Category, "low">, number>> = {
  wildfire: { elevated: 0.3, high: 0.6, extreme: 0.9 },
  rain: { elevated: 0.1, high: 0.25, extreme: 0.5 },
};

/** Below the first ramp stop a place renders as a 3 px muted dot (DESIGN.md §4). */
export const RISK_FLOOR = RISK_STOPS[1][0];
/** Significant trend points never shrink to the muted size. */
export const TREND_FLOOR = 0.2;

const riskScale = scaleLinear<string>()
  .domain(RISK_STOPS.map((s) => s[0]))
  .range(RISK_STOPS.map((s) => s[1]))
  .interpolate(interpolateRgb)
  .clamp(true);

export function riskColour(v: number): string {
  return riskScale(v);
}

const toBlue = interpolateRgb(P.muted, P.s1);
const toOrange = interpolateRgb(P.muted, P.s2);

/** Diverging colour for a normalised slope t in [-1, 1]. */
export function trendColour(t: number): string {
  const m = Math.min(1, Math.abs(t));
  return t < 0 ? toBlue(m) : toOrange(m);
}

/**
 * 0..1 magnitude for a hazard. `continuous` = the forecast probability for the
 * p-hazards (mode "next14"); otherwise the stop where the current category
 * starts (mode "now", and drought / heat in either mode: they publish no p).
 */
export function hazardMagnitude(h: Hazard, r: RiskNow, continuous = true): number {
  const row = r[h];
  if (continuous && "p" in row && typeof row.p === "number") return Math.max(0, Math.min(1, row.p));
  return CATEGORY_V[row.category] ?? 0;
}

/** Tooltip text for a hazard. */
export function hazardText(h: Hazard, r: RiskNow): string {
  const row = r[h];
  switch (h) {
    case "wildfire":
      return `${pct(r.wildfire.p)} · ${row.category}`;
    case "rain":
      return `${pct(r.rain.p)} · ${row.category}`;
    case "drought":
      return `index ${signed(r.drought.index, 1)} · ${row.category}`;
    case "heat":
      return `${r.heat.days_above} d above P95 · ${row.category}`;
  }
}

/**
 * Slope normaliser for one variable: the median |slope| across significant
 * places, so half of the significant points reach full saturation and one
 * outlier cannot wash the rest out to grey.
 */
export function trendScale(trends: TrendsFile, vi: number): number {
  const w = trends.long;
  const sig: number[] = [];
  const all: number[] = [];
  for (let i = 0; i < w.slope.length; i++) {
    const s = w.slope[i]?.[vi];
    const p = w.p[i]?.[vi];
    if (s == null) continue;
    all.push(Math.abs(s));
    if (p != null && p < 0.05) sig.push(Math.abs(s));
  }
  const pool = (sig.length >= 3 ? sig : all).sort((a, b) => a - b);
  if (!pool.length) return 1;
  const q = pool[Math.min(pool.length - 1, Math.floor(pool.length * 0.5))];
  return q > 0 ? q : pool[pool.length - 1] || 1;
}

export function trendText(trends: TrendsFile, i: number, vi: number): string {
  const s = trends.long.slope[i]?.[vi];
  const p = trends.long.p[i]?.[vi];
  const label = trends.long.label[i]?.[vi] ?? "insufficient";
  if (s == null || p == null) return "insufficient data";
  const unit = trends.units[vi] ?? "";
  return `${signed(s, slopeDigits(s))} ${unit} · p=${p.toFixed(2)} · ${label}`;
}

/**
 * Choose the colouring from props. A trend variable (the parent's "globe =
 * trend" lens, M-MODE+URL) colours by its 10-year slope; otherwise the hazard
 * colours the globe, as its current category in mode "now" and as the
 * forecast probability in mode "next14" (category for drought / heat, which
 * publish no probability).
 */
export function pickColouring(
  mode: Mode,
  hazard: Hazard,
  trendVar: Variable | null,
  trends: TrendsFile | null,
  risk: { valid_from: string; valid_to: string } | null,
): Colouring {
  if (trendVar && trends) {
    const vi = trends.variables.indexOf(trendVar);
    if (vi >= 0) {
      return {
        kind: "trend",
        variable: trendVar,
        unit: trends.units[vi] ?? "",
        scale: trendScale(trends, vi),
        window: trends.long.window,
      };
    }
  }
  return {
    kind: "risk",
    hazard,
    mode,
    continuous: mode === "next14" && CONTINUOUS_HAZARD[hazard],
    validFrom: risk?.valid_from,
    validTo: risk?.valid_to,
  };
}

/** Opacity of a place outside the active continent filter. */
export const FILTERED_OPACITY = 0.12;

/**
 * Feature state for every place under the given colouring. `keep` is the set
 * of indices inside the continent filter; places outside it are dimmed to a
 * 3 px muted dot at FILTERED_OPACITY. null = no filter.
 */
export function pointStates(
  c: Colouring,
  n: number,
  risk: { now: RiskNow[] } | null,
  trends: TrendsFile | null,
  keep: Set<number> | null = null,
): PointState[] {
  const out: PointState[] = new Array(n);
  const dim: PointState = { v: 0, r: R_MIN, color: P.muted, o: 0.5, sig: false };
  const off: PointState = { v: 0, r: R_MIN, color: P.muted, o: FILTERED_OPACITY, sig: false };
  const skip = (i: number) => keep != null && !keep.has(i);
  if (c.kind === "risk") {
    for (let i = 0; i < n; i++) {
      if (skip(i)) { out[i] = off; continue; }
      const r = risk?.now[i];
      if (!r) { out[i] = dim; continue; }
      const v = hazardMagnitude(c.hazard, r, c.continuous);
      out[i] = v < RISK_FLOOR ? dim : { v, r: riskRadius(v), color: riskColour(v), o: 1, sig: true };
    }
    return out;
  }
  const vi = trends ? trends.variables.indexOf(c.variable) : -1;
  for (let i = 0; i < n; i++) {
    if (skip(i)) { out[i] = off; continue; }
    const s = trends?.long.slope[i]?.[vi];
    const p = trends?.long.p[i]?.[vi];
    if (s == null || p == null || p >= 0.05) { out[i] = dim; continue; }
    const t = Math.max(-1, Math.min(1, s / c.scale));
    const v = Math.max(TREND_FLOOR, Math.abs(t));
    out[i] = { v, r: trendRadius(v), color: trendColour(t), o: 1, sig: true };
  }
  return out;
}

/** Indices of places on `continent`; null when no continent is chosen. */
export function continentSet(places: { continent: string }[], continent: string | null | undefined): Set<number> | null {
  if (!continent) return null;
  const set = new Set<number>();
  places.forEach((p, i) => { if (p.continent === continent) set.add(i); });
  return set;
}

// ---- formatting ------------------------------------------------------------
export function pct(p: number | null | undefined): string {
  return p == null ? "–" : `${Math.round(p * 100)}%`;
}
export function signed(x: number, digits: number): string {
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : x < 0 ? `−${s.slice(1)}` : s;
}
export function slopeDigits(x: number): number {
  const a = Math.abs(x);
  return a >= 10 ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3;
}
