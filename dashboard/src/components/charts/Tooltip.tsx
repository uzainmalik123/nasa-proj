"use client";
// DESIGN.md §5 tooltip: bg-black/80, border-white/10, rounded-lg, 11px, blurred.
// Positioned in viewport coordinates so it escapes scrolling table cells, and
// flipped to the left when it would run past the right edge.
import type { ReactNode } from "react";

export interface TooltipRow {
  label: string;
  value: string;
  colour?: string;
}

export interface TooltipProps {
  x: number; // viewport px
  y: number;
  title?: string;
  rows: TooltipRow[];
  flip?: boolean; // place to the left of x
  children?: ReactNode;
}

export default function Tooltip({ x, y, title, rows, flip = false, children }: TooltipProps) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 whitespace-nowrap rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-[11px] leading-snug backdrop-blur"
      style={{ left: x, top: y, transform: `translate(${flip ? "calc(-100% - 10px)" : "10px"}, -50%)` }}
    >
      {title && <div className="mb-0.5 text-ink">{title}</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          {r.colour && (
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.colour }} />
          )}
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto pl-3 font-mono text-ink-2">{r.value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}
