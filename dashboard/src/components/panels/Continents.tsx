"use client";
// Continents (PRD M4, DESIGN.md §5 chart catalogue): one horizontal stacked
// bar per continent, buckets low / elevated / high / extreme in the ramp's
// category colours with counts in mono; below it a row of small multiples,
// one tiny line chart per continent, 60 px tall, shared y, the mean hindcast
// risk over the 90 days. Clicking a continent sets the region filter.
// Reads risk.json `continents` (S2-C); recomputes in the browser when absent.
import { useMemo, useState } from "react";
import Sparkline from "@/components/charts/Sparkline";
import Tooltip from "@/components/charts/Tooltip";
import { CATEGORY_V, HAZARD_COLOUR, riskColour } from "@/components/charts/ramp";
import { BUCKETS, computeContinents } from "@/lib/aggregate";
import { HAZARD_LABEL, fmtCount, fmtDay } from "@/lib/format";
import { P } from "@/lib/palette";
import { useSize } from "@/lib/useSize";
import type { Category, Continents as ContinentsBlock, Hazard, Place, RiskFile } from "@/lib/types";
import { fmtHeadline } from "./HazardsTable";
import { Card, Stamp } from "./ui";

export interface ContinentsProps {
  places: Place[];
  risk: RiskFile | null;
  hazard: Hazard;
  continent: string | null;
  onPick: (continent: string | null) => void;
}

/** Bucket colour: the ramp at the category's start; "low" is the axis grey so the full bar stays visible. */
export function bucketColour(c: Category): string {
  return c === "low" ? P.axis : riskColour(CATEGORY_V[c]);
}

const SHORT: Record<string, string> = {
  "North America": "N. Am.", "South America": "S. Am.", Antarctica: "Antarc.",
};

