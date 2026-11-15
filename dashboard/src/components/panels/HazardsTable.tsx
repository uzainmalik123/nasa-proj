"use client";
// Ranked hazards table (PRD H7, DESIGN.md §5). One row per place for the chosen
// hazard: rank, name, country, headline as mono + ramp bar, sparkline of the
// last 14 days of hindcast risk, Δ chip vs 7 days ago, category. Sortable;
// click selects + flies.
//
// M-MODE+URL (PRD M5): the headline column follows the mode. "next14" puts the
// forecast probability (index / days for drought / heat) in the headline slot
// and the category in the small column; "now" swaps them, so the big column is
// the category each place is in today, ranked category-first.
import { useMemo, useState } from "react";
import Sparkline from "@/components/charts/Sparkline";
import RampBar from "@/components/charts/RampBar";
import { CATEGORY_V, WILDFIRE_THRESHOLDS_PCT, deltaColour, riskColour } from "@/components/charts/ramp";
import { RISK_STOPS } from "@/lib/palette";
import { CATEGORY_ORDER, CONFIDENCE_ORDER, HAZARD_LABEL, fmtCount, fmtDay, pct, signed } from "@/lib/format";
import type { Category, Confidence, Hazard, Mode, Place, RiskFile, RiskNow } from "@/lib/types";
import { Card, CategoryChip, DeltaChip, ROW_CLASS, ROW_SELECTED, SortHeader, TABLE_SCROLL, cmp, nextSort, type SortState } from "./ui";

type Key = "rank" | "name" | "country" | "value" | "delta" | "category" | "exposure";

interface Row {
  i: number;
  place: Place;
  value: number | null;   // headline in native units
  v: number;              // 0..1 on the ramp
  delta: number | null;   // value − value 7 days ago, native units
  category: Category;
  confidence: Confidence;
  exposure: number;
  rank?: number;
}

/** Headline number per hazard in its native unit, plus its ramp position. */
export function headline(h: Hazard, r: RiskNow): { value: number | null; v: number } {
  switch (h) {
    case "wildfire": return { value: r.wildfire.p, v: r.wildfire.p };
    case "rain": return { value: r.rain.p, v: r.rain.p };
    case "drought": return { value: r.drought.index, v: CATEGORY_V[r.drought.category] };
    case "heat": return { value: r.heat.days_above, v: CATEGORY_V[r.heat.category] };
  }
}

export function fmtHeadline(h: Hazard, value: number | null): string {
  if (value == null) return "–";
  switch (h) {
    case "wildfire":
    case "rain": return pct(value);
    case "drought": return signed(value, 1);
    case "heat": return `${Math.round(value)} d`;
  }
}

export function fmtDelta(h: Hazard, d: number | null): string {
  if (d == null) return "–";
  switch (h) {
    case "wildfire":
    case "rain": return `${signed(d * 100, 0)} pt`;
    case "drought": return signed(d, 1);
    case "heat": return `${signed(d, 0)} d`;
  }
}

/** "15 · 59 · 92 · 99.5 %": the ramp's inner stops, today's 50/80/95/99th percentiles. */
const RAMP_LABEL = RISK_STOPS.slice(1, -1).map(([v]) => `${+(v * 100).toFixed(1)}`).join(" · ") + " %";

const UNIT_NOTE: Record<Hazard, string> = {
  wildfire: `calibrated probability of ≥3 fire detections within 50 km in the next 14 days · elevated / high / extreme at ${WILDFIRE_THRESHOLDS_PCT}`,
  rain: "probability of an unusually wet week · not a flood forecast",
  drought: "standardised deficit index · negative = drier than the place's own normal",
  heat: "forecast days above the place's own 95th-percentile max temperature",
};

export interface HazardsTableProps {
  places: Place[];
  risk: RiskFile | null;
  hazard: Hazard;
  /** "now" = category headline, "next14" = probability headline (M-MODE+URL). */
  mode: Mode;
  selected: number | null;
  filter: Set<number> | null;
  onPick: (i: number) => void;
}

const SPARK_DAYS = 14;

