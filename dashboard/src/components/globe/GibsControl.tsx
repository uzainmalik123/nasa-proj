"use client";
// GibsControl.tsx · PRD M1: the three GIBS layer toggles, the 30-day date
// slider and the valid-date caption, floating bottom-centre on the globe
// (DESIGN.md §3). Pure: layer and date come from the parent, changes go up.
import {
  GIBS_LAYERS, GIBS_MAX_STEP_BACK, GIBS_SLIDER_DAYS, GIBS_TOGGLE_KEYS, addDays, clampGibsDate, gibsDateRange,
  type GibsLayerKey, type GibsValid,
} from "./gibs";

export interface GibsControlProps {
  layer: GibsLayerKey | null;
  /** Requested YYYY-MM-DD; null = newest. */
  date: string | null;
  /** What the map is showing after the 404 fallback (null while resolving). */
  valid: GibsValid | null;
  onChange: (layer: GibsLayerKey | null, date: string | null) => void;
}

function dayIndex(min: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${min}T00:00:00Z`)) / 86_400_000);
}

export default function GibsControl({ layer, date, valid, onChange }: GibsControlProps) {
  const meta = layer ? GIBS_LAYERS[layer] : null;
  const range = layer ? gibsDateRange(layer) : null;
  const shown = layer ? clampGibsDate(layer, date) : null;
  // the PRD's three, plus whatever a ?gibs= URL asked for (truecolor)
  const keys = layer && !GIBS_TOGGLE_KEYS.includes(layer) ? [...GIBS_TOGGLE_KEYS, layer] : GIBS_TOGGLE_KEYS;

  const pick = (k: GibsLayerKey) => {
    if (k === layer) onChange(null, date); // clicking the active chip turns imagery off
    else onChange(k, date ? clampGibsDate(k, date) : null);
  };

  return (
    <div
      className="absolute bottom-3 z-10 rounded-2xl border border-white/10 bg-black/55 px-3 py-2 text-[10px] text-muted backdrop-blur"
      style={{ left: "max(calc(50% - 20px), 510px)", transform: "translateX(-50%)", width: "min(480px, 62%)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="uppercase tracking-[0.08em]">imagery</span>
        <div className="flex overflow-hidden rounded border border-white/15" role="group" aria-label="NASA GIBS imagery layer">
          {keys.map((k) => {
            const on = k === layer;
            const m = GIBS_LAYERS[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                title={m.label}
                onClick={() => pick(k)}
                className={`flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wide transition ${
                  on ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: m.colour, opacity: on ? 1 : 0.45 }}
                />
                {m.short}
              </button>
            );
          })}
        </div>
        {layer == null && <span className="ml-auto">NASA GIBS · last {GIBS_SLIDER_DAYS} days</span>}
      </div>

      {meta && layer && range && shown && (
        <>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className="font-mono">{range.min.slice(5)}</span>
            <input
              type="range"
              min={0}
              max={GIBS_SLIDER_DAYS - 1}
              step={1}
              value={dayIndex(range.min, shown)}
              onChange={(e) => onChange(layer, addDays(range.min, Number(e.target.value)))}
              aria-label={`${meta.label} date`}
              aria-valuetext={shown}
              className="h-1 min-w-0 flex-1 cursor-pointer"
              style={{ accentColor: meta.colour }}
            />
            <span className="font-mono">{range.max.slice(5)}</span>
            <span className="font-mono text-[12px] text-ink">{shown}</span>
          </div>
          <div className="mt-1 text-muted">
            <Caption layer={layer} shown={shown} valid={valid} />
          </div>
        </>
      )}
    </div>
  );
}

/** "valid <date> · observation · NASA GIBS", plus what the 404 fallback did. */
function Caption({ layer, shown, valid }: { layer: GibsLayerKey; shown: string; valid: GibsValid | null }) {
  const m = GIBS_LAYERS[layer];
  if (!valid || valid.key !== layer || valid.requested !== shown) {
    return <>checking NASA GIBS for {shown}…</>;
  }
  if (!valid.valid) {
    return <>no {m.short} image within {GIBS_MAX_STEP_BACK} days of {shown} · NASA GIBS</>;
  }
  return (
    <>
      valid <span className="font-mono text-ink-2">{valid.valid}</span> · observation · NASA GIBS · {m.note}
      {valid.steps > 0 && (
        <>
          {" "}· no image for {valid.requested} yet, stepped back {valid.steps} day{valid.steps > 1 ? "s" : ""}
        </>
      )}
    </>
  );
}
