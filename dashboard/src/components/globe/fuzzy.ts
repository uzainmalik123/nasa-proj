// Fuzzy place matching for Search.tsx. Pure, no DOM, no dependency.
// A query matches when every character appears in order in "name country"
// (diacritics folded, case ignored). Score rewards word starts, runs of
// consecutive matches and a match at the very start; ties fall to population.
import type { Place } from "@/lib/types";

export interface Match {
  i: number; // index into places
  score: number;
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Subsequence score of `q` in `t`, both already folded. null = no match. */
export function score(q: string, t: string): number | null {
  if (!q) return 0;
  let s = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === " ") { prev = -2; continue; }
    // prefer the next word start carrying this char, else the next occurrence
    let at = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== ch) continue;
      if (at < 0) at = k;
      if (k === 0 || t[k - 1] === " " || t[k - 1] === "-") { at = k; break; }
      if (k === prev + 1) { at = k; break; }
    }
    if (at < 0) return null;
    s += 1;
    if (at === prev + 1) s += 2;
    if (at === 0) s += 4;
    else if (t[at - 1] === " " || t[at - 1] === "-") s += 3;
    prev = at;
    ti = at + 1;
  }
  return s;
}

/** Top `limit` places for `query`, best first. Empty query returns []. */
export function search(places: Place[], query: string, limit = 8): Match[] {
  const q = fold(query.trim());
  if (!q) return [];
  const out: Match[] = [];
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const t = fold(`${p.name} ${p.country}`);
    const s = score(q, t);
    if (s == null) continue;
    out.push({ i, score: s });
  }
  out.sort((a, b) => b.score - a.score || (places[b.i].pop ?? 0) - (places[a.i].pop ?? 0));
  return out.slice(0, limit);
}
