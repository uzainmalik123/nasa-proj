// Run-id keyed cache of the nine published files: the cache is never trusted on
// its own; a fresh run.json probe decides, and a fetched set only replaces the
// cached run when its files agree on one id that is newer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptRun, fileRunId, probeVerdict, runIdOf } from "./cache";
import type { Data } from "./types";

const RUN_A = "20261115T0417Z";
const RUN_B = "20261115T0717Z";

/** The nine files as a run id per file; `runOverride` sets individual files. */
function dataOf(id: string, override: Partial<Record<keyof Data, string>> = {}): Data {
  const meta = (k: keyof Data) => ({ meta: { run_id: override[k] ?? id } });
  return {
    places: meta("places"), trends: meta("trends"), risk: meta("risk"), series: meta("series"), fires: meta("fires"),
    feed: meta("feed"), freshness: meta("freshness"), honesty: meta("honesty"),
    run: { run_id: override.run ?? id },
  } as unknown as Data;
}

test("fileRunId reads run.json's top-level id and the others' meta.run_id", () => {
  assert.equal(fileRunId({ run_id: RUN_A }), RUN_A);
  assert.equal(fileRunId({ meta: { run_id: RUN_A } }), RUN_A);
  assert.equal(fileRunId({}), null);
  assert.equal(fileRunId(null), null);
});

test("runIdOf is the id all nine files agree on, null when they disagree", () => {
  assert.equal(runIdOf(dataOf(RUN_A)), RUN_A);
  assert.equal(runIdOf(dataOf(RUN_B, { series: RUN_A })), null);
});

test("probe: same id as the cache → current; a different id → refresh", () => {
  assert.equal(probeVerdict(RUN_A, RUN_A), "current");
  assert.equal(probeVerdict(RUN_A, RUN_B), "refresh");
});

test("probe: nothing cached → refresh; probe failed with a cache → keep what we have", () => {
  assert.equal(probeVerdict(null, RUN_A), "refresh");
  assert.equal(probeVerdict(null, null), "refresh");
  assert.equal(probeVerdict(RUN_A, null), "current");
});

test("a consistent newer run replaces the cached one", () => {
  assert.equal(acceptRun(dataOf(RUN_B), RUN_A), true);
});

test("a run whose files disagree (CDN mid-publish) never replaces a cached run", () => {
  assert.equal(acceptRun(dataOf(RUN_B, { trends: RUN_A }), RUN_A), false);
});

test("an older or equal run never replaces the cached one", () => {
  assert.equal(acceptRun(dataOf(RUN_A), RUN_B), false);
  assert.equal(acceptRun(dataOf(RUN_A), RUN_A), false);
});

test("with nothing cached any fetched set is shown, even a disagreeing one (today's behaviour)", () => {
  assert.equal(acceptRun(dataOf(RUN_B, { trends: RUN_A }), null), true);
});
