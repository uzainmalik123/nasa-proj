// globe/fires.ts · shared facts of the FIRMS active-fire layer (KI-1).
// fires_24h.json publishes 0.25° bins, not detections (contracts.md §3): every
// dot is a cell centre and `count` is how many VIIRS detections fell in that
// cell in the last 24 h. The radius grows with sqrt(count) so the dot's area
// tracks the count: 1 → 2.7 px, 39 → 6.4 px, 174 → 11.2 px (the live maximum
// on 14 Nov 2026). The legend draws its samples with the same function.
import type { ExpressionSpecification } from "maplibre-gl";
import { fmtDay } from "@/lib/format";

export const FIRE_CELL_DEG = 0.25;
export const FIRE_FILL = "#fff7ed";
export const FIRE_STROKE = "#d03b3b";

const DOT_BASE = 2;
const DOT_K = 0.7;
const GLOW_BASE = 4;
const GLOW_K = 1.8;
// At the global zoom (1.6) the 0.25° cells are half a pixel apart, so the full
// radii would only thicken the blobs; the dots start at 0.75 of the size and
// reach it by zoom 5 (the fly-to zoom, where cells are 6 px apart and separate).
const ZOOM_SMALL = 1.6;
const ZOOM_FULL = 5;
const SMALL_SCALE = 0.75;

/** Dot radius in px for a cell with `count` detections, at zoom ≥ 5 (what the legend samples show). */
export function fireDotRadius(count: number): number {
  return DOT_BASE + DOT_K * Math.sqrt(Math.max(count, 1));
}

const SQRT_COUNT: ExpressionSpecification = ["sqrt", ["max", ["get", "count"], 1]];
function byZoom(base: number, k: number): ExpressionSpecification {
  const full: ExpressionSpecification = ["+", base, ["*", k, SQRT_COUNT]];
  return ["interpolate", ["linear"], ["zoom"], ZOOM_SMALL, ["*", SMALL_SCALE, full], ZOOM_FULL, full];
}
export const FIRE_DOT_RADIUS = byZoom(DOT_BASE, DOT_K);
export const FIRE_GLOW_RADIUS = byZoom(GLOW_BASE, GLOW_K);

/** "VIIRS_NOAA21_NRT" → "VIIRS NOAA-21"; an unknown id passes through with spaces. */
export function fireSourceLabel(source: string): string {
  return source.replace(/_(NRT|SP)$/, "").replace(/NOAA(\d+)/, "NOAA-$1").replace(/_/g, " ");
}

/** Fire radiative power: "173" above 10 MW, one decimal below. */
export function fmtFrp(mw: number | null | undefined): string {
  if (mw == null || !Number.isFinite(mw)) return "–";
  return mw >= 10 ? String(Math.round(mw)) : mw.toFixed(1);
}

/** Bin centre as "6.1°N 3.4°E". */
export function fmtCentre(lon: number, lat: number): string {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}°${v < 0 ? neg : pos}`;
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}

/** "2026-11-14T14:52Z" → "14 Nov 14:52 UTC". */
export function fmtAcq(iso: string | null | undefined): string {
  if (!iso || iso.length < 16) return "–";
  return `${fmtDay(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
}
