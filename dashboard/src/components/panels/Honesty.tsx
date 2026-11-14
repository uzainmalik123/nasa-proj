"use client";
// Honesty panel (PRD M2, DESIGN.md §5 catalogue): bar pairs of predicted vs
// observed fire frequency per probability bucket, the top-20 hit rate against
// the fire-weather-index baseline, a mode badge (held-out hindcast until the
// published-risk store is two weeks old, PRD §7.2 step 8), and the last ten
// runs as status dots with the failing gate on hover. The caption carries the
// perfect-prognosis note from PRD §7.2 step 5.
import { useMemo, useState } from "react";
import { fmtTick, yTicks } from "@/components/charts/chart";
import Tooltip, { type TooltipRow } from "@/components/charts/Tooltip";
import { fmtCount, fmtDay, pct } from "@/lib/format";
import { P } from "@/lib/palette";
import type { HonestyBucket, HonestyFile, RunSummary } from "@/lib/types";
import { useSize } from "@/lib/useSize";
import { Card, Chip } from "./ui";

const PLOT_H = 110;                                   // DESIGN §8 fixed chart heights
const M = { left: 36, right: 8, top: 10, bottom: 30 }; // bottom fits the range label and n
const BAR_MAX = 24;                                   // dataviz: never thicker than 24 px
const PAIR_GAP = 2;                                   // surface gap between the two bars of a pair

/** Bucket label "5–10" (percent, no sign) for the x axis. */
export function bucketLabel(b: HonestyBucket): string {
  const f = (v: number) => (v * 100).toFixed(v * 100 % 1 ? 1 : 0);
  return `${f(b.lo)}–${f(b.hi)}`;
}

/** The bucket where the model is furthest from what happened, with its gap in points. */
export function worstBucket(buckets: HonestyBucket[]): { b: HonestyBucket; gapPt: number } | null {
  let best: { b: HonestyBucket; gapPt: number } | null = null;
  for (const b of buckets) {
    const gapPt = Math.round((b.obs - b.pred) * 100);
    if (!best || Math.abs(gapPt) > Math.abs(best.gapPt)) best = { b, gapPt };
  }
  return best;
}

