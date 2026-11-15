"use client";
// Shared chrome for the sidebar panels: Card, headings, chips, status dots,
// sortable table header. Tokens from DESIGN.md §2 only.
import type { ReactNode } from "react";
import { CATEGORY_V, riskColour } from "@/components/charts/ramp";
import { fmtUtc } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Category } from "@/lib/types";

export function Card({ title, caption, children, className = "" }: {
  title?: ReactNode; caption?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-[14px] border border-border bg-surface px-4 py-3.5 ${className}`}>
      {title && <h2 className="mb-2.5 text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.06em] text-ink-2 [text-wrap:balance]">{title}</h2>}
      {children}
      {caption && <div className="mt-2.5 text-[11px] leading-[1.45] text-muted [text-wrap:pretty]">{caption}</div>}
    </section>
  );
}

export function Chip({ children, colour, title }: { children: ReactNode; colour?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block rounded bg-white/10 px-1 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-2"
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
      className="inline-flex items-center gap-1 rounded bg-white/10 px-1 font-mono text-[10px] uppercase tracking-[0.04em] text-ink-2"
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

/** A non-sortable header cell laid out exactly like SortHeader's (same inline-flex box), so header text shares one baseline. */
export function PlainHeader({ label, align = "left", title }: { label: ReactNode; align?: "left" | "right"; title?: string }) {
  return (
    <th className={`${align === "right" ? "text-right" : "text-left"} overflow-hidden pr-1 font-normal`} title={title}>
      <span className="inline-flex max-w-full items-center gap-0.5 whitespace-nowrap text-[10px] uppercase tracking-wide text-muted">
        <span className="truncate">{label}</span>
        <span className="text-[7px] leading-none opacity-0" aria-hidden="true">▼</span>
      </span>
    </th>
  );
}

/**
 * Loading state for the ranked tables (DESIGN §8 no layout shift): `n` rows at
 * the real 28 px row height with static muted bars, so the card is already its
 * loaded height. Static on purpose: nothing animates on load (DESIGN §7).
 */
export function SkeletonRows({ n, cols }: { n: number; cols: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, r) => (
        <tr key={r} className="h-7 border-t border-border" aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="pr-1">
              <span className="block h-2 rounded-sm bg-white/[0.05]" style={{ width: c === 1 ? `${55 + ((r * 37) % 35)}%` : "70%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Provenance line for a panel caption (PRD §7.4: every panel shows valid time
 * and retrieved time): "valid <window> · retrieved <UTC> · <kind>". `retrieved`
 * is the producing file's meta.generated_at.
 */
export function Stamp({ valid, retrieved, kind }: { valid?: ReactNode; retrieved: string | null | undefined; kind: string }) {
  return (
    <span>
      {valid != null && <>valid <span className="font-mono">{valid}</span> · </>}
      retrieved <span className="font-mono">{fmtUtc(retrieved, true)}</span> · {kind}
    </span>
  );
}
