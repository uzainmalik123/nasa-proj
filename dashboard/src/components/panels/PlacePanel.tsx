"use client";
// Selected-place panel (PRD H8). Top to bottom: header, TrendChart for the
// chosen variable with the other variables' labels as switchable chips, three
// AnomalySeries (30-day rain, max temperature, soil wetness vs the place's own
// normal band), four HazardCards, DriverBars for the picked hazard, and the
// sentence. Everything reads the contract shapes in types.ts.
import AnomalySeries, { FLAG_Z } from "@/components/charts/AnomalySeries";
import DriverBars from "@/components/charts/DriverBars";
import TrendChart, { TrendLabelText, type TrendWindowData } from "@/components/charts/TrendChart";
import { HAZARD_COLOUR } from "@/components/charts/ramp";
import { HAZARD_LABEL, VARIABLE_LABEL, fmtCount, fmtDay, fmtMonth, fmtUtc, signed } from "@/lib/format";
import { P } from "@/lib/palette";
import { HAZARDS, VARIABLES, type Data, type Hazard, type Mode, type SeriesFile, type Variable } from "@/lib/types";
import { zScore } from "@/components/charts/chart";
import HazardCard from "./HazardCard";
import { Card } from "./ui";

/** Series colour bound to a variable (DESIGN.md §2: rain blue, temperature yellow, fire orange, vegetation aqua). */
export const VARIABLE_COLOUR: Record<Variable, string> = {
  rain_mm: P.s1,
  tmax_c: P.s4,
  rh_pct: P.s1,
  wind_ms: P.ink2,
  soil_wet: P.s1,
  fires: P.s2,
  ndvi: P.s3,
};

/** Which 90-day daily series in series.json stands in for each trend variable, and what it is. */
const SHORT_SERIES: Partial<Record<Variable, { key: keyof SeriesFile; note: string }>> = {
  rain_mm: { key: "rain_30d", note: "30-day total" },
  tmax_c: { key: "tmax", note: "daily max" },
  soil_wet: { key: "soil_wet", note: "daily" },
  fires: { key: "fires_7d", note: "7-day count" },
};

const ANOMALY_ROWS: { key: "rain_30d" | "tmax" | "soil_wet"; label: string; unit: string; digits: number; colour: string }[] = [
  { key: "rain_30d", label: "30-day rainfall", unit: "mm", digits: 0, colour: P.s1 },
  { key: "tmax", label: "max temperature", unit: "°C", digits: 1, colour: P.s4 },
  { key: "soil_wet", label: "root-zone soil wetness (0–1)", unit: "", digits: 2, colour: P.s1 },
];

export interface PlacePanelProps {
  data: Data | null;
  selected: number | null;
  trendVar: Variable;
  hazard: Hazard;
  /** "now" = category headlines on the hazard cards, "next14" = probability (M-MODE+URL) */
  mode?: Mode;
  onTrendVar: (v: Variable) => void;
  onHazard: (h: Hazard) => void;
  onClear: () => void;
}

