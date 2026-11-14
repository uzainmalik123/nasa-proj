"use client";
// Selected-place card. S4-A ships the header and the four headline numbers so
// the layout holds; S4-B adds the TrendChart, AnomalySeries, HazardCards,
// DriverBars and the explanation sentence (PRD H8).
import { fmtHeadline } from "./HazardsTable";
import { HAZARD_LABEL, VARIABLE_LABEL, fmtCount, fmtP, fmtSlope } from "@/lib/format";
import { P } from "@/lib/palette";
import { HAZARDS, type Data, type Hazard, type Variable } from "@/lib/types";
import { Card, Chip } from "./ui";
import { HAZARD_COLOUR, riskColour, CATEGORY_V } from "@/components/charts/ramp";

export default function PlacePanel({ data, selected, trendVar, onClear }: {
  data: Data | null; selected: number | null; trendVar: Variable; onClear: () => void;
}) {
  if (!data || selected == null || !data.places.places[selected]) {
    return (
      <Card title="Selected place">
        <div className="text-[11.5px] leading-snug text-ink-2">
          Click a row or a globe point. Trend chart, anomaly series and the four hazard cards land here (S4-B).
          <kbd className="ml-1 rounded bg-white/10 px-1 font-mono text-[9px]">Esc</kbd> clears.
        </div>
      </Card>
    );
  }
  const p = data.places.places[selected];
  const r = data.risk.now[selected];
  const vi = data.trends.variables.indexOf(trendVar);
  const slope = data.trends.long.slope[selected]?.[vi];
  const pv = data.trends.long.p[selected]?.[vi];
  const label = data.trends.long.label[selected]?.[vi];
  return (
    <Card
      title={
        <span className="flex items-center justify-between">
          <span>Selected place · {p.name}</span>
          <button type="button" onClick={onClear} className="text-[10px] normal-case tracking-normal text-muted hover:text-ink" aria-label="clear selection">
            clear
          </button>
        </span>
      }
      caption={`${p.continent} · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)} · pop ${fmtCount(p.pop)} · watch radius ${p.radius_km} km`}
    >
      <div className="mb-2 text-[11.5px] leading-snug text-ink-2">
        <span className="text-ink">{VARIABLE_LABEL[trendVar]}</span>, 10-year trend:{" "}
        <span className="font-mono text-ink">{fmtSlope(slope)} {data.trends.units[vi]}</span>{" "}
        <span className="font-mono">· p={fmtP(pv)}</span> · {label}
        {pv != null && pv < 0.05 ? "" : " · not significant"}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {HAZARDS.map((h: Hazard) => (
          <div key={h} className="rounded-lg border border-border bg-surface-2 px-2 py-1.5" style={{ borderLeft: `3px solid ${HAZARD_COLOUR[h]}` }}>
            <div className="text-[10px] uppercase tracking-wide text-muted">{HAZARD_LABEL[h]}</div>
            <div className="font-mono text-[18px] font-semibold leading-tight text-ink">
              {r ? fmtHeadline(h, h === "wildfire" ? r.wildfire.p : h === "rain" ? r.rain.p : h === "drought" ? r.drought.index : r.heat.days_above) : "–"}
            </div>
            {r && (
              <Chip colour={riskColour(Math.max(0.25, CATEGORY_V[r[h].category]))}>{r[h].category}</Chip>
            )}
            {r && <div className="mt-0.5 text-[9.5px] text-muted">conf {r[h].confidence}</div>}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] leading-snug text-ink-2" style={{ borderLeft: `2px solid ${P.axis}`, paddingLeft: 8 }}>
        {data.risk.text[selected]?.wildfire ?? ""}
      </div>
    </Card>
  );
}
