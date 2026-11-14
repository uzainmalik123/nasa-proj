"use client";
// Dashboard.tsx · the one place app state lives (contracts.md §5): mode,
// hazard, trendVar, selected, continent, flyTo. Layout per DESIGN.md §3: globe
// column flex 1.15 with the title block top-left; 560 px aside that is the only
// thing that scrolls. Globe is S3's; everything in the aside is S4's.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAll } from "@/lib/data";
import { HAZARD_LABEL, VARIABLE_LABEL, ageHours, fmtAge, fmtCount, fmtUtc } from "@/lib/format";
import { P } from "@/lib/palette";
import { HAZARDS, VARIABLES, type Data, type Hazard, type Mode, type Variable } from "@/lib/types";
import type { FlyTarget, GibsLayerKey } from "./globe/Globe";
import { GIBS_LAYERS } from "./globe/Globe";
import Freshness, { useNow } from "./panels/Freshness";
import HazardsTable from "./panels/HazardsTable";
import Kpis from "./panels/Kpis";
import PlacePanel from "./panels/PlacePanel";
import Sources from "./panels/Sources";
import TrendsTable from "./panels/TrendsTable";

const Globe = dynamic(() => import("./globe/Globe"), { ssr: false });

export interface AppState {
  mode: Mode;
  hazard: Hazard;
  trendVar: Variable;
  selected: number | null;
  continent: string | null; // null = world
  flyTo: FlyTarget | null;
  gibsLayer: GibsLayerKey | null;
  gibsDate: string | null;
}