export default function PlacePanel({ data, selected, trendVar, hazard, mode = "next14", onTrendVar, onHazard, onClear }: PlacePanelProps) {
  if (!data || selected == null || !data.places.places[selected]) {
    return (
      <Card title="Selected place" caption="Observation (POWER, FIRMS) · trend (Mann-Kendall) · risk assessment (hazard modules) · forecast (Open-Meteo) are shown as four different things.">
        <div className="text-[11.5px] leading-snug text-ink-2">
          Click a row, a globe point or an alert to see its 10-year and 90-day trends, the last 90 days against the place&apos;s own normal,
          the four hazards for the next 14 days and what drives them.
          <kbd className="ml-1 rounded bg-white/10 px-1 font-mono text-[9px]">Esc</kbd> clears.
        </div>
      </Card>
    );
  }

  const i = selected;
  const p = data.places.places[i];
  const { trends, risk, series } = data;
  const vi = trends.variables.indexOf(trendVar);
  const unit = trends.units[vi] ?? "";
  // the chart's y unit: the slope unit without "/yr" (same rule as the TrendChart tooltip)
  const yUnit = unit.replace(/\/yr$/, "");

  const long: TrendWindowData = {
    keys: trends.months,
    values: trends.series_long[i]?.[vi] ?? [],
    slope: trends.long.slope[i]?.[vi] ?? null,
    p: trends.long.p[i]?.[vi] ?? null,
    label: trends.long.label[i]?.[vi] ?? "insufficient",
  };
  const shortSpec = SHORT_SERIES[trendVar];
  const shortValues = shortSpec ? ((series[shortSpec.key] as (number | null)[][])[i] ?? null) : null;
  const short: TrendWindowData = {
    keys: series.days,
    values: shortValues ?? [],
    slope: trends.short.slope[i]?.[vi] ?? null,
    p: trends.short.p[i]?.[vi] ?? null,
    label: trends.short.label[i]?.[vi] ?? "insufficient",
  };

  const now = risk.now[i] ?? null;
  const drivers = risk.drivers[i]?.[hazard] ?? [];
  const sentence = risk.text[i]?.[hazard] ?? "";
  const hz = HAZARD_COLOUR[hazard];
  const lastDay = series.days[series.days.length - 1];

  return (
    <Card
      title={
        <span className="flex items-center justify-between">
          <span>Selected place · {p.name}, {p.country}</span>
          <button type="button" onClick={onClear} className="text-[10px] normal-case tracking-normal text-muted hover:text-ink" aria-label="clear selection">
            clear
          </button>
        </span>
      }
      caption={`${p.continent} · ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)} · pop ${fmtCount(p.pop)} within ${p.radius_km} km${p.capital ? " · capital" : ""} · run ${data.run.run_id} · retrieved ${fmtUtc(risk.meta.generated_at, true)}`}
    >
      {/* ── trend ─────────────────────────────────────────────────────── */}
      <SectionHead
        left={<>How has <span className="text-ink">{VARIABLE_LABEL[trendVar]}</span> changed here?</>}
        right={<span className="text-muted">trend · valid {trends.months.length ? `${fmtMonth(trends.months[0])} → ${fmtMonth(trends.months[trends.months.length - 1])}` : "–"} · NASA POWER{trendVar === "fires" ? " / FIRMS" : ""}</span>}
      />
      <div className="mb-1 flex items-end justify-between gap-2 text-[10px] text-muted">
        <span className="flex flex-col">
          <span>10 years · monthly mean{yUnit ? ` · y in ${yUnit}` : ""}</span>
          <TrendLabelText w={long} unit={unit} />
        </span>
        <span className="flex flex-col items-end text-right">
          <span>last 90 days{shortSpec ? ` · ${shortSpec.note}` : ""}{yUnit ? ` · ${yUnit}` : ""}</span>
          <TrendLabelText w={short} unit={unit} />
        </span>
      </div>
      <TrendChart
        long={long}
        short={shortValues ? short : null}
        unit={unit}
        colour={VARIABLE_COLOUR[trendVar]}
        shortNote={shortSpec?.note}
        height={150}
      />
      {!shortSpec && (
        <div className="mt-1 text-[10px] text-muted">no daily series is published for {VARIABLE_LABEL[trendVar]}; the 90-day slope above is from the pipeline&apos;s own daily values.</div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        <span><i className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ background: VARIABLE_COLOUR[trendVar] }} />observed</span>
        <span><i className="mr-1 inline-block w-4 border-t-[1.5px] border-dashed align-middle" style={{ borderColor: P.ink }} />Sen&apos;s slope · {unit}</span>
        <span>white = p {"<"} 0.05</span>
      </div>
      {/* the other variables, one chip each with its 10-year label (DESIGN: one per variable; stacked would not fit the aside) */}
      <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="trend variable">
        {VARIABLES.map((v) => {
          const k = trends.variables.indexOf(v);
          if (k < 0) return null;
          const w: TrendWindowData = {
            keys: [], values: [],
            slope: trends.long.slope[i]?.[k] ?? null, p: trends.long.p[i]?.[k] ?? null, label: trends.long.label[i]?.[k] ?? "insufficient",
          };
          const on = v === trendVar;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onTrendVar(v)}
              className={`rounded border px-1.5 py-0.5 text-[10px] transition ${on ? "border-white/30 bg-white/[0.06] text-ink" : "border-border text-muted hover:text-ink"}`}
            >
              {VARIABLE_LABEL[v]} <TrendLabelText w={w} unit={trends.units[k] ?? ""} />
            </button>
          );
        })}
      </div>

      {/* ── anomalies ─────────────────────────────────────────────────── */}
      <SectionHead
        className="mt-3"
        left={<>Is the last 90 days unusual for {p.name}?</>}
        right={<span className="text-muted">observation · NASA POWER · to {lastDay ? fmtDay(lastDay) : "–"}</span>}
      />
      {ANOMALY_ROWS.map((row) => {
        const values = series[row.key][i] ?? [];
        const norm = series[`${row.key}_norm`][i] ?? [];
        const sd = series[`${row.key}_sd`][i] ?? [];
        let last = values.length - 1;
        while (last > 0 && values[last] == null) last--;
        const z = zScore(values[last] ?? null, norm[last] ?? null, sd[last] ?? null);
        const v = values[last];
        return (
          <div key={row.key} className="mt-1">
            <div className="flex items-baseline justify-between text-[10px]">
              <span className="text-ink-2">{row.label}{row.unit ? <span className="text-muted"> · {row.unit}</span> : null}</span>
              <span className="font-mono text-muted">
                {v != null ? `${v.toFixed(row.digits)} ${row.unit}`.trim() : "–"}
                {z != null && (
                  <span className="ml-1.5" style={{ color: Math.abs(z) > FLAG_Z ? P.critical : P.ink2 }}>{signed(z, 1)}σ</span>
                )}
              </span>
            </div>
            <AnomalySeries days={series.days} values={values} norm={norm} sd={sd} colour={row.colour} unit={row.unit} digits={row.digits} height={80} />
          </div>
        );
      })}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        <span><i className="mr-1 inline-block h-[2.5px] w-4 align-middle" style={{ background: "rgba(255,255,255,0.18)" }} />±1σ around the place&apos;s own 10-year normal for that date</span>
        <span><i className="mr-1 inline-block h-[7px] w-[7px] rounded-full border-[1.5px] align-middle" style={{ borderColor: P.critical }} />|z| {">"} {FLAG_Z}</span>
        <span><i className="mr-1 inline-block h-[10px] w-px align-middle" style={{ background: P.ink, opacity: 0.6 }} />last observed day</span>
      </div>

      {/* ── hazards ───────────────────────────────────────────────────── */}
      <SectionHead
        className="mt-3"
        left={mode === "now" ? <>Which hazard category is {p.name} in today?</> : <>What does it mean for the next 14 days?</>}
        right={<span className="text-muted">risk assessment · valid {fmtDay(risk.valid_from)} → {fmtDay(risk.valid_to)}</span>}
      />
      {/* 2 × 2: at 440 px four in a row clipped the severity / exposure values and their units */}
      <div className="grid grid-cols-2 gap-1.5">
        {HAZARDS.map((h) => (
          <HazardCard key={h} hazard={h} now={now} mode={mode} validFrom={risk.valid_from} validTo={risk.valid_to} selected={h === hazard} onPick={() => onHazard(h)} />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-muted">
        probability, severity, exposure and confidence are shown separately and never multiplied into one number · click a card for its drivers
      </div>

      {/* ── drivers + sentence ────────────────────────────────────────── */}
      <SectionHead
        className="mt-3"
        left={<>Why <span style={{ color: hz }}>{HAZARD_LABEL[hazard]}</span> here?</>}
        right={
          <span className="text-muted">
            {hazard === "wildfire" ? `SHAP · ${risk.model.name} ${risk.model.version}` : "threshold reasons"}
          </span>
        }
      />
      <DriverBars drivers={drivers} colour={hz} />
      {hazard === "wildfire" && drivers.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted">
          <span><i className="mr-1 inline-block h-[6px] w-3 rounded-sm align-middle" style={{ background: P.s2 }} />raises risk</span>
          <span><i className="mr-1 inline-block h-[6px] w-3 rounded-sm align-middle" style={{ background: P.s1 }} />lowers risk</span>
          <span>bar = SHAP contribution · right column = feature value · PR-AUC {risk.model.pr_auc.toFixed(2)} vs baseline {risk.model.baseline_pr_auc.toFixed(2)}</span>
        </div>
      )}
      <p className="mt-2 text-[11.5px] leading-snug text-ink-2" style={{ borderLeft: `2px solid ${hz}`, paddingLeft: 8 }}>
        {sentence || <span className="text-muted">no sentence published for this hazard</span>}
      </p>
    </Card>
  );
}

function SectionHead({ left, right, className = "" }: { left: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-1 flex items-baseline justify-between gap-2 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{left}</span>
      {right && <span className="shrink-0 text-[10px]">{right}</span>}
    </div>
  );
}
