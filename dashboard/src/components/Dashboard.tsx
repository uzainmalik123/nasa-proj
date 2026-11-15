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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FILE_COUNT, PROBE_MS, loadData, probeAndRefresh, type DataSource, type LoadHandlers, type ProbeState } from "@/lib/data";
import { HAZARD_LABEL, VARIABLE_LABEL, ageHours, fmtAge, fmtCount, fmtUtc } from "@/lib/format";
import { P } from "@/lib/palette";
import { HAZARDS, VARIABLES, type Data, type Hazard, type Mode, type Variable } from "@/lib/types";
import type { FlyTarget, GibsLayerKey } from "./globe/Globe";
import type { Place } from "@/lib/types";
import { GIBS_LAYERS } from "./globe/Globe";
import { GIBS_TOGGLE_KEYS } from "./globe/gibs";
import Continents from "./panels/Continents";
import Feed from "./panels/Feed";
import Search from "./globe/Search";
import Freshness, { useNow } from "./panels/Freshness";
import Honesty from "./panels/Honesty";
import HazardsTable from "./panels/HazardsTable";
import Kpis from "./panels/Kpis";
import Movers from "./panels/Movers";
import PlacePanel from "./panels/PlacePanel";
import ErrorBoundary from "./panels/ErrorBoundary";
import { BrandBlock, SAFETY, SafetyFooter } from "./Shell";
import Sources from "./panels/Sources";
import TrendsTable from "./panels/TrendsTable";

const Globe = dynamic(() => import("./globe/Globe"), { ssr: false });

/** KI-18 interim: below `lg` one of the two halves shows at a time, switched from a bottom bar. */
type MobileView = "globe" | "panels";
/** `?view=panels` opens the phone layout on the panels (initial state only; not written back). */
function readView(): MobileView {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "panels" ? "panels" : "globe";
}

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

/** ?region=pk opens on the dense Pakistan tier (PRD M9): the globe flies to the region's centre and zoom. */
const REGIONS: Record<string, FlyTarget> = { pk: { lon: 69.35, lat: 30.4, zoom: 4.5 } };

const DEFAULT_MODE: Mode = "next14";
const DEFAULT_HAZARD: Hazard = "wildfire";
const DEFAULT_TREND: Variable = "rain_mm";

