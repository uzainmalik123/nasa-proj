"use client";
// DESIGN.md §5 table rules: 64 × 16 px, 1.2 px line in the series colour, no
// axes. Optional area fill under the line (risk sparklines use the ramp colour).
// Hover: nearest-point lookup over one transparent rect, tooltip at the point.
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { useMemo, useState } from "react";
import { P } from "@/lib/palette";
import Tooltip from "./Tooltip";

export interface SparklineProps {
  values: (number | null)[];
  colour?: string;
  fill?: string | null;      // area fill colour; null = none
  width?: number;
  height?: number;
  /** label for point i in the tooltip ("14 Nov"); omit for no hover */
  labelAt?: (i: number) => string;
  format?: (v: number) => string;
  /** fixed y domain; defaults to the data's own extent with a little headroom */
  domain?: [number, number];
  /** draw a faint zero line when 0 is inside the domain */
  zeroLine?: boolean;
}

export default function Sparkline({
  values, colour = P.ink2, fill = null, width = 64, height = 16, labelAt,
  format = (v) => v.toFixed(2), domain, zeroLine = false,
}: SparklineProps) {
  const [hover, setHover] = useState<{ i: number; cx: number; cy: number } | null>(null);
  const n = values.length;

  const { x, y, path, areaPath, zeroY } = useMemo(() => {
    const pad = 1.5;
    const x = scaleLinear().domain([0, Math.max(1, n - 1)]).range([pad, width - pad]);
    const nums = values.filter((v): v is number => v != null);
    let lo = domain?.[0] ?? (nums.length ? Math.min(...nums) : 0);
    let hi = domain?.[1] ?? (nums.length ? Math.max(...nums) : 1);
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }
    const y = scaleLinear().domain([lo, hi]).range([height - pad, pad]);
    const ln = d3line<[number, number | null]>()
      .defined((d) => d[1] != null)
      .x((d) => x(d[0]))
      .y((d) => y(d[1] as number));
    const ar = d3area<[number, number | null]>()
      .defined((d) => d[1] != null)
      .x((d) => x(d[0]))
      .y0(height - pad)
      .y1((d) => y(d[1] as number));
    const pts: [number, number | null][] = values.map((v, i) => [i, v]);
    return {
      x, y,
      path: ln(pts) ?? "",
      areaPath: fill ? ar(pts) ?? "" : "",
      zeroY: zeroLine && lo < 0 && hi > 0 ? y(0) : null,
    };
  }, [values, n, width, height, domain, fill, zeroLine]);

  if (n === 0 || width <= 0) return <span className="inline-block" style={{ width, height }} />;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!labelAt) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(x.invert(e.clientX - r.left))));
    const v = values[i];
    if (v == null) { setHover(null); return; }
    setHover({ i, cx: r.left + x(i), cy: r.top + y(v) });
  };

  const hv = hover ? values[hover.i] : null;

  return (
    <span className="relative inline-block align-middle" style={{ width, height }}>
      <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
        {areaPath && <path d={areaPath} fill={fill ?? "none"} opacity={0.25} />}
        {zeroY != null && <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke={P.axis} strokeWidth={1} />}
        <path d={path} fill="none" stroke={colour} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
        {hover && hv != null && (
          <circle cx={x(hover.i)} cy={y(hv)} r={2.2} fill={P.surface} stroke={colour} strokeWidth={1.2} />
        )}
        {labelAt && (
          <rect
            x={0} y={-4} width={width} height={height + 8} fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        )}
      </svg>
      {hover && hv != null && labelAt && (
        <Tooltip
          x={hover.cx}
          y={hover.cy}
          flip={typeof window !== "undefined" && hover.cx > window.innerWidth * 0.62}
          rows={[{ label: labelAt(hover.i), value: format(hv), colour }]}
        />
      )}
    </span>
  );
}
