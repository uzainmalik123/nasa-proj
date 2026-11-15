"use client";
// Freshness panel (DESIGN.md §5 catalogue): source, last fetch (relative),
// records, status dot green/amber/red by age. PRD §11: FIRMS within 6 h,
// everything else within 24 h at demo time.
import { useEffect, useState } from "react";
import { ageHours, fmtAge, fmtCount, fmtUtc } from "@/lib/format";
import type { FreshnessFile, RunFile, SourceRow } from "@/lib/types";
import { Card, StatusDot, type Status } from "./ui";

/** Green within the budget, amber up to 2×, red beyond or when the pipeline says so. */
export function freshnessStatus(s: SourceRow, now: number): { status: Status; budgetH: number; age: number | null } {
  const budgetH = /firms/i.test(s.name) ? 6 : /open-meteo/i.test(s.name) ? 12 : /power/i.test(s.name) ? 96 : 24;
  const age = ageHours(s.retrieved_at, now);
  if (s.status === "missing" || age == null) return { status: "bad", budgetH, age };
  if (s.status === "stale") return { status: "warn", budgetH, age };
  if (/natural earth/i.test(s.name)) return { status: "ok", budgetH, age }; // static file
  return { status: age <= budgetH ? "ok" : age <= 2 * budgetH ? "warn" : "bad", budgetH, age };
}

/** Re-render once a minute so relative ages stay honest. */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export default function Freshness({ freshness, run }: { freshness: FreshnessFile | null; run: RunFile | null }) {
  const now = useNow();
  const rows = freshness?.sources ?? [];
  const gates = run ? Object.entries(run.gates) : [];
  const failed = gates.filter(([, g]) => g.pass === false).map(([k]) => k);
  return (
    <Card
      title="Freshness · how old is every number on screen?"
      caption={
        run ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>
              run {run.run_id} · retrieved {fmtUtc(run.finished, true)} · {run.duration_s} s ·{" "}
              {failed.length
                ? `failed ${failed.join(", ")}`
                : `${gates.filter(([, g]) => g.pass === true).length}/${gates.filter(([, g]) => g.pass != null).length} gates pass`}
            </span>
            <span className="inline-flex items-center gap-1"><StatusDot status="ok" /> within budget</span>
            <span className="inline-flex items-center gap-1"><StatusDot status="warn" /> up to 2×</span>
            <span className="inline-flex items-center gap-1"><StatusDot status="bad" /> older or missing</span>
          </span>
        ) : "waiting for run.json"
      }
    >
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="h-6 text-[10px] uppercase tracking-wide text-muted">
            <th className="text-left font-normal">source</th>
            <th className="whitespace-nowrap pl-3 text-right font-normal">last fetch</th>
            <th className="whitespace-nowrap pl-3 text-right font-normal">budget</th>
            <th className="whitespace-nowrap pl-3 text-right font-normal">records</th>
            <th className="w-5 font-normal" aria-label="status" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-muted">no freshness.json yet</td></tr>
          )}
          {rows.map((s) => {
            const f = freshnessStatus(s, now);
            return (
              <tr key={s.name} className="h-7 border-t border-border">
                <td className="text-ink">
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">{s.name}</a>
                  <span className="ml-1 text-muted">{s.product}</span>
                </td>
                <td className="whitespace-nowrap pl-3 text-right font-mono text-ink-2" title={fmtUtc(s.retrieved_at, true)}>{fmtAge(f.age)}</td>
                <td className="whitespace-nowrap pl-3 text-right font-mono text-muted">{f.budgetH >= 48 ? `${f.budgetH / 24} d` : `${f.budgetH} h`}</td>
                <td className="whitespace-nowrap pl-3 text-right font-mono text-ink-2">{fmtCount(s.records)}</td>
                <td className="text-right">
                  <StatusDot
                    status={f.status}
                    title={`${s.status} · retrieved ${fmtUtc(s.retrieved_at, true)} · documented latency ${s.latency_doc}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
