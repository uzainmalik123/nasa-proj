"use client";
// TEMPORARY shell from S3 so the globe renders against the mocks.
// S4 owns the real Dashboard.tsx (contracts.md §5); replace this file wholesale
// and keep only the <Globe …/> usage below.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { loadAll } from "@/lib/data";
import { HAZARDS, VARIABLES, type Data, type Hazard, type Mode, type Variable } from "@/lib/types";
import type { FlyTarget, GibsLayerKey } from "./globe/Globe";
import { GIBS_LAYERS } from "./globe/Globe";

const Globe = dynamic(() => import("./globe/Globe"), { ssr: false });

interface State {
  mode: Mode;
  hazard: Hazard;
  trendVar: Variable;
  selected: number | null;
  flyTo: FlyTarget | null;
  gibsLayer: GibsLayerKey | null;
  gibsDate: string | null;
}

/** ?mode=now|next14&hazard=…&var=…&gibs=…&date=YYYY-MM-DD (dev convenience, M7 later). */
function initialState(): State {
  const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const mode = q.get("mode") === "now" ? "now" : "next14";
  const hazard = (HAZARDS as string[]).includes(q.get("hazard") ?? "") ? (q.get("hazard") as Hazard) : "wildfire";
  const trendVar = (VARIABLES as string[]).includes(q.get("var") ?? "") ? (q.get("var") as Variable) : "rain_mm";
  const gibs = q.get("gibs");
  const gibsLayer = gibs && gibs in GIBS_LAYERS ? (gibs as GibsLayerKey) : null;
  const sel = q.get("selected");
  return {
    mode, hazard, trendVar,
    selected: sel != null && sel !== "" ? Number(sel) : null,
    flyTo: null,
    gibsLayer,
    gibsDate: q.get("date"),
  };
}

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<State>(initialState);

  useEffect(() => {
    loadAll().then(setData, (e: unknown) => setError(String(e)));
  }, []);

  const places = data?.places.places ?? [];
  const select = (i: number | null, fly = false) =>
    setS((prev) => ({
      ...prev,
      selected: i,
      flyTo: fly && i != null && places[i] ? { lon: places[i].lon, lat: places[i].lat } : prev.flyTo,
    }));

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
        <div className="pointer-events-none absolute left-4 top-4 z-10">
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            Earth System Trend Detective
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-2">
            {data
              ? `${places.length} places · run ${data.run.run_id} · ${data.fires.bins.length} fire bins`
              : error ?? "loading…"}
          </div>
        </div>
      </section>

      <aside className="sidebar-scroll flex w-[560px] shrink-0 flex-col gap-3 border-l border-border p-3">
        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            globe controls (S3 shell · S4 replaces)
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Toggle
              value={s.mode}
              options={[["now", "Now · trend"], ["next14", "Next 14 days · hazard"]]}
              onChange={(mode) => setS((p) => ({ ...p, mode }))}
            />
            <Select
              label="hazard"
              value={s.hazard}
              options={HAZARDS}
              onChange={(hazard) => setS((p) => ({ ...p, hazard }))}
            />
            <Select
              label="trend"
              value={s.trendVar}
              options={VARIABLES}
              onChange={(trendVar) => setS((p) => ({ ...p, trendVar }))}
            />
            <Select
              label="gibs"
              value={s.gibsLayer ?? "none"}
              options={["none", ...(Object.keys(GIBS_LAYERS) as GibsLayerKey[])]}
              onChange={(v) => setS((p) => ({ ...p, gibsLayer: v === "none" ? null : (v as GibsLayerKey) }))}
            />
          </div>
        </div>

        <div className="rounded-[14px] border border-border bg-surface px-4 py-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            places · click = select + fly
          </div>
          <div className="flex flex-col">
            {places.map((p, i) => (
              <button
                key={p.id}
                onClick={() => select(i, true)}
                className={`flex h-7 items-center justify-between border-b border-border px-1 text-left text-[11px] hover:bg-white/[0.04] ${
                  s.selected === i ? "bg-white/[0.06]" : ""
                }`}
              >
                <span>
                  {p.name} <span className="text-muted">{p.country}</span>
                </span>
                <span className="font-mono text-ink-2">
                  {s.mode === "next14"
                    ? data?.risk.now[i]?.[s.hazard].category
                    : data?.trends.long.label[i]?.[VARIABLES.indexOf(s.trendVar)]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-muted">
          Informational tool, not an official warning service. Follow local authorities.
        </div>
      </aside>
    </div>
  );
}

function Toggle<T extends string>({
  value, options, onChange,
}: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex overflow-hidden rounded border border-white/15">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2 py-1 text-[10px] uppercase tracking-wide ${
            v === value ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Select<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded border border-white/15 bg-surface-2 px-1 py-0.5 text-[11px] normal-case tracking-normal text-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
