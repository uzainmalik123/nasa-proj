// DESIGN.md §5 table rules: inline ramp bar 40 × 4 px, rounded, filled
// proportionally. `colour` defaults to the risk ramp at `v`; pass a series
// colour for diverging (trend) bars.
import { riskColour } from "./ramp";

export default function RampBar({
  v, colour, width = 40, height = 4, track = "rgba(255,255,255,0.08)",
}: { v: number; colour?: string; width?: number; height?: number; track?: string }) {
  const f = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  return (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-full align-middle"
      style={{ width, height, background: track }}
      aria-hidden="true"
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${f * 100}%`, background: colour ?? riskColour(f) }}
      />
    </span>
  );
}
