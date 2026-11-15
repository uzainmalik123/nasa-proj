// KI-2: places under the risk floor are a visible "watched, low" mark (an
// off-white dot at the world zoom, a ring when zoomed in), never the muted grey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { P } from "@/lib/palette";
import type { Category, RiskNow } from "@/lib/types";
import {
  FILTERED_OPACITY, LOW_COLOUR, LOW_ZOOM_DOT, LOW_ZOOM_RING, RISK_FLOOR, lowIsRing, pointStates, type Colouring,
} from "./colour";

function row(p: number, category: Category): RiskNow {
  const base = { severity: 0, exposure: 0, confidence: "high" as const };
  return {
    wildfire: { ...base, p, category },
    rain: { ...base, p, category },
    drought: { ...base, index: 0, category },
    heat: { ...base, days_above: 0, category },
  };
}

const next14: Colouring = { kind: "risk", hazard: "wildfire", mode: "next14", continuous: true };
const today: Colouring = { kind: "risk", hazard: "wildfire", mode: "now", continuous: false };

test("a forecast probability under the floor is the low mark, not muted grey", () => {
  const [s] = pointStates(next14, 1, { now: [row(RISK_FLOOR / 2, "low")] }, null);
  assert.equal(s.low, true);
  assert.equal(s.color, LOW_COLOUR);
  assert.equal(s.o, 1);
  assert.equal(s.sig, false);
});

test("a probability at or above the floor keeps the ramp colour and is not low", () => {
  const [s] = pointStates(next14, 1, { now: [row(0.5, "elevated")] }, null);
  assert.equal(s.low, false);
  assert.notEqual(s.color, LOW_COLOUR);
  assert.notEqual(s.color, P.muted);
});

test("category today: the low category is the low mark, elevated is not", () => {
  const [lo, el] = pointStates(today, 2, { now: [row(0.05, "low"), row(0.4, "elevated")] }, null);
  assert.equal(lo.low, true);
  assert.equal(el.low, false);
});

test("a place outside the continent filter is dimmed, not marked low", () => {
  const [s] = pointStates(next14, 1, { now: [row(0.01, "low")] }, null, new Set<number>());
  assert.equal(s.low, false);
  assert.equal(s.o, FILTERED_OPACITY);
  assert.equal(s.color, P.muted);
});

test("a place with no assessment stays muted and is not low", () => {
  const [s] = pointStates(next14, 1, { now: [] }, null);
  assert.equal(s.low, false);
  assert.equal(s.color, P.muted);
});

test("trend colouring never uses the low mark", () => {
  const trend: Colouring = { kind: "trend", variable: "tmax_c", unit: "°C", scale: 1, window: "10y" };
  const trends = { variables: ["tmax_c"], units: ["°C"], long: { window: "10y", slope: [[0.1]], p: [[0.5]], label: [["flat"]] } };
  const [s] = pointStates(trend, 1, null, trends as never);
  assert.equal(s.low, false);
  assert.equal(s.color, P.muted);
});

test("the mark is a dot at the world zoom and a ring from the detail zoom", () => {
  assert.equal(lowIsRing(1.6), false);
  assert.equal(lowIsRing(LOW_ZOOM_DOT), false);
  assert.equal(lowIsRing(LOW_ZOOM_RING), true);
  assert.equal(lowIsRing(5.2), true);
});
