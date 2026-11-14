"use client";
// KPI row (DESIGN.md §5 KPI tile): 10 px uppercase label, 22 px value, 10.5 px
// sub in green when good. Four tiles, 4-column grid at the top of the aside.
import { useMemo } from "react";
import { fmtCount, pct } from "@/lib/format";
import { P } from "@/lib/palette";
import type { Data } from "@/lib/types";

function Tile({ label, value, sub, good, title }: {
  label: string; value: string; sub: string; good?: boolean; title?: string;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-surface px-3 py-3.5" title={title}>
      <div className="whitespace-nowrap text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-[22px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 text-[10.5px] leading-snug" style={{ color: good ? P.good : P.muted }}>{sub}</div>
    </div>
  );
}

export default function Kpis({ data, filter }: { data: Data | null; filter: Set<number> | null }) {
  const k = useMemo(() => {
    if (!data) return null;
    const n = data.places.places.length;
    const idx = filter ? [...filter] : data.places.places.map((_, i) => i);
    const fires = data.fires.bins.reduce((s, b) => s + (b[2] ?? 0), 0);
    const vi = data.trends.variables.indexOf("rain_mm");
    let drying = 0;
    let dryingSig = 0;
    for (const i of idx) {
      const s = data.trends.long.slope[i]?.[vi];
      const p = data.trends.long.p[i]?.[vi];
      if (s != null && s < 0) {
        drying++;
        if (p != null && p < 0.05) dryingSig++;
      }
    }
    let highFire = 0;
    for (const i of idx) {
      const c = data.risk.now[i]?.wildfire.category;
      if (c === "high" || c === "extreme") highFire++;
    }
    const hit = data.honesty.top20_hit_rate;
    const base = data.honesty.baseline_top20_hit_rate;
    return { n, m: idx.length, fires, drying, dryingSig, highFire, hit, base, mode: data.honesty.mode, run: data.run };
  }, [data, filter]);

  if (!k) {
    return (
      <div className="grid grid-cols-4 gap-3">
        {["places on watch", "fires 24 h", "places drying", "top-20 hit rate"].map((l) => (
          <Tile key={l} label={l} value="–" sub="loading…" />
        ))}
      </div>
    );
  }
  const gates = Object.values(k.run.gates);
  const passed = gates.filter((g) => g.pass === true).length;
  const judged = gates.filter((g) => g.pass != null).length;
  return (
    <div className="grid grid-cols-4 gap-3">
      <Tile
        label="places on watch"
        value={fmtCount(k.m)}
        sub={k.m === k.n ? `tier ${k.run.tier} · ${passed}/${judged} gates pass` : `of ${k.n} · tier ${k.run.tier}`}
        good={k.run.ok}
        title="places with a trend and a risk assessment this run"
      />
      <Tile
        label="fires 24 h"
        value={fmtCount(k.fires)}
        sub={`${fmtCount(data!.fires.bins.length)} bins · ${data!.fires.source}`}
        title="FIRMS detections in the last 24 h, global, observation"
      />
      <Tile
        label="places drying"
        value={fmtCount(k.drying)}
        sub={`${k.dryingSig} significant (p<0.05) · 10-yr rain`}
        title="places whose 10-year rainfall Sen's slope is negative"
      />
      <Tile
        label="top-20 hit rate"
        value={pct(k.hit)}
        sub={`baseline ${pct(k.base)} · ${k.mode}`}
        good={k.hit > k.base}
        title="share of the 20 highest wildfire risks that saw ≥3 detections, vs the fire-weather baseline"
      />
    </div>
  );
}