/**
 * URL → state (PRD M7). `?place=<id>&hazard=&mode=now|next14&trend=<variable>`
 * plus `globe=trend` (lens), `continent=`, `gibs=` and `date=YYYY-MM-DD`, and
 * `region=pk` (M9, a one-off fly-to; not written back by writeUrl).
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
    flyTo: REGIONS[q.get("region") ?? ""] ?? null,
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
  // KI-7 step 1c: where the data on screen came from and what the run probe is doing (view state, for the pill)
  const [source, setSource] = useState<DataSource | null>(null);
  const [probe, setProbe] = useState<ProbeState>("checking");
  const [s, setS] = useState<AppState>(readUrl);
  const [view, setView] = useState<MobileView>(readView);
  const [tab, setTab] = useState<Tab>("risk");
  const now = useNow();
  const dataRef = useRef<Data | null>(null);

  useEffect(() => {
    const handlers: LoadHandlers = {
      onProgress: (done, total) => setProgress([done, total]),
      onData: (d, src) => {
        const prevPlaces = dataRef.current?.places.places;
        dataRef.current = d;
        setSource(src);
        setData(d);
        setS((prev) => {
          // a newer run may list places in another order: carry the selection over by id, drop it if gone
          if (prevPlaces && prev.selected != null) {
            const id = prevPlaces[prev.selected]?.id;
            const i = d.places.places.findIndex((p) => p.id === id);
            return { ...prev, selected: i >= 0 ? i : null };
          }
          // ?place=<id> from the URL: resolve now that places.json is in, and land on it (a shared link is an explicit pick).
          return resolvePendingPlace(prev, d.places.places);
        });
      },
      onProbe: setProbe,
    };
    loadData(handlers).catch((e: unknown) => setError(String(e)));
    // An open tab re-probes every PROBE_MS while visible (one ~1 KB request), and when it comes back after that long.
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      probeAndRefresh(dataRef.current?.run.run_id ?? null, handlers, dataRef.current != null).catch(() => setProbe("offline"));
    };
    const timer = setInterval(tick, PROBE_MS);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last >= PROBE_MS) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // MapLibre listens to window resize; nudge it after a switch so the map refits its box.
  useEffect(() => {
    if (view === "globe") window.dispatchEvent(new Event("resize"));
  }, [view]);

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
    if (fly && i != null) setView("globe");
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
    setView("globe");
  }, [places]);

  // Escape clears the selection (DESIGN §8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // nothing arrived and the loader gave up: one error card replaces the panels (DESIGN error state)
  const failed = error != null && data == null;
  const age = ageHours(data?.run.finished ?? data?.run.started, now);
  const live = age != null && age <= 6;
  const pillColour = data ? (live && probe !== "offline" ? P.good : P.warning) : error ? P.critical : P.muted;
  const pillNote = probe === "checking" ? " · checking for a newer run" : probe === "offline" ? " · offline, showing the cached run" : "";

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
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-page text-ink">
      {/* top bar (layout spec §5.1), desktop only; phones keep the overlay title block */}
      <header className="relative z-30 hidden h-14 shrink-0 items-center gap-5 border-b border-border bg-page px-4 lg:flex">
        <BrandBlock />
        <div className="topbar-controls flex min-w-0 flex-1 flex-nowrap items-center gap-2">
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
                width="w-[118px]"
              />
            <Select
              label="imagery"
              value={s.gibsLayer ?? "none"}
              options={[["none", "none"], ...GIBS_TOGGLE_KEYS.map((k): [string, string] => [k, GIBS_LAYERS[k].short])]}
              onChange={(v) => setS((p) => ({ ...p, gibsLayer: v === "none" ? null : (v as GibsLayerKey) }))}
              title="NASA GIBS satellite imagery under the points; pick a date on the bar that appears on the globe"
            />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.06em]"
            style={{ borderColor: `${pillColour}80`, color: pillColour, background: `${pillColour}14` }}
            title={data ? `run ${data.run.run_id} · finished ${fmtUtc(data.run.finished, true)} · from ${source === "cache" ? "the browser cache" : "the network"}` : undefined}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: pillColour }} />
            {data ? (<>{live ? "live" : "stale"}<span className="hidden 2xl:inline"> · updated {fmtAge(age)}{pillNote}</span></>) : error ? "could not load data" : `loading ${progress[0]} of ${progress[1]} files`}
          </div>
          <span className="hidden 2xl:inline"><UtcClock now={now} /></span>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
      {/* below lg the section fills the screen and goes invisible (never unmounted) on Panels */}
      <section
        className={`absolute inset-0 min-w-0 lg:relative lg:inset-auto lg:visible ${view === "panels" ? "invisible" : ""}`}
        style={{ flex: 1.15 }}
      >
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
        <div className="absolute inset-x-2 top-2 z-10 flex flex-col gap-1.5 lg:hidden">
          {/* phone header: one glass bar, brand left, live state right (the context sentence lives in Sources) */}
          <div className="flex h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-black/65 px-3 backdrop-blur">
            <span className="brand-mark !h-4 !w-4" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-none tracking-[-0.01em] text-ink">
              Earth System Trend Detective
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ borderColor: `${pillColour}80`, color: pillColour, background: `${pillColour}14` }}
              title={data ? `run ${data.run.run_id} · updated ${fmtAge(age)}` : undefined}
              aria-live="polite"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: pillColour }} />
              {data ? (live ? "live" : "stale") : error ? "error" : `${progress[0]}/${progress[1]}`}
            </span>
          </div>

          {/* controls, PRD §5: search (S3-B) · mode · hazard · trend variable · continent; imagery toggles + slider sit on the globe (M-GIBS) */}
          <div className="mobile-controls flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto rounded-xl border border-white/10 bg-black/65 px-2.5 py-1.5 backdrop-blur">
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

        {/* place panel (layout spec §5.3): the selected place's full panel floats over the globe,
            top-right on desktop, a bottom sheet below lg; only while a place is selected */}
        {s.selected != null && (
          <div
            className="place-float absolute inset-x-2 bottom-20 z-30 max-h-[58vh] overflow-y-auto rounded-[16px] shadow-[0_12px_40px_rgba(0,0,0,0.55)] lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-4 lg:max-h-[calc(100%-13.5rem)] lg:w-[480px]"
            role="dialog"
            aria-label="selected place"
          >
            <ErrorBoundary key={s.selected}>
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
            </ErrorBoundary>
          </div>
        )}
      </section>

      <aside
        className={`absolute inset-0 z-20 w-full flex-col bg-page pb-20 lg:static lg:z-auto lg:order-first lg:flex lg:w-[552px] lg:shrink-0 lg:border-r lg:border-border lg:pb-0 ${
          view === "panels" ? "flex" : "hidden"
        }`}
      >
        <nav role="tablist" aria-label="sections" className="grid shrink-0 grid-cols-5 border-b border-border px-2 pt-2">
          {TABS.map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`tab-btn group relative flex flex-col items-center gap-1.5 rounded-t-lg px-1 pb-2.5 pt-2 text-[10.5px] transition-colors ${
                tab === key ? "text-ink" : "text-muted hover:text-ink-2"
              }`}
            >
              <TabIcon name={icon} active={tab === key} />
              {label}
              <span className={`absolute inset-x-4 -bottom-px h-0.5 rounded-full transition-colors ${tab === key ? "bg-accent" : "bg-transparent"}`} />
            </button>
          ))}
        </nav>
        <div key={tab} className="sidebar-scroll tab-pane flex min-h-0 flex-1 flex-col gap-3 p-3">
          {failed && <LoadError error={error!} />}
          {!failed && tab === "risk" && (<>
            <Kpis data={data} filter={filter} />
            {hazardsTable}
            <Movers
              places={places}
              risk={data?.risk ?? null}
              hazard={s.hazard}
              selected={s.selected}
              filter={filter}
              continent={s.continent}
              onPick={(i) => select(i, true)}
            />
          </>)}
          {!failed && tab === "trends" && trendsTable}
          {!failed && tab === "alerts" && (
            <Feed feed={data?.feed ?? null} places={places} selected={s.selected} hazard={s.hazard} filter={filter} onPick={pickAlert} />
          )}
          {!failed && tab === "regions" && (
            <Continents
              places={places}
              risk={data?.risk ?? null}
              hazard={s.hazard}
              continent={s.continent}
              onPick={(continent) => setS((p) => ({ ...p, continent }))}
            />
          )}
          {!failed && tab === "sources" && (<>
            <p className="px-1 text-[11.5px] leading-snug text-ink-2">
              {data ? `${fmtCount(places.length)} places on watch. ` : ""}Trends and 14-day hazard risk from NASA FIRMS, POWER and GIBS, forecast by Open-Meteo. Click a place on the globe, a row or an alert to open its full story.
            </p>
            <Freshness freshness={data?.freshness ?? null} run={data?.run ?? null} />
            <Sources freshness={data?.freshness ?? null} trends={data?.trends ?? null} risk={data?.risk ?? null} />
            <Honesty honesty={data?.honesty ?? null} />
            <p className="px-1 text-[10px] leading-snug text-muted">
              Observation (NASA POWER, FIRMS, GIBS), forecast (Open-Meteo), trend (Mann-Kendall) and risk assessment (our
              hazard modules) are four different things and are labelled as such.
            </p>
          </>)}
          {/* phones have no footer bar: the safety statement ends every tab (PRD §7.4) */}
          <p className="px-1 pb-1 text-[10px] leading-snug text-ink-2 lg:hidden">{SAFETY}</p>
        </div>
      </aside>
      </div>
      <SafetyFooter />

      {/* KI-18 interim: phone view switch, bottom-centre over everything; gone at lg */}
      <div
        role="tablist"
        aria-label="view"
        className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-black/60 p-1 backdrop-blur lg:hidden"
      >
        {(["globe", "panels"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`h-11 min-w-24 rounded-full px-5 text-[13px] font-medium capitalize transition ${
              view === v ? "bg-white/15 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Error state (DESIGN §2 tokens): a card in the left column naming what failed, with a retry. */
function LoadError({ error }: { error: string }) {
  return (
    <section role="alert" className="rounded-[14px] border bg-surface px-4 py-3.5" style={{ borderColor: `${P.critical}66` }}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: P.critical }}>Could not load the data</h2>
      <p className="text-[11.5px] leading-snug text-ink-2">
        The dashboard reads nine JSON files from the pipeline&apos;s data branch and at least one did not arrive. Nothing on screen is
        a guess: panels stay empty until the data is in.
      </p>
      <p className="mt-2 break-all font-mono text-[10px] text-muted">{error}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-3 rounded border border-white/15 bg-surface-2 px-2.5 py-1 text-[11px] text-ink transition hover:border-white/30"
      >
        Retry
      </button>
    </section>
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
function Select<T extends string>({ label, value, options, onChange, active, title, width }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void; active?: boolean; title?: string;
  /** fixed width class, for a select whose options arrive with the data (no jump on load) */
  width?: string;
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
        className={`rounded border border-white/15 bg-surface-2 px-1 py-0.5 text-[11px] normal-case tracking-normal text-ink ${width ?? ""}`}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}


type Tab = "risk" | "trends" | "alerts" | "regions" | "sources";
const TABS: [Tab, string, IconName][] = [
  ["risk", "Risk", "flame"],
  ["trends", "Trends", "trend"],
  ["alerts", "Alerts", "bell"],
  ["regions", "Regions", "globe"],
  ["sources", "Sources", "data"],
];

type IconName = "flame" | "trend" | "bell" | "globe" | "data";
const ICON_PATHS: Record<IconName, string[]> = {
  flame: ["M12 3c.5 3.5 4.5 5.2 4.5 9.6A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.4C7.5 10 9.6 8.6 10 6.2c1.2 1 1.6 2.4 1.6 3.6C13 8.6 12.8 5.6 12 3Z", "M10.2 14.6a1.9 1.9 0 0 0 3.6 0"],
  trend: ["M4 17l5.2-5.2 3.4 3.4L20 7.8", "M15 7.8h5v5"],
  bell: ["M6.5 15.5V11a5.5 5.5 0 0 1 11 0v4.5l1.5 2H5l1.5-2Z", "M10 20a2.2 2.2 0 0 0 4 0"],
  globe: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z", "M3.5 12h17", "M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5Z"],
  data: ["M5 6.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5-7-1.1-7-2.5Z", "M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11", "M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"],
};

function TabIcon({ name, active }: { name: IconName; active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden
      stroke={active ? P.ink : "currentColor"} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      style={active ? { filter: "drop-shadow(0 0 6px rgba(234,88,12,0.55))" } : undefined}>
      {ICON_PATHS[name].map((d) => <path key={d} d={d} stroke={active && d === ICON_PATHS[name][0] ? P.s2 : undefined} />)}
    </svg>
  );
}

function UtcClock({ now }: { now: number | Date }) {
  const d = new Date(now);
  const t = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  return <time className="font-mono text-[11px] tabular-nums text-ink-2" dateTime={d.toISOString()}>{t}</time>;
}
