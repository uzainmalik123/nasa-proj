// Browser-side twin of pipeline/publish/aggregate.py. The pipeline publishes
// `risk.movers` and `risk.continents` (contracts.md, S2-C note); these
// functions rebuild them from `now` + `history` for two cases: a data-branch
// run that predates the blocks, and a continent filter on the movers (the
// published top-10 is global). Same definitions, same orientation: "up" is
// always more risk, so a drought mover that rose has delta < 0.
import { CATEGORY_ORDER } from "./format";
import type {
  Category, CategoryCounts, Continents, Hazard, MoverRow, MoversBlock, Place, RiskFile, RiskNow,
} from "./types";
import { HAZARDS } from "./types";

export const MOVERS_N = 10;
export const MOVERS_LAG_DAYS = 7;

export const HEADLINE_KEY: Record<Hazard, MoversBlock["key"]> = {
  wildfire: "p", drought: "index", heat: "days_above", rain: "p",
};

/** Today's headline value in native units. */
export function headlineValue(h: Hazard, r: RiskNow): number | null {
  switch (h) {
    case "wildfire": return r.wildfire.p;
    case "rain": return r.rain.p;
    case "drought": return r.drought.index;
    case "heat": return r.heat.days_above;
  }
}

/** Signed change oriented so that positive = more risk. */
export function worse(h: Hazard, delta: number): number {
  return h === "drought" ? -delta : delta;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Movers for one hazard over `idx` (all places when null). */
export function computeMovers(
  places: Place[], risk: RiskFile, hazard: Hazard, idx: Iterable<number> | null = null,
  lag = MOVERS_LAG_DAYS, n = MOVERS_N,
): MoversBlock {
  const days = risk.history_days;
  const since = days[days.length - lag] ?? days[0] ?? "";
  const hist = risk.history[hazard] ?? [];
  const rows: (MoverRow & { w: number })[] = [];
  const indices = idx ? [...idx] : places.map((_, i) => i);
  for (const i of indices) {
    const rec = risk.now[i];
    const h = hist[i];
    if (!rec || !h || h.length < lag) continue;
    const value = headlineValue(hazard, rec);
    const ago = h[h.length - lag];
    if (value == null || ago == null) continue;
    const delta = value - ago;
    if (delta === 0) continue;
    rows.push({
      place: i, id: places[i].id, value: r3(value), ago: r3(ago), delta: r3(delta),
      category: rec[hazard].category, exposure: rec[hazard].exposure, w: worse(hazard, delta),
    });
  }
  const strip = (r: MoverRow & { w: number }): MoverRow => ({
    place: r.place, id: r.id, value: r.value, ago: r.ago, delta: r.delta, category: r.category, exposure: r.exposure,
  });
  return {
    key: HEADLINE_KEY[hazard],
    since,
    up: rows.filter((r) => r.w > 0).sort((a, b) => b.w - a.w).slice(0, n).map(strip),
    down: rows.filter((r) => r.w < 0).sort((a, b) => a.w - b.w).slice(0, n).map(strip),
  };
}

function emptyCounts(): CategoryCounts {
  return { low: 0, elevated: 0, high: 0, extreme: 0 };
}

/** Per-continent tallies, today's mean headline and the mean hindcast series. */
export function computeContinents(places: Place[], risk: RiskFile): Continents {
  const names = [...new Set(places.map((p) => p.continent))].sort();
  const groups = new Map<string, number[]>(names.map((c) => [c, []]));
  places.forEach((p, i) => groups.get(p.continent)?.push(i));
  const days = risk.history_days.length;
  const counts = {} as Record<Hazard, CategoryCounts[]>;
  const mean_now = {} as Record<Hazard, (number | null)[]>;
  const mean_history = {} as Record<Hazard, (number | null)[][]>;
  for (const h of HAZARDS) {
    counts[h] = []; mean_now[h] = []; mean_history[h] = [];
    const hist = risk.history[h] ?? [];
    for (const c of names) {
      const idx = groups.get(c) ?? [];
      const tally = emptyCounts();
      let sum = 0, k = 0;
      const hs = new Array<number>(days).fill(0);
      const hk = new Array<number>(days).fill(0);
      for (const i of idx) {
        const rec = risk.now[i];
        if (!rec) continue;
        tally[rec[h].category as Category] += 1;
        const v = headlineValue(h, rec);
        if (v != null) { sum += v; k++; }
        const row = hist[i] ?? [];
        for (let d = 0; d < days; d++) {
          const x = row[d];
          if (x != null && Number.isFinite(x)) { hs[d] += x; hk[d] += 1; }
        }
      }
      counts[h].push(tally);
      mean_now[h].push(k ? r3(sum / k) : null);
      mean_history[h].push(hs.map((s, d) => (hk[d] ? r3(s / hk[d]) : null)));
    }
  }
  return {
    names,
    n: names.map((c) => groups.get(c)?.length ?? 0),
    pop: names.map((c) => (groups.get(c) ?? []).reduce((s, i) => s + (places[i]?.pop ?? 0), 0)),
    counts, mean_now, mean_history,
  };
}

/** Category order used by the stacked bars, low → extreme. */
export const BUCKETS: Category[] = CATEGORY_ORDER;
