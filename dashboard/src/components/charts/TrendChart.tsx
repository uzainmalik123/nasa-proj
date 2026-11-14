"use client";
// DESIGN.md §5 chart catalogue · Trend chart: 10 years of monthly means as a
// thin line with the Sen's slope drawn as a straight dashed line through it,
// the last 90 days of daily values inset at right with its own slope, and a
// mono label "↑ +0.8 mm/yr · p=0.01" over each window. The challenge's core
// chart. Hand-built SVG, measured with useSize, nothing drawn until width > 0.
import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import { useMemo, useState } from "react";
import { fmtDay, fmtMonth, fmtP, fmtSlope } from "@/lib/format";
import { P } from "@/lib/palette";
import type { TrendLabel } from "@/lib/types";
import { useSize } from "@/lib/useSize";
import { M, fmtTick, nearestIdx, senLine, xLabelIdx, yDomain, yTicks } from "./chart";
import Tooltip from "./Tooltip";

export interface TrendWindowData {
  /** x labels: "YYYY-MM" for the long window, "YYYY-MM-DD" for the short one */
  keys: string[];
  values: (number | null)[];
  slope: number | null;   // Sen's slope, unit per year
  p: number | null;
  label: TrendLabel;
}

export interface TrendChartProps {
  long: TrendWindowData;
  /** null when the pipeline publishes no daily series for this variable */
  short: TrendWindowData | null;
  unit: string;           // "mm/yr"
  colour: string;
  /** what the inset's daily values are, e.g. "30-day total" */
  shortNote?: string;
  height?: number;
}

const ARROW: Record<TrendLabel, string> = { rising: "↑", falling: "↓", stable: "→", insufficient: "·" };

/** "↑ +0.8 mm/yr · p=0.01", muted when not significant. */
export function TrendLabelText({ w, unit }: { w: TrendWindowData | null; unit: string }) {
  if (!w || w.label === "insufficient" || w.slope == null) {
    return <span className="font-mono text-[10px] text-muted">· insufficient data</span>;
  }
  const sig = w.p != null && w.p < 0.05;
  return (
    <span className="font-mono text-[10px]" style={{ color: sig ? P.ink : P.muted }} title={sig ? "significant at p < 0.05" : "not significant (p ≥ 0.05)"}>
      {ARROW[w.label]} {fmtSlope(w.slope)} {unit} · p={fmtP(w.p)}
    </span>
  );
}

interface Hover { which: "long" | "short"; i: number; cx: number; cy: number }

export default function TrendChart({ long, short, unit, colour, shortNote, height = 150 }: TrendChartProps) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const bare = unit.replace(/\/yr$/, "");

  // The inset takes ~30 % of the width; the long window gets the rest.
  const geom = useMemo(() => {
    const insetW = short ? Math.max(120, Math.round(width * 0.3)) : 0;
    const gap = short ? 14 : 0;
    const longW = width - insetW - gap;
    return { insetW, gap, longW };
  }, [width, short]);

  const plotH = height - M.top - M.bottom;

  const L = useMemo(() => build(long, 1 / 12, M.left, geom.longW - M.right, plotH), [long, geom.longW, plotH]);
  const S = useMemo(
    () => (short ? build(short, 1 / 365, geom.longW + geom.gap + M.left, width - M.right, plotH) : null),
    [short, geom, width, plotH],
  );

  if (width <= 0) return <div ref={ref} style={{ height }} />;

  const onMove = (which: "long" | "short") => (e: React.MouseEvent<SVGRectElement>) => {
    const b = which === "long" ? L : S;
    if (!b) return;
    const r = e.currentTarget.getBoundingClientRect();
    const svgLeft = r.left - b.x0; // rect starts at x0 inside the svg
    const i = nearestIdx(e.clientX - svgLeft, b.x0, b.x1, b.n);
    const v = b.values[i];
    if (v == null) { setHover(null); return; }
    setHover({ which, i, cx: svgLeft + b.x(i), cy: r.top + b.y(v) });
  };

  const hb = hover ? (hover.which === "long" ? L : S) : null;
  const hv = hover && hb ? hb.values[hover.i] : null;

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="trend chart">
        <Plot b={L} colour={colour} plotH={plotH} labels={xLabelIdx(long.keys.length, 24).map((i) => [i, fmtMonth(long.keys[i])])} />
        {S && short && (
          <Plot
            b={S} colour={colour} plotH={plotH} inset
            labels={[0, Math.floor((short.keys.length - 1) / 2), short.keys.length - 1].filter((i, k, a) => a.indexOf(i) === k && short.keys[i]).map((i) => [i, fmtDay(short.keys[i])])}
          />
        )}
        {/* divider between the two windows */}
        {S && <line x1={geom.longW + geom.gap / 2} x2={geom.longW + geom.gap / 2} y1={M.top} y2={M.top + plotH} stroke={P.grid} strokeDasharray="2 3" />}
        <rect x={L.x0} y={M.top} width={Math.max(0, L.x1 - L.x0)} height={plotH} fill="transparent" onMouseMove={onMove("long")} onMouseLeave={() => setHover(null)} />
        {S && <rect x={S.x0} y={M.top} width={Math.max(0, S.x1 - S.x0)} height={plotH} fill="transparent" onMouseMove={onMove("short")} onMouseLeave={() => setHover(null)} />}
        {hover && hb && hv != null && (
          <circle cx={hb.x(hover.i)} cy={M.top + hb.y(hv)} r={3} fill={P.surface} stroke={colour} strokeWidth={1.5} />
        )}
      </svg>
      {hover && hb && hv != null && (
        <Tooltip
          x={hover.cx}
          y={hover.cy}
          flip={typeof window !== "undefined" && hover.cx > window.innerWidth * 0.62}
          title={hover.which === "long" ? `${fmtMonth(long.keys[hover.i])} · monthly mean` : `${fmtDay(short!.keys[hover.i])} · ${shortNote ?? "daily"}`}
          rows={[
            { label: "observed", value: `${hv.toFixed(2)} ${bare}`, colour },
            ...(hb.sen ? [{ label: "Sen's line", value: `${hb.senAt(hover.i).toFixed(2)} ${bare}`, colour: P.ink2 }] : []),
          ]}
        />
      )}
    </div>
  );
}

