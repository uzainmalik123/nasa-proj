// Risk ramp helpers for the panels. Same RISK_STOPS as the globe (palette.ts),
// so a table bar and a globe point for the same value are the same colour.
import { interpolateRgb } from "d3-interpolate";
import { scaleLinear } from "d3-scale";
import { P, RISK_STOPS } from "@/lib/palette";
import type { Category, Hazard } from "@/lib/types";

const riskScale = scaleLinear<string>()
  .domain(RISK_STOPS.map((s) => s[0]))
  .range(RISK_STOPS.map((s) => s[1]))
  .interpolate(interpolateRgb)
  .clamp(true);

/** Colour on the sequential risk ramp for v in [0, 1]. */
export function riskColour(v: number): string {
  return riskScale(Math.max(0, Math.min(1, v)));
}

/**
 * Where each category sits on the ramp: the wildfire probability at which it
 * starts (config.CATEGORY_THRESHOLDS, S2-B note 2026-11-14 10:05), so a chip
 * and a globe point for the same place get the same colour. Keep identical to
 * globe/colour.ts.
 */
export const CATEGORY_V: Record<Category, number> = {
  low: 0.03,
  elevated: 0.30,
  high: 0.60,
  extreme: 0.90,
};

/** Wildfire category thresholds as quoted in legends: "30 / 60 / 90 %". */
export const WILDFIRE_THRESHOLDS_PCT = `${CATEGORY_V.elevated * 100} / ${CATEGORY_V.high * 100} / ${CATEGORY_V.extreme * 100} %`;

/** Series colour bound to a hazard (DESIGN.md §5 hazard card borders). */
export const HAZARD_COLOUR: Record<Hazard, string> = {
  wildfire: P.s2,
  drought: P.s4,
  heat: P.critical,
  rain: P.s1,
};

/** Diverging colour for a change: orange rising, blue falling, muted flat. */
export function deltaColour(d: number | null | undefined, eps = 0): string {
  if (d == null || Math.abs(d) <= eps) return P.muted;
  return d > 0 ? P.s2 : P.s1;
}
