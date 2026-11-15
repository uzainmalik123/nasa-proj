// Bottom-left legend for the globe. Pure: everything comes from `colouring`.
import { P, RISK_STOPS } from "@/lib/palette";
import {
  CATEGORIES, CATEGORY_THRESHOLD_P, CATEGORY_V, CONTINUOUS_HAZARD, HAZARD_LABEL, LOW_COLOUR, LOW_RING_WIDTH, RISK_FLOOR,
  VARIABLE_LABEL, lowIsRing, riskColour, signed, slopeDigits, type Colouring,
} from "./colour";
import { GIBS_LAYERS, GIBS_MAX_STEP_BACK, type GibsValid } from "./gibs";
import {
  FIRE_CELL_DEG, FIRE_FILL, FIRE_STROKE, HEAT_COLOURS, HEAT_LEGEND_ZOOM, fireDotRadius, fireSourceLabel, fmtAcq,
} from "./fires";
import type { FiresFile } from "@/lib/types";

const BAR_W = 176;

// The ramp encodes rank ("unusual for the world right now", DESIGN.md §2), so
// the bar spaces the stops evenly and the labels quote the probability at each.
const N_STOPS = RISK_STOPS.length;
const stopX = (k: number) => (k / (N_STOPS - 1)) * 100;
const riskGradient = `linear-gradient(to right, ${RISK_STOPS
  .map(([, c], k) => `${c} ${stopX(k)}%`)
  .join(", ")})`;
// label every stop except the 99th-percentile one, which would collide with 100
const RISK_LABELS = RISK_STOPS
  .map(([v], k) => ({ k, v }))
  .filter(({ k }) => k !== N_STOPS - 2);

function pctLabel(v: number): string {
  return v >= 0.995 ? "100" : String(Math.round(v * 100));
}

const trendGradient = `linear-gradient(to right, ${P.s1} 0%, ${P.muted} 50%, ${P.s2} 100%)`;

export default function Legend({
  colouring, fires = null, firesOn = true, gibs = null, zoom = 0,
}: { colouring: Colouring; fires?: FiresFile | null; firesOn?: boolean; gibs?: GibsValid | null; zoom?: number }) {
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-muted backdrop-blur"
      style={{ minWidth: BAR_W + 24, maxWidth: BAR_W + 64 }}
    >
      {colouring.kind === "risk" ? <RiskLegend c={colouring} ring={lowIsRing(zoom)} /> : <TrendLegend c={colouring} />}
      {gibs && <GibsRow g={gibs} />}
      {/* F1 band B: fires toggled off → the row stays, dimmed, and says so */}
      <div className={firesOn ? undefined : "opacity-40"} data-fires-on={firesOn ? "true" : "false"}>
        <FireRow fires={fires} zoom={zoom} />
        {!firesOn && <div className="font-semibold uppercase tracking-[0.08em] text-ink-2">hidden</div>}
      </div>
    </div>
  );
}

const FIRE_SAMPLES = [1, 10, 50];
const heatGradient = `linear-gradient(to right, ${HEAT_COLOURS.join(", ")})`;

