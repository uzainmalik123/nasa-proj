// Run-id keyed cache of the nine published files (KI-7 step 1c).
//
// The cache is never trusted on its own: every load fetches the 1 KB run.json
// fresh and compares its run id with the cached run's (lib/data.ts). So the
// cached copy can live for days and never shows a run older than a fresh load
// would, and the worst-case staleness stays the CDN's 5-minute max-age, as it
// was before. The pure decisions live here so they can be tested; the store
// is IndexedDB (localStorage caps at ~5 MB, the nine files parse to ~10 MB)
// holding one structured clone of `Data`, no JSON round trip.
import type { Data } from "./types";

export interface StoredRun {
  runId: string;
  savedAt: number;
  data: Data;
}

/** Run id of a published file: run.json carries it at the top, the others under `meta`. */
export function fileRunId(file: unknown): string | null {
  if (!file || typeof file !== "object") return null;
  const f = file as { run_id?: unknown; meta?: { run_id?: unknown } | null };
  const id = f.run_id ?? f.meta?.run_id;
  return typeof id === "string" ? id : null;
}

/** The run id all nine files agree on; null when they disagree (the CDN mid-publish). */
export function runIdOf(data: Data): string | null {
  const ids = new Set(Object.values(data as unknown as Record<string, unknown>).map(fileRunId));
  if (ids.size !== 1) return null;
  const [id] = ids;
  return id;
}

export type Verdict = "current" | "refresh";

/**
 * After the probe: nothing cached → fetch; the probe failed (offline) → keep
 * the cache, there is no better information; otherwise refresh iff the ids differ.
 */
export function probeVerdict(cachedRunId: string | null, probeRunId: string | null): Verdict {
  if (!cachedRunId) return "refresh";
  if (!probeRunId) return "current";
  return probeRunId === cachedRunId ? "current" : "refresh";
}

/**
 * Whether a fetched set may replace the cached run: its files must agree on
 * one id, and that id must be newer. Run ids are UTC timestamps
 * ("20261115T0417Z"), so string order is time order. With nothing cached any
 * set is shown, as before this cache existed.
 */
export function acceptRun(fetched: Data, cachedRunId: string | null): boolean {
  if (!cachedRunId) return true;
  const id = runIdOf(fetched);
  return id != null && id > cachedRunId;
}

// ---- IndexedDB store ---------------------------------------------------------
const DB_NAME = "etd-data";
const STORE = "runs";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The cached run, or null when there is none or storage is unavailable (private mode, SSR). */
export async function readStored(): Promise<StoredRun | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    const out = await request(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));
    db.close();
    return (out as StoredRun | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Store the run; failures (quota, private mode) are swallowed: the cache is an optimisation. */
export async function writeStored(s: StoredRun): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(s, KEY));
    db.close();
  } catch {
    /* ignore */
  }
}
