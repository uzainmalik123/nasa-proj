"use client";
// Shared chrome for the sidebar panels: Card, headings, chips, status dots,
// sortable table header. Tokens from DESIGN.md §2 only.
import type { ReactNode } from "react";
import { CATEGORY_V, riskColour } from "@/components/charts/ramp";
import { P } from "@/lib/palette";
import type { Category } from "@/lib/types";

export function Card({ title, caption, children, className = "" }: {
  title?: ReactNode; caption?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[14px] border border-border bg-surface px-4 py-3.5 ${className}`}>
      {title && <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>}
      {children}
      {caption && <div className="mt-2 text-[10px] leading-snug text-muted">{caption}</div>}
    </section>
  );
}

export function Chip({ children, colour, title }: { children: ReactNode; colour?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block rounded bg-white/10 px-1 font-mono text-[9px] uppercase tracking-wide text-ink-2"
      style={colour ? { color: colour } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * Category chip: a dot in the same ramp colour as the globe point for that
 * category (CATEGORY_V = the probability where the category starts; "low" is
 * muted), with the label in ink so it stays legible at the dark end of the ramp.
 */
export function CategoryChip({ category, title, children }: { category: Category; title?: string; children?: ReactNode }) {
  const colour = category === "low" ? P.muted : riskColour(CATEGORY_V[category]);
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded bg-white/10 px-1 font-mono text-[9px] uppercase tracking-wide text-ink-2"
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour, boxShadow: category === "extreme" ? `0 0 5px ${colour}` : undefined }} />
      {category}
      {children}
    </span>
  );
}

/** Δ chip: "+12 pt" orange when rising, "−8 pt" blue when falling (DESIGN §5). */
export function DeltaChip({ text, colour, title }: { text: string; colour: string; title?: string }) {
  return (
    <span title={title} className="inline-block rounded bg-white/10 px-1 font-mono text-[10px]" style={{ color: colour }}>
      {text}
    </span>
  );
}

export type Status = "ok" | "warn" | "bad" | "none";
const STATUS_COLOUR: Record<Status, string> = { ok: P.good, warn: P.warning, bad: P.critical, none: P.muted };

export function StatusDot({ status, title }: { status: Status; title?: string }) {
  return (
    <span
      role="img"
      aria-label={title ?? status}
      title={title}
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: STATUS_COLOUR[status], boxShadow: status === "ok" ? `0 0 6px ${P.good}66` : undefined }}
    />
  );
}

export interface SortState<K extends string> { key: K; dir: "asc" | "desc" }

export function SortHeader<K extends string>({
  k, label, sort, onSort, align = "left", className = "", title,
}: {
  k: K; label: ReactNode; sort: SortState<K>; onSort: (k: K) => void;
  align?: "left" | "right"; className?: string; title?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={`${align === "right" ? "text-right" : "text-left"} ${className} overflow-hidden pr-1 font-normal`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        title={title}
        onClick={() => onSort(k)}
        className={`group inline-flex max-w-full items-center gap-0.5 whitespace-nowrap text-[10px] uppercase tracking-wide transition ${
          active ? "text-ink-2" : "text-muted hover:text-ink"
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span className={`text-[7px] leading-none ${active ? "" : "opacity-0 group-hover:opacity-60"}`} aria-hidden="true">
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/** Toggle sort on a column; first click on a new column uses `defaultDir`. */
export function nextSort<K extends string>(s: SortState<K>, k: K, defaultDir: "asc" | "desc"): SortState<K> {
  if (s.key !== k) return { key: k, dir: defaultDir };
  return { key: k, dir: s.dir === "asc" ? "desc" : "asc" };
}

export function cmp(a: number | string | null, b: number | string | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last in either direction
  if (b == null) return -1;
  const r = typeof a === "string" || typeof b === "string" ? String(a).localeCompare(String(b)) : a - b;
  return dir === "asc" ? r : -r;
}

/** Row chrome shared by the ranked tables (DESIGN §5: 28 px, 11 px, border only). */
export const ROW_CLASS = "h-7 cursor-pointer border-t border-border text-[11px] transition hover:bg-white/[0.04]";
export const ROW_SELECTED = "bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]";
export const TABLE_SCROLL = "max-h-[560px] overflow-y-auto"; // ~20 rows of 28 px