/** ?mode=now|next14&hazard=…&var=…&continent=…&selected=…&gibs=…&date=YYYY-MM-DD (M7 makes this two-way). */
function initialState(): AppState {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const hazard = (HAZARDS as string[]).includes(q.get("hazard") ?? "") ? (q.get("hazard") as Hazard) : "wildfire";
  const trendVar = (VARIABLES as string[]).includes(q.get("var") ?? "") ? (q.get("var") as Variable) : "rain_mm";
  const gibs = q.get("gibs");
  const sel = q.get("selected");
  return {
    mode: q.get("mode") === "now" ? "now" : "next14",
    hazard,
    trendVar,
    selected: sel != null && sel !== "" && Number.isFinite(Number(sel)) ? Number(sel) : null,
    continent: q.get("continent") || null,
    flyTo: null,
    gibsLayer: gibs && gibs in GIBS_LAYERS ? (gibs as GibsLayerKey) : null,
    gibsDate: q.get("date"),
  };
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<AppState>(initialState);
  const now = useNow();

  useEffect(() => {
    loadAll().then(setData, (e: unknown) => setError(String(e)));
  }, []);

  const places = useMemo(() => data?.places.places ?? [], [data]);
  const continents = useMemo(
    () => [...new Set(places.map((p) => p.continent))].sort(),
    [places],
  );
  const filter = useMemo<Set<number> | null>(() => {
    if (!s.continent) return null;
    const set = new Set<number>();
    places.forEach((p, i) => { if (p.continent === s.continent) set.add(i); });
    return set;
  }, [places, s.continent]);

  /** Select a place; `fly` moves the globe (explicit picks only, DESIGN §7). */
  const select = useCallback((i: number | null, fly = false) => {
    setS((prev) => ({
      ...prev,
      selected: i,
      flyTo: fly && i != null && places[i] ? { lon: places[i].lon, lat: places[i].lat } : prev.flyTo,
    }));
  }, [places]);

  // Escape clears the selection (DESIGN §8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const age = ageHours(data?.run.finished ?? data?.run.started, now);
  const live = age != null && age <= 6;
  const pillColour = data ? (live ? P.good : P.warning) : P.muted;

  const trendsTable = (
    <TrendsTable
      places={places}
      trends={data?.trends ?? null}
      variable={s.trendVar}
      selected={s.selected}
      filter={filter}
      onPick={(i) => select(i, true)}
    />
  );
  const hazardsTable = (
    <HazardsTable
      places={places}
      risk={data?.risk ?? null}
      hazard={s.hazard}
      selected={s.selected}
      filter={filter}
      onPick={(i) => select(i, true)}
    />
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-page text-ink">
      <section className="relative min-w-0" style={{ flex: 1.15 }}>
        <Globe
          places={places}
          risk={data?.risk ?? null}
          trends={data?.trends ?? null}
          fires={data?.fires ?? null}
          mode={s.mode}
          hazard={s.hazard}
          trendVar={s.trendVar}
          selected={s.selected}
          onSelect={(i) => select(i)}
          flyTo={s.flyTo}
          gibsLayer={s.gibsLayer}
          gibsDate={s.gibsDate}
        />

        {/* title block, DESIGN §3 */}
        <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
          <div className="pointer-events-none">
            <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              Earth System Trend Detective
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-2">
              {data
                ? `${fmtCount(places.length)} places on watch · trends and 14-day hazard risk from NASA FIRMS, POWER and GIBS · forecast by Open-Meteo`
                : error ? `could not load data: ${error}` : "loading…"}
            </div>
            <div
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
              style={{ borderColor: pillColour, color: pillColour, background: `${pillColour}1f` }}
              title={data ? `run ${data.run.run_id} · finished ${fmtUtc(data.run.finished, true)}` : undefined}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: pillColour }} />
              {data ? `${live ? "live" : "stale"} · updated ${fmtAge(age)}` : "connecting"}
            </div>
          </div>

          {/* controls, PRD §5: mode · hazard · trend variable · continent (search is S3-B) */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur">
            <Toggle
              value={s.mode}
              options={[["now", "Now"], ["next14", "Next 14 days"]]}
              onChange={(mode) => setS((p) => ({ ...p, mode }))}
            />
            <Select
              label="hazard"
              value={s.hazard}
              options={HAZARDS.map((h) => [h, HAZARD_LABEL[h]])}
              onChange={(hazard) => setS((p) => ({ ...p, hazard, mode: "next14" }))}
            />
            <Select
              label="trend"
              value={s.trendVar}
              options={VARIABLES.map((v) => [v, VARIABLE_LABEL[v]])}
              onChange={(trendVar) => setS((p) => ({ ...p, trendVar, mode: "now" }))}
            />
            <Select
              label="region"
              value={s.continent ?? "world"}
              options={[["world", "world"], ...continents.map((c): [string, string] => [c, c])]}
              onChange={(v) => setS((p) => ({ ...p, continent: v === "world" ? null : v }))}
            />
            <Select
              label="imagery"
              value={s.gibsLayer ?? "none"}
              options={[["none", "none"], ...(Object.keys(GIBS_LAYERS) as GibsLayerKey[]).map((k): [string, string] => [k, GIBS_LAYERS[k].label])]}
              onChange={(v) => setS((p) => ({ ...p, gibsLayer: v === "none" ? null : (v as GibsLayerKey) }))}
            />
          </div>
        </div>
      </section>

      <aside className="sidebar-scroll flex w-[560px] shrink-0 flex-col gap-3 border-l border-border p-3">
        <Kpis data={data} filter={filter} />
        {s.mode === "now" ? (<>{trendsTable}{hazardsTable}</>) : (<>{hazardsTable}{trendsTable}</>)}
        <PlacePanel data={data} selected={s.selected} trendVar={s.trendVar} onClear={() => select(null)} />
        <Freshness freshness={data?.freshness ?? null} run={data?.run ?? null} />
        <Sources freshness={data?.freshness ?? null} trends={data?.trends ?? null} risk={data?.risk ?? null} />
        <footer className="px-1 pb-1 text-[10px] leading-snug text-muted">
          Observation (NASA POWER, FIRMS, GIBS), forecast (Open-Meteo), trend (Mann-Kendall) and risk assessment (our
          hazard modules) are four different things and are labelled as such. Informational tool, not an official
          warning service. Follow local authorities.
        </footer>
      </aside>
    </div>
  );
}

function Toggle<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-white/15" role="radiogroup" aria-label="mode">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`px-2 py-1 text-[10px] uppercase tracking-wide transition ${
            v === value ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded border border-white/15 bg-surface-2 px-1 py-0.5 text-[11px] normal-case tracking-normal text-ink"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