/** Rect path with 4 px rounded data-end, square at the baseline (dataviz mark spec). */
function topRounded(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

interface Hover { x: number; y: number; title: string; rows: TooltipRow[]; flip: boolean }

export function CalibrationBars({ buckets }: { buckets: HonestyBucket[] }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const height = M.top + PLOT_H + M.bottom;
  const domain = useMemo<[number, number]>(() => {
    const hi = buckets.reduce((m, b) => Math.max(m, b.pred, b.obs), 0);
    return [0, Math.min(1, (hi || 0.1) * 1.08)];
  }, [buckets]);
  if (width <= 0 || buckets.length === 0) return <div ref={ref} style={{ height }} />;

  const x0 = M.left, x1 = width - M.right, y0 = M.top, y1 = M.top + PLOT_H;
  const sy = (v: number) => y1 - (v / domain[1]) * PLOT_H;
  const group = (x1 - x0) / buckets.length;
  const bw = Math.max(3, Math.min(BAR_MAX, (group * 0.72 - PAIR_GAP) / 2));
  const ticks = yTicks(domain, 3);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="predicted vs observed by probability bucket">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x0} x2={x1} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? P.axis : P.grid} strokeWidth={1} />
            <text x={x0 - 6} y={sy(t)} dy="0.35em" textAnchor="end" fontSize={10} fill={P.muted} className="font-mono">
              {fmtTick(t * 100)}{t === ticks[ticks.length - 1] ? "%" : ""}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = x0 + group * (i + 0.5);
          const px = cx - PAIR_GAP / 2 - bw, ox = cx + PAIR_GAP / 2;
          const title = `bucket ${bucketLabel(b)} %`;
          const rows: TooltipRow[] = [
            { label: "predicted", value: pct(b.pred, 1), colour: P.s1 },
            { label: "observed", value: pct(b.obs, 1), colour: P.s2 },
            { label: "place-days", value: fmtCount(b.n) },
          ];
          return (
            <g
              key={i}
              onMouseEnter={(e) => {
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ x: r.left + cx, y: r.top + sy(Math.max(b.pred, b.obs)), title, rows, flip: cx > width * 0.62 });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${title}: predicted ${pct(b.pred, 1)}, observed ${pct(b.obs, 1)}, n ${b.n}`}</title>
              <rect x={cx - group / 2} y={y0} width={group} height={PLOT_H + M.bottom} fill="transparent" />
              <path d={topRounded(px, sy(b.pred), bw, y1 - sy(b.pred))} fill={P.s1} opacity={0.9} />
              <path d={topRounded(ox, sy(b.obs), bw, y1 - sy(b.obs))} fill={P.s2} opacity={0.9} />
              <text x={cx} y={y1 + 12} textAnchor="middle" fontSize={10} fill={P.muted} className="font-mono">
                {bucketLabel(b)}
              </text>
              <text x={cx} y={y1 + 23} textAnchor="middle" fontSize={9} fill={P.muted} className="font-mono" opacity={0.8}>
                n={fmtCount(b.n)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && <Tooltip x={hover.x} y={hover.y} title={hover.title} rows={hover.rows} flip={hover.flip} />}
    </div>
  );
}

/** Last ten runs, oldest left, newest right; green ok, red failed, with the failing gate on hover. */
export function RunDots({ runs }: { runs: RunSummary[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; run: RunSummary } | null>(null);
  const ordered = useMemo(() => [...runs].slice(0, 10).reverse(), [runs]);
  if (!ordered.length) return <span className="text-[10px] text-muted">no runs yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5" role="list" aria-label="last ten runs">
      {ordered.map((r, i) => {
        const newest = i === ordered.length - 1;
        const colour = r.ok ? P.good : P.critical;
        return (
          <span
            key={r.run_id}
            role="listitem"
            aria-label={`run ${r.run_id} ${r.ok ? "ok" : `failed ${r.failed_gate ?? "gate"}`}`}
            className="inline-flex h-4 w-4 cursor-default items-center justify-center"
            onMouseEnter={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              setHover({ x: b.left + b.width / 2, y: b.top - 30, run: r });
            }}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: colour,
                boxShadow: newest ? `0 0 0 2px ${P.surface}, 0 0 0 3px ${colour}` : r.ok ? undefined : `0 0 5px ${colour}`,
              }}
            />
          </span>
        );
      })}
      {hover && (
        <Tooltip
          x={hover.x}
          y={hover.y}
          title={`run ${hover.run.run_id}`}
          flip={hover.x > (typeof window === "undefined" ? 0 : window.innerWidth) - 220}
          rows={[
            { label: "gates", value: hover.run.ok ? "all pass" : `failed ${hover.run.failed_gate ?? "unknown"}`, colour: hover.run.ok ? P.good : P.critical },
            { label: "duration", value: `${hover.run.duration_s} s` },
          ]}
        />
      )}
    </span>
  );
}

export default function Honesty({ honesty }: { honesty: HonestyFile | null }) {
  const buckets = useMemo(() => honesty?.buckets ?? [], [honesty]);
  const worst = useMemo(() => worstBucket(buckets), [buckets]);
  const hit = honesty?.top20_hit_rate ?? null, base = honesty?.baseline_top20_hit_rate ?? null;
  const above = hit != null && base != null ? hit - base : null;
  const hindcast = honesty?.mode !== "published";
  const failed = (honesty?.runs ?? []).filter((r) => !r.ok).length;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span>Honesty · does the number mean what it says?</span>
          {honesty && (
            <Chip
              colour={hindcast ? P.warning : P.good}
              title={hindcast
                ? "Scored on the final six weeks of labels held out from training; the published-risk store is not two weeks old yet (PRD §7.2 step 8)."
                : "Scored on the risk actually published by past runs against the fires FIRMS then detected."}
            >
              {hindcast ? "held-out hindcast" : "published"}
            </Chip>
          )}
        </span>
      }
      caption={
        honesty ? (
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><i className="inline-block h-[2.5px] w-3 rounded-sm" style={{ background: P.s1 }} /> predicted (mean calibrated probability)</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-[2.5px] w-3 rounded-sm" style={{ background: P.s2 }} /> observed (share with ≥3 FIRMS detections in 14 days)</span>
              <span>{fmtDay(honesty.window[0])} → {fmtDay(honesty.window[1])}</span>
            </span>
            <span>
              {hindcast
                ? "Hindcast on the final six weeks of labels the model never trained on. Training forecast slots use POWER's observed next 14 days (perfect prognosis); live scoring uses Open-Meteo forecasts, so the published skill may be lower until two weeks of real published forecasts exist."
                : "Scored on the risk each run actually published, against the FIRMS detections that followed. Forecast slots in training used POWER's observed next 14 days (perfect prognosis); the published score uses Open-Meteo forecasts."}
              {" "}Baseline: the fire weather index ranked the same way.
            </span>
          </span>
        ) : "waiting for honesty.json"
      }
    >
      {!honesty ? (
        <div className="py-3 text-center text-[11px] text-muted">no honesty.json yet</div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted">top-20 hit rate</span>
              <span className="font-mono text-[22px] font-semibold leading-none text-ink">{hit == null ? "—" : pct(hit)}</span>
              <span className="text-[10.5px] text-muted">
                vs baseline <span className="font-mono text-ink-2">{base == null ? "—" : pct(base)}</span>
              </span>
              {above != null && (
                <span className="font-mono text-[10px]" style={{ color: above > 0 ? P.good : above < 0 ? P.critical : P.muted }}>
                  {above > 0 ? "+" : ""}{Math.round(above * 100)} pt
                </span>
              )}
            </div>
            {worst && (
              <span className="text-[10.5px] text-muted">
                largest gap: bucket <span className="font-mono text-ink-2">{bucketLabel(worst.b)} %</span> observed{" "}
                <span className="font-mono text-ink-2">{worst.gapPt > 0 ? "+" : ""}{worst.gapPt} pt</span> vs predicted
              </span>
            )}
          </div>
          <CalibrationBars buckets={buckets} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
            <span className="uppercase tracking-wide">last {Math.min(10, honesty.runs.length)} runs</span>
            <RunDots runs={honesty.runs} />
            <span>{failed ? `${failed} failed` : "all gates passed"} · newest ringed · hover for the failing gate</span>
          </div>
        </>
      )}
    </Card>
  );
}
