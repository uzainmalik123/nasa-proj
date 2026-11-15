"use client";
// Movers (PRD M3, DESIGN.md §5 chart catalogue): two short tables side by
// side, the ten places whose risk for the chosen hazard rose most since 7 days
// ago (orange Δ) and the ten whose risk fell most (blue Δ). Same row anatomy
// as the ranked table: rank, name, country, headline as mono + ramp bar, Δ chip.
// Reads risk.json `movers` (S2-C); recomputes in the browser when the file
// predates the block or a continent filter is on (the published top-10 is global).
import { useMemo } from "react";
import RampBar from "@/components/charts/RampBar";
import { CATEGORY_V, deltaColour, riskColour } from "@/components/charts/ramp";
import { computeMovers, worse } from "@/lib/aggregate";
import { HAZARD_LABEL, fmtDay } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Hazard, MoverRow, MoversBlock, Place, RiskFile } from "@/lib/types";
import { fmtDelta, fmtHeadline } from "./HazardsTable";
import { Card, DeltaChip, ROW_CLASS, ROW_SELECTED, SkeletonRows, Stamp } from "./ui";

export interface MoversProps {
  places: Place[];
  risk: RiskFile | null;
  hazard: Hazard;
  selected: number | null;
  filter: Set<number> | null;
  continent: string | null;
  onPick: (i: number) => void;
}

/** Ramp position for a mover's headline: p for the model hazards, the category stop otherwise. */
function rampV(h: Hazard, row: MoverRow): number {
  if (h === "wildfire" || h === "rain") return row.value ?? 0;
  return CATEGORY_V[row.category];
}

export default function Movers({ places, risk, hazard, selected, filter, continent, onPick }: MoversProps) {
  const { block, source } = useMemo<{ block: MoversBlock | null; source: "file" | "browser" }>(() => {
    if (!risk || !places.length) return { block: null, source: "file" };
    const published = risk.movers?.[hazard];
    if (published && !filter) return { block: published, source: "file" };
    return { block: computeMovers(places, risk, hazard, filter), source: "browser" };
  }, [risk, places, hazard, filter]);

  const continuous = hazard === "wildfire" || hazard === "rain";
  const since = block?.since ? fmtDay(block.since) : "7 days ago";
  const where = continent ? ` in ${continent}` : "";

  return (
    <Card
      title={<>Movers · whose {HAZARD_LABEL[hazard]} risk changed most since {since}{where}?</>}
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>
            <i className="mr-1 inline-block h-[3px] w-4 rounded-sm align-middle" style={{ background: P.s2 }} />up = more risk ·
            <i className="mx-1 inline-block h-[3px] w-4 rounded-sm align-middle" style={{ background: P.s1 }} />down = less
            {hazard === "drought" ? " · drought index falls as risk rises, so a rising mover shows a negative Δ" : ""}
          </span>
          <span>Δ = today&apos;s {hazard === "heat" ? "days above P95" : hazard === "drought" ? "index" : "probability"} minus the hindcast value on {since} · top 10 each way</span>
          <span>
            {block ? `${block.up.length} rising · ${block.down.length} falling` : "loading…"}
            {source === "browser" ? ` · computed in the browser${filter ? " for the region" : " (run predates movers)"}` : ` · from run ${risk?.meta.run_id ?? "–"}`}
          </span>
          <Stamp valid={risk ? `${risk.valid_from} → ${risk.valid_to}` : "–"} retrieved={risk?.meta.generated_at} kind="risk assessment" />
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Side label="up" colour={P.s2} rows={block?.up ?? []} hazard={hazard} places={places} selected={selected} continuous={continuous} since={since} onPick={onPick} loaded={!!block} />
        <Side label="down" colour={P.s1} rows={block?.down ?? []} hazard={hazard} places={places} selected={selected} continuous={continuous} since={since} onPick={onPick} loaded={!!block} />
      </div>
    </Card>
  );
}

function Side({ label, colour, rows, hazard, places, selected, continuous, since, onPick, loaded }: {
  label: "up" | "down"; colour: string; rows: MoverRow[]; hazard: Hazard; places: Place[];
  selected: number | null; continuous: boolean; since: string; onPick: (i: number) => void; loaded: boolean;
}) {
  const valueHeader = continuous ? "p 14d" : hazard === "drought" ? "index" : "days";
  return (
    <table className="w-full table-fixed border-collapse" aria-label={`${label} movers`}>
      <colgroup>
        <col style={{ width: 18 }} /><col /><col style={{ width: 24 }} /><col style={{ width: 66 }} /><col style={{ width: 54 }} />
      </colgroup>
      <thead>
        <tr className="h-6">
          <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide" style={{ color: colour }} colSpan={2}>
            <span className="mr-1" aria-hidden="true">{label === "up" ? "▲" : "▼"}</span>{label}
          </th>
          <th className="pr-1 text-left text-[10px] font-normal uppercase tracking-wide text-muted">cc</th>
          <th className="pr-1 text-right text-[10px] font-normal uppercase tracking-wide text-muted">{valueHeader}</th>
          <th className="text-right text-[10px] font-normal uppercase tracking-wide text-muted">Δ</th>
        </tr>
      </thead>
      <tbody>
        {!loaded && <SkeletonRows n={10} cols={5} />}
        {loaded && rows.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-[11px] text-muted">nothing moved {label}</td></tr>
        )}
        {rows.map((r, k) => {
          const place = places[r.place];
          if (!place) return null;
          const v = rampV(hazard, r);
          const w = r.delta == null ? null : worse(hazard, r.delta);
          return (
            <tr
              key={r.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected === r.place}
              onClick={() => onPick(r.place)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.place); } }}
              className={`${ROW_CLASS} ${selected === r.place ? ROW_SELECTED : ""}`}
              title={`${place.name}: ${fmtHeadline(hazard, r.ago)} on ${since} → ${fmtHeadline(hazard, r.value)} today · ${r.category}`}
            >
              <td className="pr-1 font-mono text-muted">{k + 1}</td>
              <td className="truncate pr-1 text-ink">{place.name}</td>
              <td className="pr-1 text-muted">{place.country}</td>
              <td className="pr-1 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <span className="font-mono text-ink">{fmtHeadline(hazard, r.value)}</span>
                  <RampBar v={v} width={24} colour={riskColour(Math.max(0.2, v))} />
                </span>
              </td>
              <td className="text-right">
                <DeltaChip text={fmtDelta(hazard, r.delta)} colour={deltaColour(w, continuous ? 0.005 : 0)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