/** KI-1: the dots are 0.25° cells, sized by count; say so and show the scale. */
function FireRow({ fires, zoom }: { fires: FiresFile | null; zoom: number }) {
  // F1: below zoom 4 the globe draws the heatmap, so the legend shows its ramp
  if (zoom < HEAT_LEGEND_ZOOM) {
    return (
      <div className="mt-2 border-t border-white/10 pt-2" data-fire-legend="heat">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-10 rounded-sm" style={{ backgroundImage: heatGradient }} />
          <span>active fires · density of VIIRS detections, last 24 h</span>
        </div>
        {fires && (
          <div className="mt-0.5 text-muted">
            {fireSourceLabel(fires.source)} · FIRMS · newest {fmtAcq(fires.newest_acq)} · zoom in for cells
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 border-t border-white/10 pt-2" data-fire-legend="dots">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5">
          {FIRE_SAMPLES.map((n) => (
            <span
              key={n}
              className="inline-block rounded-full"
              style={{
                width: 2 * fireDotRadius(n),
                height: 2 * fireDotRadius(n),
                background: FIRE_FILL,
                boxShadow: `0 0 0 1.2px ${FIRE_STROKE}, 0 0 8px 3px rgba(255,247,237,0.35)`,
              }}
            />
          ))}
        </span>
        <span>active fire detections (FIRMS)</span>
      </div>
      <div className="mt-0.5 text-muted">
        {FIRE_CELL_DEG}° cells · {FIRE_SAMPLES.join(" / ")} detections · hover for the count
      </div>
      {fires && (
        <div className="text-muted">
          {fireSourceLabel(fires.source)} · last 24 h · newest {fmtAcq(fires.newest_acq)}
        </div>
      )}
    </div>
  );
}

/** PRD M1: swatch from the layer's own GIBS colormap, valid date, kind + source. */
function GibsRow({ g }: { g: GibsValid }) {
  const m = GIBS_LAYERS[g.key];
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="flex items-center gap-1.5 text-ink-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.colour }} />
        {m.label}
      </div>
      {m.swatch && (
        <>
          <div
            className="mt-1 h-2 rounded-sm"
            style={{ width: BAR_W, backgroundImage: `linear-gradient(to right, ${m.swatch.colours.join(", ")})` }}
          />
          <div className="mt-0.5 flex justify-between font-mono" style={{ width: BAR_W }}>
            <span>{m.swatch.lo}</span>
            <span>{m.swatch.hi}</span>
          </div>
        </>
      )}
      <div className="mt-0.5 text-muted">
        {g.valid ? `valid ${g.valid} · observation · NASA GIBS` : `no image within ${GIBS_MAX_STEP_BACK} days · NASA GIBS`}
      </div>
    </div>
  );
}

/** KI-2: the low mark as the globe draws it right now: a filled dot at the world zoom, a ring zoomed in. */
function LowMark({ ring }: { ring: boolean }) {
  return (
    <span
      data-low-mark={ring ? "ring" : "dot"}
      className="inline-block rounded-full"
      style={
        ring
          ? { width: 9, height: 9, border: `${LOW_RING_WIDTH}px solid ${LOW_COLOUR}`, opacity: 0.85 }
          : { width: 6, height: 6, background: LOW_COLOUR, opacity: 0.9, boxShadow: "0 0 0 1px rgba(0,0,0,0.6)" }
      }
    />
  );
}

function RiskLegend({ c, ring }: { c: Extract<Colouring, { kind: "risk" }>; ring: boolean }) {
  // M-MODE+URL: "now" = the category each place is in today, "next14" = the forecast probability
  const title = `${HAZARD_LABEL[c.hazard]} · ${c.mode === "now" ? "category today" : "next 14 days"}`;
  const sub = c.validFrom && c.validTo ? `risk assessment · valid ${c.validFrom} → ${c.validTo}` : "risk assessment";
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
          <div className="relative mt-0.5 h-3 font-mono" style={{ width: BAR_W }}>
            {RISK_LABELS.map(({ k, v }) => (
              <span
                key={k}
                className="absolute top-0 whitespace-nowrap"
                style={{
                  left: `${stopX(k)}%`,
                  transform: k === 0 ? "none" : k === N_STOPS - 1 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {pctLabel(v)}{k === N_STOPS - 1 ? " %" : ""}
              </span>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-ink-2">
            <LowMark ring={ring} />
            low · under {Math.round(RISK_FLOOR * 100)} %
            <span className="text-muted">· {ring ? "ring when zoomed in" : "dot at the world zoom"}</span>
          </div>
          <div className="mt-0.5 text-muted">calibrated probability</div>
          <div className="text-muted">ramp stops set 14 Nov · 50 / 80 / 95 / 99th pct</div>
          {c.hazard in CATEGORY_THRESHOLD_P && (
            <div className="text-muted">
              {(Object.entries(CATEGORY_THRESHOLD_P[c.hazard as "wildfire" | "rain"]) as [string, number][])
                .map(([cat, v]) => `${cat} ≥ ${Math.round(v * 100)} %`)
                .join(" · ")}
            </div>
          )}
        </>
      ) : (
        <>
        <div className="flex gap-2.5">
          {CATEGORIES.map((cat) => (
            <span key={cat} className="flex items-center gap-1">
              {cat === "low" ? (
                <LowMark ring={ring} />
              ) : (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: riskColour(CATEGORY_V[cat]), boxShadow: "0 0 0 1px rgba(0,0,0,0.6)" }}
                />
              )}
              {cat}
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-muted">
          {!CONTINUOUS_HAZARD[c.hazard]
            ? "no probability for this hazard · category in both modes"
            : "today's category · next 14 days shows the probability"}
        </div>
        </>
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
