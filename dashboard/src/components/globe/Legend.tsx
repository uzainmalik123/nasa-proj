// Bottom-left legend for the globe. Pure: everything comes from `colouring`.
import { P, RISK_STOPS } from "@/lib/palette";
import {
  CATEGORIES, CATEGORY_V, HAZARD_LABEL, VARIABLE_LABEL, riskColour, signed, slopeDigits,
  type Colouring,
} from "./colour";

const BAR_W = 176;

const riskGradient = `linear-gradient(to right, ${RISK_STOPS
  .map(([v, c]) => `${c} ${v * 100}%`)
  .join(", ")})`;

const trendGradient = `linear-gradient(to right, ${P.s1} 0%, ${P.muted} 50%, ${P.s2} 100%)`;

export default function Legend({ colouring }: { colouring: Colouring }) {
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-muted backdrop-blur"
      style={{ minWidth: BAR_W + 24 }}
    >
      {colouring.kind === "risk" ? <RiskLegend c={colouring} /> : <TrendLegend c={colouring} />}
      <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{
            background: "#fff7ed",
            boxShadow: `0 0 0 1.2px #d03b3b, 0 0 8px 3px rgba(255,247,237,0.35)`,
          }}
        />
        <span>active fire detection (FIRMS)</span>
      </div>
    </div>
  );
}

function RiskLegend({ c }: { c: Extract<Colouring, { kind: "risk" }> }) {
  const title = `${HAZARD_LABEL[c.hazard]} · next 14 days`;
  const sub = c.validFrom && c.validTo ? `valid ${c.validFrom} → ${c.validTo}` : "risk assessment";
  return (
    <div>
      <div className="font-semibold uppercase tracking-[0.08em] text-ink-2">{title}</div>
      <div className="mb-1.5 text-muted">{sub}</div>
      {c.continuous ? (
        <>
          <div
            className="h-2 rounded-sm"
            style={{ width: BAR_W, backgroundColor: "#141413", backgroundImage: riskGradient }}
          />
          <div className="mt-0.5 flex justify-between font-mono" style={{ width: BAR_W }}>
            <span>0</span>
            <span>50</span>
            <span>100 %</span>
          </div>
          <div className="mt-0.5 text-muted">calibrated probability</div>
        </>
      ) : (
        <div className="flex gap-2.5">
          {CATEGORIES.map((cat) => (
            <span key={cat} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: cat === "low" ? P.muted : riskColour(CATEGORY_V[cat]),
                  opacity: cat === "low" ? 0.6 : 1,
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                }}
              />
              {cat}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendLegend({ c }: { c: Extract<Colouring, { kind: "trend" }> }) {
  const d = slopeDigits(c.scale);
  return (
    <div>
      <div className="font-semibold uppercase tracking-[0.08em] text-ink-2">
        {VARIABLE_LABEL[c.variable]} · {c.window} trend
      </div>
      <div className="mb-1.5 text-muted">Sen&apos;s slope, Mann-Kendall</div>
      <div className="h-2 rounded-sm" style={{ width: BAR_W, backgroundImage: trendGradient }} />
      <div className="mt-0.5 flex justify-between font-mono" style={{ width: BAR_W }}>
        <span>{signed(-c.scale, d)}</span>
        <span>0</span>
        <span>{signed(c.scale, d)} {c.unit}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted">
        <span style={{ color: P.s1 }}>falling</span>·<span style={{ color: P.s2 }}>rising</span>·
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: P.muted, opacity: 0.6 }} />
        <span>not significant (p ≥ 0.05)</span>
      </div>
    </div>
  );
}
