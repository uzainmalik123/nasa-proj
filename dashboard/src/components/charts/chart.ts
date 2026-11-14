// Shared chart arithmetic for the measured SVG charts (DESIGN.md §5). Pure
// functions so the components stay thin and the maths is testable in isolation.
import { scaleLinear } from "d3-scale";

/** Plot margins per DESIGN.md §5: left 34–36 for a mono y axis, right 6–8, top 8–20, bottom 22 with x labels. */
export const M = { left: 36, right: 8, top: 10, bottom: 22 };

export function finite(xs: (number | null | undefined)[]): number[] {
  return xs.filter((v): v is number => v != null && Number.isFinite(v));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Sen's line through a series: y = slope · t + b with b the median residual,
 * which is how the Theil–Sen intercept is defined. `t` is in the slope's own
 * time unit (years), `stepYears` is the spacing of consecutive samples.
 * Returns the line's endpoints or null when there is nothing to anchor it to.
 */
export function senLine(
  values: (number | null)[], slope: number | null | undefined, stepYears: number,
): { y0: number; y1: number } | null {
  if (slope == null || !Number.isFinite(slope) || values.length < 2) return null;
  const res: number[] = [];
  values.forEach((v, i) => { if (v != null && Number.isFinite(v)) res.push(v - slope * i * stepYears); });
  const b = median(res);
  if (b == null) return null;
  return { y0: b, y1: b + slope * (values.length - 1) * stepYears };
}

/** y domain with a little headroom that also contains the extra points (a fitted line, a band). */
export function yDomain(values: (number | null)[], extra: (number | null | undefined)[] = [], pad = 0.08): [number, number] {
  const xs = finite([...values, ...extra]);
  if (!xs.length) return [0, 1];
  let lo = Math.min(...xs), hi = Math.max(...xs);
  if (hi === lo) { lo -= 1; hi += 1; }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

/** 3–4 round-number y ticks inside the domain. */
export function yTicks(domain: [number, number], n = 4): number[] {
  return scaleLinear().domain(domain).ticks(n);
}

/** Compact mono tick label: 0.42, 12, 1.2k. */
export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, "");
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return "0";
  return v.toFixed(2);
}

/** Indices to label on the x axis: roughly every `every` points, first included, never the last two. */
export function xLabelIdx(n: number, every: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n - every / 2; i += every) out.push(i);
  return out;
}

/** z-score vs a normal and sd; null when either is missing or sd is 0. */
export function zScore(v: number | null, norm: number | null, sd: number | null): number | null {
  if (v == null || norm == null || sd == null || !(sd > 0)) return null;
  return (v - norm) / sd;
}

/** Nearest sample index to a pointer x inside the plot (scalePoint.step() equivalent). */
export function nearestIdx(px: number, x0: number, x1: number, n: number): number {
  if (n <= 1) return 0;
  const step = (x1 - x0) / (n - 1);
  return Math.max(0, Math.min(n - 1, Math.round((px - x0) / step)));
}
