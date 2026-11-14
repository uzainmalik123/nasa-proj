"use client";
// DESIGN.md §5 chart catalogue · AnomalySeries: one observed variable as a line
// over a ±1σ band around the place's own 10-year normal for that calendar
// window, flagged points where |z| > 1.5, a time cursor on the last observed
// day, hover tooltip with value, normal and z.
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { useMemo, useState } from "react";
import { fmtDay, signed } from "@/lib/format";
import { P } from "@/lib/palette";
import { useSize } from "@/lib/useSize";
import { M, fmtTick, nearestIdx, xLabelIdx, yDomain, yTicks, zScore } from "./chart";
import Tooltip from "./Tooltip";

export const FLAG_Z = 1.5;

export interface AnomalySeriesProps {
  days: string[];
  values: (number | null)[];
  norm: (number | null)[];
  sd: (number | null)[];
  colour: string;
  unit: string;              // "mm", "°C", ""
  digits?: number;
  height?: number;
}

export default function AnomalySeries({ days, values, norm, sd, colour, unit, digits = 1, height = 80 }: AnomalySeriesProps) {
  const { ref, width } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; cx: number; cy: number } | null>(null);
  const n = values.length;
  const plotH = height - M.top - M.bottom;
  const x0 = M.left, x1 = Math.max(x0 + 1, width - M.right);

  const G = useMemo(() => {
    const lo = norm.map((m, i) => (m != null && sd[i] != null ? m - (sd[i] as number) : null));
    const hi = norm.map((m, i) => (m != null && sd[i] != null ? m + (sd[i] as number) : null));
    const dom = yDomain(values, [...lo, ...hi]);
    const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([x0, x1]);
    const y = scaleLinear().domain(dom).range([plotH, 0]);
    const ln = d3line<number>().defined((_, i) => values[i] != null).x((_, i) => x(i)).y((_, i) => y(values[i] as number));
    const nm = d3line<number>().defined((_, i) => norm[i] != null).x((_, i) => x(i)).y((_, i) => y(norm[i] as number));
    const band = d3area<number>()
      .defined((_, i) => lo[i] != null && hi[i] != null)
      .x((_, i) => x(i))
      .y0((_, i) => y(lo[i] as number))
      .y1((_, i) => y(hi[i] as number));
    const idx = values.map((_, i) => i);
    const flags = idx.filter((i) => { const z = zScore(values[i], norm[i], sd[i]); return z != null && Math.abs(z) > FLAG_Z; });
    let last = n - 1;
    while (last > 0 && values[last] == null) last--;
    return { x, y, path: ln(idx) ?? "", normPath: nm(idx) ?? "", bandPath: band(idx) ?? "", flags, last, ticks: yTicks(dom, 3) };
  }, [values, norm, sd, n, x0, x1, plotH]);

  if (width <= 0) return <div ref={ref} style={{ height }} />;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const svgLeft = r.left - x0;
    const i = nearestIdx(e.clientX - svgLeft, x0, x1, n);
    const v = values[i];
    if (v == null) { setHover(null); return; }
    setHover({ i, cx: svgLeft + G.x(i), cy: r.top + G.y(v) });
  };

  const hv = hover ? values[hover.i] : null;
  const hz = hover ? zScore(values[hover.i], norm[hover.i], sd[hover.i]) : null;
  const labels = xLabelIdx(n, 30).map((i): [number, string] => [i, fmtDay(days[i] ?? "")]);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="anomaly series">
        <g transform={`translate(0,${M.top})`}>
          {G.ticks.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={G.y(t)} y2={G.y(t)} stroke={t === 0 ? P.axis : P.grid} strokeWidth={1} />
              <text x={x0 - 6} y={G.y(t)} dy="0.35em" textAnchor="end" fontSize={10} fill={P.muted} className="font-mono">{fmtTick(t)}</text>
            </g>
          ))}
          <path d={G.bandPath} fill={P.ink} opacity={0.08} />
          <path d={G.normPath} fill="none" stroke={P.ink2} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
          <path d={G.path} fill="none" stroke={colour} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
          {G.last >= 0 && values[G.last] != null && (
            <line x1={G.x(G.last)} x2={G.x(G.last)} y1={0} y2={plotH} stroke={P.ink} strokeWidth={1} opacity={0.6} />
          )}
          {G.flags.map((i) => (
            <circle key={i} cx={G.x(i)} cy={G.y(values[i] as number)} r={3.5} fill={P.surface} stroke={P.critical} strokeWidth={1.5} />
          ))}
          {labels.map(([i, text]) => (
            <text key={i} x={G.x(i)} y={plotH + 14} textAnchor={i === 0 ? "start" : "middle"} fontSize={10} fill={P.muted}>{text}</text>
          ))}
          {hover && hv != null && <circle cx={G.x(hover.i)} cy={G.y(hv)} r={3} fill={P.surface} stroke={colour} strokeWidth={1.5} />}
          <rect x={x0} y={0} width={x1 - x0} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </g>
      </svg>
      {hover && hv != null && (
        <Tooltip
          x={hover.cx}
          y={hover.cy}
          flip={typeof window !== "undefined" && hover.cx > window.innerWidth * 0.62}
          title={fmtDay(days[hover.i] ?? "")}
          rows={[
            { label: "observed", value: `${hv.toFixed(digits)} ${unit}`.trim(), colour },
            { label: "normal ±1σ", value: norm[hover.i] != null ? `${(norm[hover.i] as number).toFixed(digits)} ± ${(sd[hover.i] ?? 0).toFixed(digits)}`.trim() : "–", colour: P.ink2 },
            { label: "z", value: hz == null ? "–" : `${signed(hz, 2)}σ`, colour: hz != null && Math.abs(hz) > FLAG_Z ? P.critical : undefined },
          ]}
        />
      )}
    </div>
  );
}
