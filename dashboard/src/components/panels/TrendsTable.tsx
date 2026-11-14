"use client";
// Ranked trends table (PRD H7, DESIGN.md §5). One row per place for the chosen
// variable: rank, name, country, 10-year Sen's slope as mono + diverging bar,
// sparkline of the 120 monthly means, Δ chip = 90-day slope. Sortable headers;
// click selects the place and flies the globe.
import { useMemo, useState } from "react";
import Sparkline from "@/components/charts/Sparkline";
import RampBar from "@/components/charts/RampBar";
import { deltaColour } from "@/components/charts/ramp";
import { VARIABLE_LABEL, fmtMonth, fmtP, fmtSlope } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Place, TrendsFile, Variable } from "@/lib/types";
import { Card, Chip, DeltaChip, ROW_CLASS, ROW_SELECTED, SortHeader, TABLE_SCROLL, cmp, nextSort, type SortState } from "./ui";

type Key = "rank" | "name" | "country" | "slope" | "p" | "short";

/** Trailing 12-month mean of a monthly series; the seasonal cycle is noise at 64 px. */
function rolling12(xs: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 11; i < xs.length; i++) {
    let s = 0, n = 0;
    for (let k = i - 11; k <= i; k++) { const v = xs[k]; if (v != null) { s += v; n++; } }
    out.push(n >= 6 ? s / n : null);
  }
  return out;
}

interface Row {
  i: number;
  place: Place;
  slope: number | null;
  p: number | null;
  label: string;
  short: number | null;
  shortP: number | null;
  sig: boolean;
  rank?: number;
}

export interface TrendsTableProps {
  places: Place[];
  trends: TrendsFile | null;
  variable: Variable;
  selected: number | null;
  /** indices to include (continent filter); null = all */
  filter: Set<number> | null;
  onPick: (i: number) => void;
}

export default function TrendsTable({ places, trends, variable, selected, filter, onPick }: TrendsTableProps) {
  const [sort, setSort] = useState<SortState<Key>>({ key: "rank", dir: "asc" });
  const vi = trends ? trends.variables.indexOf(variable) : -1;
  const unit = trends?.units[vi] ?? "";

  const rows = useMemo<Row[]>(() => {
    if (!trends || vi < 0) return [];
    const out: Row[] = [];
    for (let i = 0; i < places.length; i++) {
      if (filter && !filter.has(i)) continue;
      const p = trends.long.p[i]?.[vi] ?? null;
      out.push({
        i,
        place: places[i],
        slope: trends.long.slope[i]?.[vi] ?? null,
        p,
        label: trends.long.label[i]?.[vi] ?? "insufficient",
        short: trends.short.slope[i]?.[vi] ?? null,
        shortP: trends.short.p[i]?.[vi] ?? null,
        sig: p != null && p < 0.05,
      });
    }
    // rank = position by |slope| among significant places first, then the rest
    const ranked = [...out].sort((a, b) => {
      if (a.sig !== b.sig) return a.sig ? -1 : 1;
      return Math.abs(b.slope ?? 0) - Math.abs(a.slope ?? 0);
    });
    const rank = new Map(ranked.map((r, k) => [r.i, k + 1]));
    const key = (r: Row): number | string | null =>
      sort.key === "rank" ? rank.get(r.i) ?? null
      : sort.key === "name" ? r.place.name
      : sort.key === "country" ? r.place.country
      : sort.key === "slope" ? r.slope
      : sort.key === "p" ? r.p
      : r.short;
    return out.sort((a, b) => cmp(key(a), key(b), sort.dir) || a.i - b.i).map((r) => ({ ...r, rank: rank.get(r.i) }));
  }, [trends, vi, places, filter, sort]);

  const maxAbs = useMemo(() => rows.reduce((m, r) => Math.max(m, Math.abs(r.slope ?? 0)), 0) || 1, [rows]);
  const months = trends?.months ?? [];
  const onSort = (k: Key) => setSort((s) => nextSort(s, k, k === "name" || k === "country" || k === "p" ? "asc" : "desc"));

  return (
    <Card
      title={<>Trends · where is {VARIABLE_LABEL[variable]} changing fastest?</>}
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span><i className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ background: P.s2 }} />rising</span>
          <span><i className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ background: P.s1 }} />falling</span>
          <span>slope = Sen&apos;s slope over 10 years of monthly means, {unit || "unit/yr"} · grey = p ≥ 0.05</span>
          <span>spark = 12-month rolling mean of 10 years of monthly values · Δ = 90-day slope, same unit</span>
        </span>
      }
    >
      <div className={TABLE_SCROLL}>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 28 }} /><col /><col style={{ width: 34 }} /><col style={{ width: 112 }} />
            <col style={{ width: 52 }} /><col style={{ width: 72 }} /><col style={{ width: 62 }} />
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr className="h-6">
              <SortHeader k="rank" label="#" sort={sort} onSort={onSort} title="rank by |slope|, significant places first" />
              <SortHeader k="name" label="place" sort={sort} onSort={onSort} />
              <SortHeader k="country" label="cc" sort={sort} onSort={onSort} />
              <SortHeader k="slope" label={`10y ${unit}`} sort={sort} onSort={onSort} align="right" title="Sen's slope, 10-year window" />
              <SortHeader k="p" label="p" sort={sort} onSort={onSort} align="right" title="Mann-Kendall p-value" />
              <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide text-muted">10 y mean</th>
              <SortHeader k="short" label="Δ 90d" sort={sort} onSort={onSort} align="right" title="Sen's slope over the last 90 days, same unit" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-[11px] text-muted">no trends yet</td></tr>
            )}
            {rows.map((r) => {
              const series = rolling12(trends?.series_long[r.i]?.[vi] ?? []);
              const dir = r.slope == null ? 0 : Math.sign(r.slope);
              const colour = !r.sig ? P.muted : dir > 0 ? P.s2 : P.s1;
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
                  <td className="truncate pr-1 text-ink">
                    {r.place.name}
                    {r.label === "insufficient" && <Chip title="not enough data">n/a</Chip>}
                  </td>
                  <td className="pr-1 text-muted">{r.place.country}</td>
                  <td className="pr-1 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className="font-mono" style={{ color: r.sig ? P.ink : P.muted }}>{fmtSlope(r.slope)}</span>
                      <RampBar v={Math.abs(r.slope ?? 0) / maxAbs} colour={colour} />
                    </span>
                  </td>
                  <td className="pr-1 text-right font-mono" style={{ color: r.sig ? P.ink2 : P.muted }}>{fmtP(r.p)}</td>
                  <td className="pr-1">
                    <Sparkline
                      values={series}
                      colour={r.sig ? colour : P.muted}
                      labelAt={(k) => (months[k + 11] ? `12 mo to ${fmtMonth(months[k + 11])}` : `#${k}`)}
                      format={(v) => `${v.toFixed(1)} ${unit.replace(/\/yr$/, "")}`}
                    />
                  </td>
                  <td className="text-right">
                    <DeltaChip
                      text={fmtSlope(r.short)}
                      colour={deltaColour(r.short)}
                      title={`90-day Sen's slope ${fmtSlope(r.short)} ${unit} · p=${fmtP(r.shortP)}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
