"use client";
// DESIGN.md §5 chart catalogue · DriverBars: horizontal diverging bars for the
// wildfire model's SHAP values, labels left, mono values at the bar end,
// orange raises risk, blue lowers it. The threshold hazards publish reasons
// instead of SHAP, so they render as a short list in the same slot.
import { useMemo } from "react";
import { signed } from "@/lib/format";
import { P } from "@/lib/palette";
import type { ReasonDriver, ShapDriver } from "@/lib/types";
import { useSize } from "@/lib/useSize";

const ROW = 18;
const LABEL_W = 168;   // left column for the driver label
const VALUE_W = 46;    // right column for the feature value
const END_LABEL = 38;  // room for "+0.41" past the bar end

export function ShapBars({ drivers }: { drivers: ShapDriver[] }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const rows = useMemo(() => [...drivers].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)), [drivers]);
  const maxAbs = useMemo(() => rows.reduce((m, d) => Math.max(m, Math.abs(d.shap)), 0) || 1, [rows]);
  const height = rows.length * ROW;
  if (width <= 0) return <div ref={ref} style={{ height }} />;

  const x0 = LABEL_W, x1 = Math.max(x0 + 20, width - VALUE_W - 6);
  const mid = (x0 + x1) / 2;
  const half = Math.max(10, (x1 - x0) / 2 - END_LABEL);

  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="driver bars">
        <line x1={mid} x2={mid} y1={0} y2={height} stroke={P.axis} strokeWidth={1} />
        {rows.map((d, k) => {
          const w = (Math.abs(d.shap) / maxAbs) * half;
          const up = d.shap > 0;
          const colour = up ? P.s2 : P.s1;
          const bx = up ? mid : mid - w;
          const cy = k * ROW + ROW / 2;
          return (
            <g key={d.feature}>
              <title>{`${d.label}: feature value ${d.value.toFixed(2)}, SHAP ${signed(d.shap, 3)}`}</title>
              <text x={x0 - 8} y={cy} dy="0.35em" textAnchor="end" fontSize={10.5} fill={P.ink2}>
                {d.label.length > 32 ? `${d.label.slice(0, 31)}…` : d.label}
              </text>
              <rect x={bx} y={cy - 5} width={Math.max(1, w)} height={10} rx={2} fill={colour} opacity={0.9} />
              <text
                x={up ? mid + w + 5 : mid - w - 5} y={cy} dy="0.35em" textAnchor={up ? "start" : "end"}
                fontSize={10} fill={P.ink} className="font-mono"
              >
                {signed(d.shap, 2)}
              </text>
              <text x={width} y={cy} dy="0.35em" textAnchor="end" fontSize={10} fill={P.muted} className="font-mono">
                {Math.abs(d.value) >= 100 ? d.value.toFixed(0) : d.value.toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ReasonList({ reasons, colour }: { reasons: ReasonDriver[]; colour: string }) {
  if (!reasons.length) return <div className="text-[11px] text-muted">no drivers published</div>;
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((r, k) => (
        <li key={k} className="flex items-start gap-2 text-[11px] leading-snug text-ink-2">
          <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
          {r.reason}
        </li>
      ))}
    </ul>
  );
}

export default function DriverBars({ drivers, colour }: { drivers: ShapDriver[] | ReasonDriver[]; colour: string }) {
  const isShap = drivers.length > 0 && "shap" in drivers[0];
  if (isShap) return <ShapBars drivers={drivers as ShapDriver[]} />;
  return <ReasonList reasons={drivers as ReasonDriver[]} colour={colour} />;
}
