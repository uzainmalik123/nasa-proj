"use client";
// Alert feed (PRD H9, DESIGN.md §7): feed.json newest first, a pulsing ring on
// the newest alert, anomaly chips, the full alert record on hover. Clicking an
// alert selects its place and its hazard.
import { useMemo } from "react";
import { HAZARD_COLOUR } from "@/components/charts/ramp";
import { HAZARD_LABEL, fmtCount, fmtDay, fmtUtc, pct } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Alert, AlertTrigger, FeedFile, Hazard, Place } from "@/lib/types";
import { fmtSeverity } from "./HazardCard";
import { Card, CategoryChip, Chip, Stamp } from "./ui";

const TRIGGER_LABEL: Record<AlertTrigger, string> = {
  category_up: "category ↑",
  z_above_2: "risk > 2σ above 90-day mean",
  new_anomaly: "new anomaly",
};

const ANOMALY_LABEL: Record<string, string> = {
  rain: "rain", soil: "soil", tmax: "tmax", rh: "humidity", wind: "wind", fires: "fires", ndvi: "ndvi",
};

const ANOMALY_COLOUR: Record<string, string> = {
  rain: P.s1, soil: P.s1, tmax: P.s4, rh: P.s1, wind: P.muted, fires: P.s2, ndvi: P.s3,
};

/** Headline for the alert row: probability for the model hazards, severity for the threshold ones. */
function alertHeadline(a: Alert): string {
  if (a.probability != null && (a.hazard === "wildfire" || a.hazard === "rain")) return pct(a.probability);
  return fmtSeverity(a.hazard, a.severity);
}

export interface FeedProps {
  feed: FeedFile | null;
  places: Place[];
  selected: number | null;
  hazard: Hazard;
  filter: Set<number> | null;
  onPick: (place: number, hazard: Hazard) => void;
  maxRows?: number;
}

export default function Feed({ feed, places, selected, hazard, filter, onPick, maxRows = 50 }: FeedProps) {
  const alerts = useMemo(() => {
    const all = feed?.alerts ?? [];
    return (filter ? all.filter((a) => filter.has(a.place)) : all).slice(0, maxRows);
  }, [feed, filter, maxRows]);
  const newestId = feed?.alerts[0]?.id;
  const active = alerts.filter((a) => a.status !== "expired").length;

  return (
    <Card
      title={<>Feed · what crossed a line since the last runs?</>}
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>one alert per place per hazard per 7 days · newest first · pulse = newest</span>
          <span>triggers: category up · risk {">"} 2σ above its own 90-day mean · new |z| {">"} 1.5 anomaly</span>
          <span>{feed ? `${active} active of ${alerts.length}${filter ? " in region" : ""} · run ${feed.meta.run_id}` : "loading…"}</span>
          <Stamp valid="per alert, shown on each row" retrieved={feed?.meta.generated_at} kind="risk assessment" />
        </span>
      }
    >
      <div className="max-h-[420px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {!feed && <div className="h-[420px]" aria-hidden="true" />}
        {feed && alerts.length === 0 && (
          <div className="py-4 text-center text-[11px] text-muted">no alerts{filter ? " in this region" : ""}</div>
        )}
        <ul className="flex flex-col">
          {alerts.map((a) => {
            const place = places[a.place];
            const colour = HAZARD_COLOUR[a.hazard];
            const isSel = selected === a.place && hazard === a.hazard;
            const expired = a.status === "expired";
            return (
              <li key={a.id} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  onClick={() => onPick(a.place, a.hazard)}
                  aria-pressed={isSel}
                  title={[
                    a.id,
                    `issued ${fmtUtc(a.issued_at, true)} · valid ${a.valid_from} → ${a.valid_to}`,
                    `severity ${a.severity} · exposure ${fmtCount(a.exposure)} · confidence ${a.confidence}`,
                    `evidence: ${a.evidence.join(", ")}`,
                    `model ${a.model_version}`,
                  ].join("\n")}
                  className={`flex w-full items-start gap-2.5 px-1 py-1.5 text-left transition hover:bg-white/[0.04] ${
                    isSel ? "bg-white/[0.06] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]" : ""
                  } ${expired ? "opacity-50" : ""}`}
                >
                  {/* hazard dot, pulsing on the newest alert */}
                  <span className="relative mt-[5px] inline-block h-2 w-2 shrink-0">
                    {a.id === newestId && !expired && (
                      <span className="pulse-ring absolute inset-0 rounded-full" style={{ background: colour }} aria-hidden="true" />
                    )}
                    <span className="absolute inset-0 rounded-full" style={{ background: colour }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[11px] leading-snug">
                      <span className="truncate text-ink">{place?.name ?? a.place_id}</span>
                      <span className="text-muted">{place?.country ?? ""}</span>
                      <span className="uppercase tracking-wide" style={{ color: colour, fontSize: 10 }}>{HAZARD_LABEL[a.hazard]}</span>
                      <span className="ml-auto shrink-0 font-mono text-ink">{alertHeadline(a)}</span>
                      <CategoryChip category={a.category} />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] leading-snug text-muted">
                      <span className="font-mono">{fmtUtc(a.issued_at)} UTC</span>
                      <span>· {TRIGGER_LABEL[a.trigger]}</span>
                      {a.anomalies.map((k) => (
                        <Chip key={k} colour={ANOMALY_COLOUR[k] ?? P.ink2} title={`${ANOMALY_LABEL[k] ?? k} anomaly flagged`}>{ANOMALY_LABEL[k] ?? k}</Chip>
                      ))}
                      {a.status !== "active" && <Chip title={`status ${a.status}`}>{a.status}</Chip>}
                      <span className="ml-auto font-mono">valid {fmtDay(a.valid_from)} → {fmtDay(a.valid_to)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-ink-2">{a.explanation}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