export default function HazardsTable({ places, risk, hazard, mode, selected, filter, onPick }: HazardsTableProps) {
  const [sort, setSort] = useState<SortState<Key>>({ key: "value", dir: "desc" });
  const continuous = hazard === "wildfire" || hazard === "rain";
  const byCategory = mode === "now";

  const rows = useMemo<Row[]>(() => {
    if (!risk) return [];
    const hist = risk.history[hazard] ?? [];
    const out: Row[] = [];
    for (let i = 0; i < places.length; i++) {
      if (filter && !filter.has(i)) continue;
      const r = risk.now[i];
      if (!r) continue;
      const { value, v } = headline(hazard, r);
      const h = hist[i] ?? [];
      const ago = h.length >= 7 ? h[h.length - 7] : null;
      out.push({
        i, place: places[i], value, v,
        delta: value != null && ago != null ? value - ago : null,
        category: r[hazard].category,
        confidence: r[hazard].confidence,
        exposure: r[hazard].exposure,
      });
    }
    // worst first in native units; drought: more negative = worse
    const worst = (r: Row): number => r.value == null ? -Infinity : hazard === "drought" ? -r.value : r.value;
    const ranked = [...out].sort((a, b) => worst(b) - worst(a));
    const pos = new Map(ranked.map((r, k) => [r.i, k]));
    // "now": category first, then the headline inside the category (a tie-break < 1)
    const catKey = (r: Row): number => CATEGORY_ORDER.indexOf(r.category) + (1 - (pos.get(r.i) ?? 0) / Math.max(1, ranked.length)) * 0.99;
    if (byCategory) ranked.sort((a, b) => catKey(b) - catKey(a));
    const rank = new Map(ranked.map((r, k) => [r.i, k + 1]));
    // `value` and `category` are the big and the small column, whichever quantity sits in them this mode
    const key = (r: Row): number | string | null =>
      sort.key === "rank" ? rank.get(r.i) ?? null
      : sort.key === "name" ? r.place.name
      : sort.key === "country" ? r.place.country
      : sort.key === "value" ? (byCategory ? catKey(r) : r.value == null ? null : worst(r))
      : sort.key === "delta" ? (hazard === "drought" && r.delta != null ? -r.delta : r.delta)
      : sort.key === "category" ? (byCategory ? (r.value == null ? null : worst(r)) : CATEGORY_ORDER.indexOf(r.category))
      : r.exposure;
    return out.sort((a, b) => cmp(key(a), key(b), sort.dir) || a.i - b.i).map((r) => ({ ...r, rank: rank.get(r.i) }));
  }, [risk, hazard, byCategory, places, filter, sort]);

  const days = risk?.history_days ?? [];
  const sparkDays = days.slice(-SPARK_DAYS);
  const onSort = (k: Key) => setSort((s) => nextSort(s, k, k === "name" || k === "country" ? "asc" : "desc"));
  const valueHeader = hazard === "wildfire" || hazard === "rain" ? "p 14d" : hazard === "drought" ? "index" : "days >P95";

  return (
    <Card
      title={byCategory
        ? <>Hazards · which places are in the highest {HAZARD_LABEL[hazard]} category today?</>
        : <>Hazards · who faces the highest {HAZARD_LABEL[hazard]} risk in the next 14 days?</>}
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>
            {byCategory
              ? <>mode <span className="text-ink-2">now</span>: today&apos;s category, ranked category-first · next 14 days ranks by the {valueHeader === "p 14d" ? "probability" : valueHeader}</>
              : <>mode <span className="text-ink-2">next 14 days</span>: ranked by {valueHeader === "p 14d" ? "the calibrated probability" : `the forecast ${valueHeader}`} · now ranks by today&apos;s category</>}
          </span>
          <span>
            <i className="mr-1 inline-block h-[10px] w-4 rounded-sm align-middle" style={{ background: `linear-gradient(to right, ${riskColour(0.05)}, ${riskColour(1)})` }} />
            risk ramp {RAMP_LABEL} = 50 / 80 / 95 / 99th percentile of today&apos;s wildfire p
          </span>
          <span>spark = last {SPARK_DAYS} days of hindcast · Δ vs 7 days ago</span>
          <span>{UNIT_NOTE[hazard]} · valid {risk?.valid_from ?? "–"} → {risk?.valid_to ?? "–"} · risk assessment</span>
        </span>
      }
    >
      <div className={TABLE_SCROLL}>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 26 }} /><col /><col style={{ width: 30 }} /><col style={{ width: 96 }} />
            <col style={{ width: 70 }} /><col style={{ width: 56 }} /><col style={{ width: 70 }} /><col style={{ width: 50 }} />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr className="h-6">
              <SortHeader k="rank" label="#" sort={sort} onSort={onSort} />
              <SortHeader k="name" label="place" sort={sort} onSort={onSort} />
              <SortHeader k="country" label="cc" sort={sort} onSort={onSort} />
              {byCategory
                ? <SortHeader k="value" label="category" sort={sort} onSort={onSort} title="low / elevated / high / extreme, from the risk assessment issued today" />
                : <SortHeader k="value" label={valueHeader} sort={sort} onSort={onSort} align="right" title={UNIT_NOTE[hazard]} />}
              <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide text-muted">hindcast</th>
              <SortHeader k="delta" label="Δ 7d" sort={sort} onSort={onSort} align="right" />
              {byCategory
                ? <SortHeader k="category" label={valueHeader} sort={sort} onSort={onSort} align="right" title={UNIT_NOTE[hazard]} />
                : <SortHeader k="category" label="cat" sort={sort} onSort={onSort} />}
              <SortHeader k="exposure" label="pop" sort={sort} onSort={onSort} align="right" title="population within the watch radius" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-[11px] text-muted">no risk yet</td></tr>
            )}
            {rows.map((r) => {
              const hist = (risk?.history[hazard]?.[r.i] ?? []).slice(-SPARK_DAYS);
              const colour = riskColour(Math.max(0.2, r.v));
              const worse = hazard === "drought" && r.delta != null ? -r.delta : r.delta;
              return (
                <tr
                  key={r.place.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected === r.i}
                  onClick={() => onPick(r.i)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.i); } }}
                  className={`${ROW_CLASS} ${selected === r.i ? ROW_SELECTED : ""}`}
                >
                  <td className="pr-1 font-mono text-muted">{r.rank}</td>
                  <td className="truncate pr-1 text-ink">{r.place.name}</td>
                  <td className="pr-1 text-muted">{r.place.country}</td>
                  {byCategory ? (
                    <td className="pr-1">
                      <CategoryChip category={r.category} title={`confidence ${r.confidence}`}>
                        <span className="opacity-60">{"·".repeat(CONFIDENCE_ORDER.indexOf(r.confidence) + 1)}</span>
                      </CategoryChip>
                    </td>
                  ) : (
                    <td className="pr-1 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className="font-mono text-ink">{fmtHeadline(hazard, r.value)}</span>
                        <RampBar v={r.v} />
                      </span>
                    </td>
                  )}
                  <td className="pr-1">
                    <Sparkline
                      values={hist}
                      colour={colour}
                      fill={continuous ? colour : null}
                      domain={continuous ? [0, Math.max(0.1, ...hist.filter((x): x is number => x != null))] : undefined}
                      zeroLine={hazard === "drought"}
                      labelAt={(k) => (sparkDays[k] ? fmtDay(sparkDays[k]) : `d${k}`)}
                      format={(v) => fmtHeadline(hazard, v)}
                    />
                  </td>
                  <td className="pr-1 text-right">
                    <DeltaChip
                      text={fmtDelta(hazard, r.delta)}
                      colour={deltaColour(worse, continuous ? 0.005 : 0)}
                      title={`${fmtHeadline(hazard, r.value)} now vs ${days.length ? fmtDay(days[days.length - 7] ?? "") : "7 days ago"}`}
                    />
                  </td>
                  {byCategory ? (
                    <td className="pr-1 text-right font-mono text-ink-2" title={UNIT_NOTE[hazard]}>{fmtHeadline(hazard, r.value)}</td>
                  ) : (
                    <td className="pr-1">
                      <CategoryChip category={r.category} title={`confidence ${r.confidence}`}>
                        <span className="opacity-60">{"·".repeat(CONFIDENCE_ORDER.indexOf(r.confidence) + 1)}</span>
                      </CategoryChip>
                    </td>
                  )}
                  <td className="text-right font-mono text-ink-2">{fmtCount(r.exposure)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
