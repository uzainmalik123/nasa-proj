// Formatting helpers shared by the panels. DESIGN.md §6: units always present,
// timestamps `YYYY-MM-DD HH:MM UTC`, relative age only in the status pill.
import type { Category, Confidence, Hazard, Kind, Variable } from "./types";

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

export const KIND_LABEL: Record<Kind, string> = {
  observation: "observation",
  forecast: "forecast",
  risk_assessment: "risk assessment",
  trend: "trend",
};

export const CATEGORY_ORDER: Category[] = ["low", "elevated", "high", "extreme"];
export const CONFIDENCE_ORDER: Confidence[] = ["low", "medium", "high"];

/** "–" for null, otherwise a percent with no decimals. */
export function pct(p: number | null | undefined, digits = 0): string {
  return p == null ? "–" : `${(p * 100).toFixed(digits)}%`;
}

/** Signed number with a real minus sign. */
export function signed(x: number | null | undefined, digits: number): string {
  if (x == null) return "–";
  const s = Math.abs(x).toFixed(digits);
  return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

/** Decimal places that keep a slope readable at any magnitude. */
export function slopeDigits(x: number | null | undefined): number {
  if (x == null) return 2;
  const a = Math.abs(x);
  return a >= 10 ? 0 : a >= 1 ? 1 : a >= 0.1 ? 2 : 3;
}

export function fmtSlope(x: number | null | undefined): string {
  return signed(x, slopeDigits(x));
}

export function fmtP(p: number | null | undefined): string {
  if (p == null) return "–";
  return p < 0.001 ? "<0.001" : p.toFixed(p < 0.01 ? 3 : 2);
}

/** 11.1M, 320k, 48,211 style counts. */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString("en-US");
}

/** ISO "2026-11-14T00:38Z" or "…:38:00Z" → "2026-11-14 00:38"; caller adds "UTC". */
export function fmtUtc(iso: string | null | undefined, withSuffix = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withSuffix ? `${s} UTC` : s;
}

/** "YYYY-MM" → "Nov 26"; "YYYY-MM-DD" → "14 Nov". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}
export function fmtDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** Hours between an ISO timestamp and now (or `now`). */
export function ageHours(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 3_600_000;
}

/** "2h ago", "3d ago", "just now". */
export function fmtAge(hours: number | null): string {
  if (hours == null) return "never";
  if (hours < 1 / 60) return "just now";
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
