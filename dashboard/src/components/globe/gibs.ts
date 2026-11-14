// gibs.ts · NASA GIBS WMTS layers for the globe overlay (PRD M1, §6 URL).
// Pure helpers: the layer registry, the 30-day slider range, the tile URL
// and the "step back one day on a 404" resolver. No React, no map handle.
import { P } from "@/lib/palette";

/** PRD §6 WMTS URL with {layer} {date} {level} {ext} placeholders; {z}/{y}/{x} are left to MapLibre. */
export const GIBS_WMTS_TEMPLATE =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{date}/GoogleMapsCompatible_Level{level}/{z}/{y}/{x}.{ext}";

/** Days the date slider spans (PRD M1). */
export const GIBS_SLIDER_DAYS = 30;
/** How many days the resolver steps back from a 404 before giving up. */
export const GIBS_MAX_STEP_BACK = 7;

export interface GibsLayer {
  id: string;
  ext: "png" | "jpg";
  /** GoogleMapsCompatible_Level{N}: the deepest native zoom. */
  level: number;
  label: string;
  short: string;
  /** DESIGN.md series colour bound to the layer's meaning (rain blue, vegetation aqua, temperature yellow). */
  colour: string;
  /** One line under the caption: what one image is. */
  note: string;
  /**
   * Legend swatch: nine colours sampled from the layer's own GIBS colormap
   * (colormaps/v1.3, fetched 14 Nov 2026) between the two labelled values.
   * null = natural colour, no swatch.
   */
  swatch: { colours: string[]; lo: string; hi: string } | null;
}

export const GIBS_LAYERS = {
  rain: {
    id: "IMERG_Precipitation_Rate", ext: "png", level: 6,
    label: "rain rate (IMERG)", short: "rain", colour: P.s1,
    note: "GPM IMERG half-hourly rate, one daily image",
    // GPM_Precipitation_Rate colormap, 0.1 → 50 mm/h (log-spaced in the source)
    swatch: {
      colours: ["#00764e", "#009c14", "#45c000", "#c3e400", "#ffa00c", "#ff4233", "#e10000", "#900000", "#390000"],
      lo: "0.1", hi: "50 mm/h",
    },
  },
  ndvi: {
    id: "MODIS_Terra_NDVI_8Day", ext: "png", level: 9,
    label: "vegetation (MODIS NDVI)", short: "vegetation", colour: P.s3,
    note: "MODIS Terra 8-day composite, the period containing the date",
    // MODIS_NDVI colormap, 0 → 1
    swatch: {
      colours: ["#f1ecec", "#e1d2c6", "#b4a596", "#a18063", "#96ba20", "#56a101", "#2e8000", "#006400", "#001801"],
      lo: "0", hi: "1 NDVI",
    },
  },
  lst: {
    id: "MODIS_Terra_Land_Surface_Temp_Day", ext: "png", level: 7,
    label: "surface temp (MODIS LST)", short: "surface temp", colour: P.s4,
    note: "MODIS Terra daytime pass, land only",
    // MODIS_Land_Surface_Temp colormap, 243 → 323 K
    swatch: {
      colours: ["#007aff", "#00d1ff", "#1dffbc", "#5bff2b", "#95ff00", "#d7ff00", "#ffee00", "#ffbe00", "#ff8800"],
      lo: "−30", hi: "50 °C",
    },
  },
  truecolor: {
    id: "MODIS_Terra_CorrectedReflectance_TrueColor", ext: "jpg", level: 9,
    label: "true colour (MODIS)", short: "true colour", colour: P.ink2,
    note: "MODIS Terra corrected reflectance",
    swatch: null,
  },
} as const satisfies Record<string, GibsLayer>;

export type GibsLayerKey = keyof typeof GIBS_LAYERS;

/** The three layers PRD M1 puts on the toggles; `truecolor` stays reachable by URL only. */
export const GIBS_TOGGLE_KEYS: readonly GibsLayerKey[] = ["rain", "ndvi", "lst"];

/** What the map is actually showing after the 404 fallback. */
export interface GibsValid {
  key: GibsLayerKey;
  /** The slider date. */
  requested: string;
  /** The date whose tiles are on the map, or null if none within GIBS_MAX_STEP_BACK days. */
  valid: string | null;
  /** Days stepped back from `requested`. */
  steps: number;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return isoDay(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000);
}

/**
 * The slider's newest day is today (UTC). Whether GIBS has that day yet
 * (IMERG and NDVI usually lag a day, LST is same-day) is what the 404
 * fallback in resolveGibsDate finds out and the caption reports.
 */
export function gibsNewestDate(_key: GibsLayerKey, now: number = Date.now()): string {
  return isoDay(now);
}

/** The slider's [min, max], GIBS_SLIDER_DAYS long and ending at the newest date. */
export function gibsDateRange(key: GibsLayerKey, now: number = Date.now()): { min: string; max: string } {
  const max = gibsNewestDate(key, now);
  return { min: addDays(max, -(GIBS_SLIDER_DAYS - 1)), max };
}

/** A date inside the slider range; null or malformed → newest. */
export function clampGibsDate(key: GibsLayerKey, date: string | null | undefined, now: number = Date.now()): string {
  const { min, max } = gibsDateRange(key, now);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return max;
  return date < min ? min : date > max ? max : date;
}

/** Fill the template for one layer and one YYYY-MM-DD. */
export function gibsTileUrl(key: GibsLayerKey, date: string): string {
  const l = GIBS_LAYERS[key];
  return GIBS_WMTS_TEMPLATE
    .replace("{layer}", l.id)
    .replace("{date}", date)
    .replace("{level}", String(l.level))
    .replace("{ext}", l.ext);
}

/** The single zoom-0 tile: present for every date the layer has an image. */
export function gibsProbeUrl(key: GibsLayerKey, date: string): string {
  return gibsTileUrl(key, date).replace("{z}", "0").replace("{y}", "0").replace("{x}", "0");
}

const probeCache = new Map<string, Promise<boolean>>();

/**
 * Does GIBS have an image for this layer and day? HEAD on the zoom-0 tile
 * (GIBS answers 404 for a day it has no image for, with CORS open). A
 * network failure counts as available so an offline check never hides a
 * layer; the tiles themselves then fail visibly. Memoised per layer+day.
 */
export function gibsDayAvailable(key: GibsLayerKey, date: string): Promise<boolean> {
  const k = `${key}|${date}`;
  let p = probeCache.get(k);
  if (!p) {
    p = fetch(gibsProbeUrl(key, date), { method: "HEAD", cache: "force-cache" })
      .then((r) => r.status !== 404)
      .catch(() => true);
    probeCache.set(k, p);
  }
  return p;
}

/**
 * PRD M1: handle a 404 tile day gracefully by stepping back one day at a
 * time, up to GIBS_MAX_STEP_BACK days. Resolves to what the map should show.
 */
export async function resolveGibsDate(
  key: GibsLayerKey, requested: string, maxBack: number = GIBS_MAX_STEP_BACK,
): Promise<GibsValid> {
  for (let steps = 0; steps <= maxBack; steps++) {
    const d = addDays(requested, -steps);
    if (await gibsDayAvailable(key, d)) return { key, requested, valid: d, steps };
  }
  return { key, requested, valid: null, steps: maxBack };
}
