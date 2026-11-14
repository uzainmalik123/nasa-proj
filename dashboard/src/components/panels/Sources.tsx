"use client";
// Sources panel (DESIGN.md §5 catalogue, PRD §7.4 provenance rule): source,
// kind (observation / forecast / trend / risk assessment), valid for,
// retrieved at, status dot. Always visible. Times in UTC.
import { KIND_LABEL, fmtUtc } from "@/lib/format";
import { P } from "@/lib/palette";
import type { FreshnessFile, Kind, RiskFile, SourceStatus, TrendsFile } from "@/lib/types";
import { Card, Chip, StatusDot, type Status } from "./ui";

const KIND_COLOUR: Record<Kind, string> = {
  observation: P.s2,
  forecast: P.s1,
  trend: P.s3,
  risk_assessment: P.warning,
};

const STATUS: Record<SourceStatus, Status> = { ok: "ok", stale: "warn", missing: "bad" };

interface Row {
  name: string;
  product: string;
  kind: Kind;
  valid: string | null;
  retrieved: string | null;
  status: Status;
  url?: string;
  statusText: string;
}

export default function Sources({ freshness, trends, risk }: {
  freshness: FreshnessFile | null; trends: TrendsFile | null; risk: RiskFile | null;
}) {
  const rows: Row[] = (freshness?.sources ?? []).map((s) => ({
    name: s.name,
    product: s.product,
    kind: s.kind,
    valid: s.valid_for,
    retrieved: s.retrieved_at,
    status: STATUS[s.status] ?? "none",
    url: s.url,
    statusText: `${s.status} · documented latency ${s.latency_doc}`,
  }));
  // Our own products, labelled as what they are (PRD §7.4: four words, never mixed).
  if (trends) {
    rows.push({
      name: "Trend engine",
      product: `Mann-Kendall + Sen's slope · ${trends.long.window} & ${trends.short.window}`,
      kind: "trend",
      valid: trends.months.length ? `${trends.months[trends.months.length - 1]}-01T00:00Z` : null,
      retrieved: trends.meta.generated_at,
      status: "ok",
      statusText: `run ${trends.meta.run_id}`,
    });
  }
  if (risk) {
    rows.push({
      name: "Hazard modules",
      product: `${risk.model.name} ${risk.model.version} · PR-AUC ${risk.model.pr_auc} vs ${risk.model.baseline_pr_auc}`,
      kind: "risk_assessment",
      valid: `${risk.valid_from}T00:00Z`,
      retrieved: risk.meta.generated_at,
      status: risk.model.pr_auc > risk.model.baseline_pr_auc ? "ok" : "warn",
      statusText: `valid ${risk.valid_from} → ${risk.valid_to} · Brier ${risk.model.brier}`,
    });
  }

  return (
    <Card
      title="Sources · what kind of number is this, and when is it from?"
      caption={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <span key={k}>
              <i className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: KIND_COLOUR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
          <span>all times UTC · Open-Meteo is a non-NASA supplement · NASA POWER rain is derived from GPM IMERG</span>
        </span>
      }
    >
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="h-6 text-[10px] uppercase tracking-wide text-muted">
            <th className="text-left font-normal">source</th>
            <th className="text-left font-normal">kind</th>
            <th className="text-right font-normal">valid for</th>
            <th className="text-right font-normal">retrieved at</th>
            <th className="w-5 font-normal" aria-label="status" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-muted">no sources yet</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.name} className="h-7 border-t border-border align-middle">
              <td className="max-w-[150px] pr-2">
                <div className="truncate text-ink" title={r.product}>
                  {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.name}</a> : r.name}
                </div>
                <div className="truncate text-[9.5px] leading-tight text-muted" title={r.product}>{r.product}</div>
              </td>
              <td className="pr-2">
                <Chip colour={KIND_COLOUR[r.kind]}>{KIND_LABEL[r.kind]}</Chip>
              </td>
              <td className="whitespace-nowrap pr-2 text-right font-mono text-[10px] text-ink-2">{fmtUtc(r.valid)}</td>
              <td className="whitespace-nowrap pr-1 text-right font-mono text-[10px] text-ink-2">{fmtUtc(r.retrieved)}</td>
              <td className="text-right"><StatusDot status={r.status} title={r.statusText} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
