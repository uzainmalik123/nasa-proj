"use client";
// DESIGN.md §5 chart catalogue · Hazard card: hazard name, 22 px probability
// or category, then four 10 px rows (severity, exposure, confidence, valid
// window) and a coloured left border in the hazard's colour. The four numbers
// are never collapsed into one. Clicking a card picks the hazard whose drivers
// and sentence the panel shows.
//
// M-MODE+URL (PRD M5): the headline follows the mode. "next14" = the forecast
// probability (index / days for drought / heat) with the category as a chip;
// "now" = the category the place is in today, with the number demoted to the
// sub line.
import { CATEGORY_V, HAZARD_COLOUR, riskColour } from "@/components/charts/ramp";
import { CONFIDENCE_ORDER, HAZARD_LABEL, fmtCount, fmtDay, pct, signed } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Hazard, Mode, RiskNow } from "@/lib/types";
import { CategoryChip } from "./ui";

/** Headline per hazard: probability for the model hazards, category-bearing value for the threshold ones. */
export function hazardHeadline(h: Hazard, r: RiskNow): { big: string; sub: string } {
  switch (h) {
    case "wildfire": return { big: pct(r.wildfire.p), sub: "p · 14 days" };
    case "rain": return { big: pct(r.rain.p), sub: "p · wet week" };
    case "drought": return { big: signed(r.drought.index, 1), sub: "index" };
    case "heat": return { big: `${Math.round(r.heat.days_above)} d`, sub: "days > P95" };
  }
}

/** Severity in the unit contracts.md §3 gives per hazard. */
export function fmtSeverity(h: Hazard, s: number | null | undefined): string {
  if (s == null) return "–";
  switch (h) {
    case "wildfire": return `FWI ${s.toFixed(2)}`;
    case "drought": return `${Math.round(s * 100)}% deficit`;
    case "heat": return `${signed(s, 1)} °C`;
    case "rain": return `${signed(s, 0)} mm`;
  }
}

export const SEVERITY_NOTE: Record<Hazard, string> = {
  wildfire: "forecast fire weather index, 0–1",
  drought: "rainfall deficit as a fraction of the place's normal",
  heat: "°C above the place's own 95th-percentile max temperature",
  rain: "mm above the place's own 95th-percentile week",
};

export default function HazardCard({ hazard, now, mode = "next14", validFrom, validTo, selected, onPick }: {
  hazard: Hazard; now: RiskNow | null; mode?: Mode; validFrom: string; validTo: string; selected: boolean; onPick: () => void;
}) {
  const colour = HAZARD_COLOUR[hazard];
  const r = now?.[hazard];
  const head = now ? hazardHeadline(hazard, now) : { big: "–", sub: "" };
  const conf = r?.confidence;
  const byCategory = mode === "now";
  const catColour = r ? (r.category === "low" ? P.muted : riskColour(CATEGORY_V[r.category])) : P.muted;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title={`${HAZARD_LABEL[hazard]} · severity = ${SEVERITY_NOTE[hazard]}`}
      className={`flex min-w-0 flex-col rounded-lg border bg-surface-2 px-2 py-1.5 text-left transition ${
        selected ? "border-white/30 bg-white/[0.06]" : "border-border hover:bg-white/[0.04]"
      }`}
      style={{ borderLeft: `3px solid ${colour}` }}
    >
      <div className="truncate text-[10px] uppercase tracking-wide text-muted">{HAZARD_LABEL[hazard]}</div>
      {byCategory ? (
        <>
          {/* category word at 19 px so "elevated" fits a 4-up card; the dot carries the ramp colour (chips keep text in ink, DESIGN §2) */}
          <div className="flex items-center gap-1.5 font-mono text-[19px] font-semibold leading-[28px] text-ink" data-category={r?.category}>
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: catColour, boxShadow: r?.category === "extreme" ? `0 0 6px ${catColour}` : undefined }}
            />
            <span className="truncate">{r?.category ?? "–"}</span>
          </div>
          <div className="mb-1 flex items-center justify-between gap-1 text-[9.5px] text-muted">
            <span className="truncate">category today</span>
            <span className="font-mono text-ink-2" title={head.sub}>{head.big}</span>
          </div>
        </>
      ) : (
        <>
          <div className="font-mono text-[22px] font-semibold leading-tight text-ink">{head.big}</div>
          <div className="mb-1 flex items-center justify-between gap-1 text-[9.5px] text-muted">
            <span className="truncate">{head.sub}</span>
            {r && <CategoryChip category={r.category} />}
          </div>
        </>
      )}
      <Row k="severity" v={fmtSeverity(hazard, r?.severity)} />
      <Row k="exposure" v={r ? `${fmtCount(r.exposure)} pop` : "–"} />
      <Row
        k="confidence"
        v={conf ?? "–"}
        title={conf ? `confidence ${CONFIDENCE_ORDER.indexOf(conf) + 1} of 3 · data completeness × held-out skill` : undefined}
        colour={conf === "low" ? P.warning : undefined}
      />
      <Row k="valid" v={fmtWindow(validFrom, validTo)} />
    </button>
  );
}

/** "14–28 Nov" when both ends share a month, else "28 Nov–12 Dec". */
export function fmtWindow(from: string, to: string): string {
  const a = fmtDay(from), b = fmtDay(to);
  const [ad, am] = a.split(" "), [, bm] = b.split(" ");
  return am === bm ? `${ad}–${b}` : `${a}–${b}`;
}

function Row({ k, v, colour, title }: { k: string; v: React.ReactNode; colour?: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1 text-[10px] leading-[14px]" title={title}>
      <span className="text-muted">{k}</span>
      <span className="truncate font-mono text-ink-2" style={colour ? { color: colour } : undefined}>{v}</span>
    </div>
  );
}