interface Built {
  n: number;
  values: (number | null)[];
  x0: number; x1: number;
  x: (i: number) => number;
  y: (v: number) => number;
  path: string;
  sen: { y0: number; y1: number } | null;
  senAt: (i: number) => number;
  ticks: number[];
}

function build(w: TrendWindowData, stepYears: number, x0: number, x1: number, plotH: number): Built {
  const n = w.values.length;
  const sen = senLine(w.values, w.slope, stepYears);
  const dom = yDomain(w.values, sen ? [sen.y0, sen.y1] : []);
  const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([x0, Math.max(x0 + 1, x1)]);
  const y = scaleLinear().domain(dom).range([plotH, 0]);
  const ln = d3line<[number, number | null]>()
    .defined((d) => d[1] != null)
    .x((d) => x(d[0]))
    .y((d) => y(d[1] as number));
  return {
    n, values: w.values, x0, x1,
    x: (i) => x(i),
    y: (v) => y(v),
    path: ln(w.values.map((v, i) => [i, v])) ?? "",
    sen,
    senAt: (i) => (sen ? sen.y0 + ((sen.y1 - sen.y0) * i) / Math.max(1, n - 1) : NaN),
    ticks: yTicks(dom, 4),
  };
}

function Plot({ b, colour, plotH, labels, inset = false }: {
  b: Built; colour: string; plotH: number; labels: [number, string][]; inset?: boolean;
}) {
  return (
    <g transform={`translate(0,${M.top})`}>
      {b.ticks.map((t) => (
        <g key={t}>
          <line x1={b.x0} x2={b.x1} y1={b.y(t)} y2={b.y(t)} stroke={t === 0 ? P.axis : P.grid} strokeWidth={1} />
          <text x={b.x0 - 6} y={b.y(t)} dy="0.35em" textAnchor="end" fontSize={10} fill={P.muted} className="font-mono">{fmtTick(t)}</text>
        </g>
      ))}
      <path d={b.path} fill="none" stroke={colour} strokeWidth={inset ? 1.5 : 1.4} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      {b.sen && (
        <line
          x1={b.x(0)} y1={b.y(b.sen.y0)} x2={b.x(b.n - 1)} y2={b.y(b.sen.y1)}
          stroke={P.ink} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.85}
        />
      )}
      {labels.map(([i, text]) => (
        <text key={i} x={b.x(i)} y={plotH + 14} textAnchor={i === 0 ? "start" : i === b.n - 1 ? "end" : "middle"} fontSize={10} fill={P.muted}>{text}</text>
      ))}
    </g>
  );
}