export default function Continents({ places, risk, hazard, continent, onPick }: ContinentsProps) {
  const { block, source } = useMemo<{ block: ContinentsBlock | null; source: "file" | "browser" }>(() => {
    if (!risk || !places.length) return { block: null, source: "file" };
    if (risk.continents) return { block: risk.continents, source: "file" };
    return { block: computeContinents(places, risk), source: "browser" };
  }, [risk, places]);
  const [hover, setHover] = useState<{ k: number; x: number; y: number } | null>(null);

  const continuous = hazard === "wildfire" || hazard === "rain";
  const names = block?.names ?? [];
  const counts = block?.counts[hazard] ?? [];
  const series = useMemo(() => block?.mean_history[hazard] ?? [], [block, hazard]);
  const days = risk?.history_days ?? [];

  // shared y across the small multiples
  const domain = useMemo<[number, number]>(() => {
    const all = series.flat().filter((v): v is number => v != null && Number.isFinite(v));
    if (!all.length) return [0, 1];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (continuous) lo = 0;
    if (hazard === "heat") lo = 0;
    if (hazard === "drought") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-6) hi = lo + (continuous ? 0.1 : 1);
    return [lo, hi];
  }, [series, continuous, hazard]);

  const maxN = Math.max(1, ...(block?.n ?? [1]));
  const unit = hazard === "heat" ? "days above P95" : hazard === "drought" ? "deficit index" : "probability";

  return (
    <Card
      title={<>Continents · where is {HAZARD_LABEL[hazard]} risk concentrated?</>}
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>
            {BUCKETS.map((c) => (
              <span key={c} className="mr-2">
                <i className="mr-1 inline-block h-[10px] w-[10px] rounded-sm align-middle" style={{ background: bucketColour(c) }} />{c}
              </span>
            ))}
            places per category today, bar length = places on watch
          </span>
          <span>small multiples = mean {unit} across the continent&apos;s places, 90-day hindcast, shared y {fmtHeadline(hazard, domain[0])} – {fmtHeadline(hazard, domain[1])}</span>
          <span>
            {block ? `${names.length} continents · ${fmtCount(block.n.reduce((a, b) => a + b, 0))} places` : "loading…"}
            {source === "browser" ? " · computed in the browser (run predates continents)" : ` · from run ${risk?.meta.run_id ?? "–"}`}
            {" · click a row to filter the screen"}
          </span>
          <Stamp valid={risk ? `${risk.valid_from} → ${risk.valid_to}` : "–"} retrieved={risk?.meta.generated_at} kind="risk assessment" />
        </span>
      }
    >
      {!block && <div className="h-[262px]" aria-hidden="true" />}
      {block && (
        <>
          <table className="w-full table-fixed border-collapse" aria-label="places per category by continent">
            <colgroup>
              <col style={{ width: 84 }} /><col /><col style={{ width: 40 }} /><col style={{ width: 52 }} />
            </colgroup>
            <thead>
              <tr className="h-6">
                <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide text-muted">continent</th>
                <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide text-muted">low · elevated · high · extreme</th>
                <th className="pr-1 text-right text-[10px] font-normal uppercase tracking-wide text-muted">n</th>
                <th className="text-right text-[10px] font-normal uppercase tracking-wide text-muted" title={`mean ${unit} across the continent's places today`}>mean</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name, k) => {
                const tally = counts[k];
                const n = block.n[k] || 1;
                const active = continent === name;
                return (
                  <tr
                    key={name}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    onClick={() => onPick(active ? null : name)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(active ? null : name); } }}
                    className={`h-7 cursor-pointer border-t border-border text-[11px] transition hover:bg-white/[0.04] ${active ? "bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]" : ""}`}
                    onMouseMove={(e) => setHover({ k, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <td className="truncate pr-1 text-ink">{name}</td>
                    <td className="pr-1 align-middle">
                      <div className="flex h-[10px] overflow-hidden rounded-sm" style={{ width: `${(block.n[k] / maxN) * 100}%`, background: "rgba(255,255,255,0.04)" }} aria-hidden="true">
                        {BUCKETS.map((c) => {
                          const v = tally?.[c] ?? 0;
                          if (!v) return null;
                          const share = v / n;
                          return (
                            <div
                              key={c}
                              className="relative flex h-full items-center justify-center overflow-hidden font-mono text-[8.5px] leading-none"
                              style={{ width: `${share * 100}%`, background: bucketColour(c), color: c === "extreme" ? P.page : P.ink, minWidth: 1 }}
                            >
                              {share * block.n[k] >= 3 && share > 0.12 ? v : ""}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="pr-1 text-right font-mono text-ink-2">{block.n[k]}</td>
                    <td className="text-right font-mono text-ink">{fmtHeadline(hazard, block.mean_now[hazard]?.[k] ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hover && counts[hover.k] && (
            <Tooltip
              x={hover.x}
              y={hover.y}
              flip={typeof window !== "undefined" && hover.x > window.innerWidth * 0.62}
              rows={[
                { label: names[hover.k], value: `${block.n[hover.k]} places · ${fmtCount(block.pop[hover.k])} people`, colour: P.ink2 },
                ...BUCKETS.map((c) => ({ label: c, value: String(counts[hover.k][c]), colour: c === "low" ? P.muted : bucketColour(c) })),
              ]}
            />
          )}

          {/* small multiples, DESIGN §5: 60 px tall, shared y */}
          <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, names.length)}, minmax(0, 1fr))` }}>
            {names.map((name, k) => {
              const s = series[k] ?? [];
              const last = [...s].reverse().find((v) => v != null) ?? null;
              const active = continent === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onPick(active ? null : name)}
                  aria-pressed={active}
                  className={`rounded-md border px-1.5 pb-1 pt-1 text-left transition hover:bg-white/[0.04] ${active ? "border-white/40 bg-white/[0.06]" : "border-border"}`}
                  title={`${name}: mean ${unit} over the last ${s.length} days`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="truncate text-[10px] text-ink-2">{SHORT[name] ?? name}</span>
                    <span className="font-mono text-[10px] text-ink">{fmtHeadline(hazard, last)}</span>
                  </div>
                  <SmallMultiple values={s} colour={HAZARD_COLOUR[hazard]} domain={domain} days={days} hazard={hazard} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/** Measured wrapper so each sparkline fills its cell at a fixed 44 px plot height (60 px with the label row). */
function SmallMultiple({ values, colour, domain, days, hazard }: {
  values: (number | null)[]; colour: string; domain: [number, number]; days: string[]; hazard: Hazard;
}) {
  const { ref, width: w } = useSize<HTMLDivElement>();
  return (
    <div className="mt-0.5 h-[44px] w-full" ref={ref}>
      {w > 0 && (
        <Sparkline
          values={values}
          colour={colour}
          fill={colour}
          width={w}
          height={44}
          domain={domain}
          zeroLine={hazard === "drought"}
          labelAt={(i) => (days[i] ? fmtDay(days[i]) : `d${i}`)}
          format={(v) => fmtHeadline(hazard, v)}
        />
      )}
    </div>
  );
}
