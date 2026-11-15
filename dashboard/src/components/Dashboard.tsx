"use client";
// Dashboard.tsx · the one place app state lives (contracts.md §5): mode,
// hazard, trendVar, selected, continent, flyTo (+ lens and the GIBS pair).
// Layout per DESIGN.md §3: globe column flex 1.15 with the title block
// top-left; 560 px aside that is the only thing that scrolls. Globe is S3's;
// everything in the aside is S4's.
//
// M-MODE+URL (PRD M5 + M7): `mode` runs through the whole screen. "now" =
// the category each place is in today (globe colour, hazards-table headline,
// hazard-card headline), "next14" = the forecast probability for the next 14
// days. `lens` says what colours the globe: the hazard (default) or the
// chosen trend variable. The URL mirrors the state (readUrl / writeUrl) with
// replaceState, so any view is a shareable link.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FILE_COUNT, loadAll } from "@/lib/data";
import { HAZARD_LABEL, VARIABLE_LABEL, ageHours, fmtAge, fmtCount, fmtUtc } from "@/lib/format";
import { P } from "@/lib/palette";
import { HAZARDS, VARIABLES, type Data, type Hazard, type Mode, type Variable } from "@/lib/types";
import type { FlyTarget, GibsLayerKey } from "./globe/Globe";
import type { Place } from "@/lib/types";
import { GIBS_LAYERS } from "./globe/Globe";
import Continents from "./panels/Continents";
import Feed from "./panels/Feed";
import Search from "./globe/Search";
import Freshness, { useNow } from "./panels/Freshness";
import Honesty from "./panels/Honesty";
import HazardsTable from "./panels/HazardsTable";
import Kpis from "./panels/Kpis";
import Movers from "./panels/Movers";
import PlacePanel from "./panels/PlacePanel";
import Sources from "./panels/Sources";
import TrendsTable from "./panels/TrendsTable";

const Globe = dynamic(() => import("./globe/Globe"), { ssr: false });

/** What colours the globe: the selected hazard (default) or the selected trend variable. */
export type Lens = "hazard" | "trend";

export interface AppState {
  mode: Mode;
  hazard: Hazard;
  trendVar: Variable;
  lens: Lens;
  selected: number | null;
  /** place id from the URL, resolved to `selected` once places.json is in */
  pendingPlace: string | null;
  continent: string | null; // null = world
  flyTo: FlyTarget | null;
  gibsLayer: GibsLayerKey | null;
  gibsDate: string | null;
}

const DEFAULT_MODE: Mode = "next14";
const DEFAULT_HAZARD: Hazard = "wildfire";
const DEFAULT_TREND: Variable = "rain_mm";

/**
 * URL → state (PRD M7). `?place=<id>&hazard=&mode=now|next14&trend=<variable>`
 * plus `globe=trend` (lens), `continent=`, `gibs=` and `date=YYYY-MM-DD`.
 * Legacy day-1 params still parse: `var=` (implies `globe=trend`) and
 * `selected=<index>`.
 */
function readUrl(): AppState {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const pick = <T extends string>(key: string, all: readonly T[], fallback: T): T =>
    (all as readonly string[]).includes(q.get(key) ?? "") ? (q.get(key) as T) : fallback;
  const hazard = pick("hazard", HAZARDS, DEFAULT_HAZARD);
  const trendVar = pick("trend", VARIABLES, pick("var", VARIABLES, DEFAULT_TREND));
  const globe = q.get("globe");
  const lens: Lens = globe === "trend" || globe === "hazard" ? globe : q.has("var") ? "trend" : "hazard";
  const gibs = q.get("gibs");
  const sel = q.get("selected");
  return {
    mode: q.get("mode") === "now" ? "now" : DEFAULT_MODE,
    hazard,
    trendVar,
    lens,
    selected: sel != null && sel !== "" && Number.isFinite(Number(sel)) ? Number(sel) : null,
    pendingPlace: q.get("place") || null,
    continent: q.get("continent") || null,
    flyTo: null,
    gibsLayer: gibs && gibs in GIBS_LAYERS ? (gibs as GibsLayerKey) : null,
    gibsDate: q.get("date"),
  };
}

/** State → URL, defaults omitted so the bare URL stays bare. replaceState: no history spam. */
function writeUrl(s: AppState, places: Place[]) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams();
  if (s.mode !== DEFAULT_MODE) q.set("mode", s.mode);
  if (s.hazard !== DEFAULT_HAZARD) q.set("hazard", s.hazard);
  if (s.trendVar !== DEFAULT_TREND) q.set("trend", s.trendVar);
  if (s.lens === "trend") q.set("globe", "trend");
  const place = s.selected != null ? places[s.selected]?.id ?? null : s.pendingPlace;
  if (place) q.set("place", place);
  if (s.continent) q.set("continent", s.continent);
  if (s.gibsLayer) {
    q.set("gibs", s.gibsLayer);
    if (s.gibsDate) q.set("date", s.gibsDate);
  }
  const qs = q.toString();
  const { pathname, search, hash } = window.location;
  const next = `${pathname}${qs ? `?${qs}` : ""}${hash}`;
  if (next !== `${pathname}${search}${hash}`) window.history.replaceState(null, "", next);
}

/** Turn a `?place=<id>` into a selection + fly once the place list exists; an unknown id is dropped. */
function resolvePendingPlace(prev: AppState, places: Place[]): AppState {
  if (!prev.pendingPlace) return prev;
  const i = places.findIndex((p) => p.id === prev.pendingPlace);
  return {
    ...prev,
    pendingPlace: null,
    selected: i >= 0 ? i : prev.selected,
    flyTo: i >= 0 ? { lon: places[i].lon, lat: places[i].lat } : prev.flyTo,
  };
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, FILE_COUNT]);
  const [s, setS] = useState<AppState>(readUrl);
  const now = useNow();

  useEffect(() => {
    loadAll((done, total) => setProgress([done, total])).then((d) => {
      setData(d);
      // ?place=<id> from the URL: resolve now that places.json is in, and land on it (a shared link is an explicit pick).
      setS((prev) => resolvePendingPlace(prev, d.places.places));
    }, (e: unknown) => setError(String(e)));
  }, []);

  const places = useMemo(() => data?.places.places ?? [], [data]);
  const continents = useMemo(
    () => [...new Set(places.map((p) => p.continent))].sort(),
    [places],
  );
  // state → URL on every change (PRD M7)
  useEffect(() => {
    writeUrl(s, places);
  }, [s, places]);

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

  /** An alert picks its place and its hazard (14-day risk, so mode next14), and flies the globe (DESIGN §4). */
  const pickAlert = useCallback((i: number, hazard: Hazard) => {
    setS((prev) => ({
      ...prev,
      hazard,
      lens: "hazard",
      mode: "next14",
      selected: i,
      flyTo: places[i] ? { lon: places[i].lon, lat: places[i].lat } : prev.flyTo,
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
      mode={s.mode}
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
          trendVar={s.lens === "trend" ? s.trendVar : null}
          selected={s.selected}
          onSelect={(i) => select(i)}
          flyTo={s.flyTo}
          gibsLayer={s.gibsLayer}
          gibsDate={s.gibsDate}
          onGibsChange={(gibsLayer, gibsDate) => setS((p) => ({ ...p, gibsLayer, gibsDate }))}
          continent={s.continent}
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
              {data
                ? `${live ? "live" : "stale"} · updated ${fmtAge(age)}`
                : error ? "failed" : `loading ${progress[0]} of ${progress[1]} files`}
            </div>
          </div>

          {/* controls, PRD §5: search (S3-B) · mode · hazard · trend variable · continent; imagery toggles + slider sit on the globe (M-GIBS) */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-2.5 py-1.5 backdrop-blur">
            <Search places={places} onPick={(i) => select(i, true)} />
            <Toggle
              label="mode"
              value={s.mode}
              options={[
                ["now", "Now", "the category each place is in today"],
                ["next14", "Next 14 days", "calibrated probability for the next 14 days"],
              ]}
              onChange={(mode) => setS((p) => ({ ...p, mode }))}
            />
            <Select
              label="hazard"
              value={s.hazard}
              options={HAZARDS.map((h) => [h, HAZARD_LABEL[h]])}
              onChange={(hazard) => setS((p) => ({ ...p, hazard, lens: "hazard" }))}
              active={s.lens === "hazard"}
              title="colours the globe"
            />
            <Select
              label="trend"
              value={s.trendVar}
              options={VARIABLES.map((v) => [v, VARIABLE_LABEL[v]])}
              onChange={(trendVar) => setS((p) => ({ ...p, trendVar, lens: "trend" }))}
              active={s.lens === "trend"}
              title="pick a variable to colour the globe by its 10-year trend"
            />
            <Select
              label="region"
              value={s.continent ?? "world"}
              options={[["world", "world"], ...continents.map((c): [string, string] => [c, c])]}
              onChange={(v) => setS((p) => ({ ...p, continent: v === "world" ? null : v }))}
            />
          </div>
        </div>
      </section>

      <aside className="sidebar-scroll flex w-[560px] shrink-0 flex-col gap-3 border-l border-border p-3">
        <Kpis data={data} filter={filter} />
        {s.mode === "now" ? (<>{trendsTable}{hazardsTable}</>) : (<>{hazardsTable}{trendsTable}</>)}
        <PlacePanel
          data={data}
          selected={s.selected}
          trendVar={s.trendVar}
          hazard={s.hazard}
          mode={s.mode}
          onTrendVar={(trendVar) => setS((p) => ({ ...p, trendVar, lens: "trend" }))}
          onHazard={(hazard) => setS((p) => ({ ...p, hazard, lens: "hazard" }))}
          onClear={() => select(null)}
        />
        <Movers
          places={places}
          risk={data?.risk ?? null}
          hazard={s.hazard}
          selected={s.selected}
          filter={filter}
          continent={s.continent}
          onPick={(i) => select(i, true)}
        />
        <Continents
          places={places}
          risk={data?.risk ?? null}
          hazard={s.hazard}
          continent={s.continent}
          onPick={(continent) => setS((p) => ({ ...p, continent }))}
        />
        <Feed feed={data?.feed ?? null} places={places} selected={s.selected} hazard={s.hazard} filter={filter} onPick={pickAlert} />
        <Honesty honesty={data?.honesty ?? null} />
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

function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string, string?][]; onChange: (v: T) => void;
}) {
  return (
    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
      {label}
      <span className="flex overflow-hidden rounded border border-white/15" role="radiogroup" aria-label={label}>
        {options.map(([v, text, title]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === value}
            title={title}
            onClick={() => onChange(v)}
            className={`px-2 py-1 text-[10px] uppercase tracking-wide transition ${
              v === value ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {text}
          </button>
        ))}
      </span>
    </span>
  );
}

/** `active` marks the select that currently colours the globe (an accent dot before the label). */
function Select<T extends string>({ label, value, options, onChange, active, title }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void; active?: boolean; title?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted" title={title}>
      {active != null && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full transition ${active ? "bg-accent" : "border border-muted"}`}
          aria-label={active ? "colours the globe" : undefined}
        />
      )}
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
