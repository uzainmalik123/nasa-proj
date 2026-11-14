"use client";
// Search.tsx · PRD H12, DESIGN.md §8. Text input over the place list: "/"
// focuses it from anywhere, typing shows the best fuzzy matches on name +
// country, ↑/↓ move, Enter (or click) picks → the parent selects and flies.
// Owns only its own text/highlight; the picked index goes up through onPick.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/types";
import { search } from "./fuzzy";

export interface SearchProps {
  places: Place[];
  /** Called with the place index on Enter or click. Parent selects + flies. */
  onPick: (i: number) => void;
  limit?: number;
  className?: string;
}

const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

export default function Search({ places, onPick, limit = 8, className = "" }: SearchProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const hits = useMemo(() => search(places, q, limit), [places, q, limit]);
  const showing = open && q.trim().length > 0;

  // "/" focuses the box from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (EDITABLE.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (i: number) => {
    const p = places[i];
    if (!p) return;
    onPick(i);
    setQ(`${p.name}, ${p.country}`);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (hits.length ? (h + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => (hits.length ? (h - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter") {
      const m = hits[Math.min(hi, hits.length - 1)];
      if (m) { e.preventDefault(); pick(m.i); }
    } else if (e.key === "Escape") {
      // first Esc closes the list / clears the text; only an empty, closed box
      // lets the keypress reach the app (which clears the selection).
      if (showing || q) {
        e.preventDefault();
        e.stopPropagation();
        if (showing) setOpen(false); else setQ("");
      } else {
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 rounded border border-white/15 bg-surface-2 px-1.5 py-0.5 focus-within:border-white/30">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="shrink-0 text-muted" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="search places"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={q}
          placeholder="search place"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => { setOpen(true); inputRef.current?.select(); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-[150px] bg-transparent text-[11px] text-ink placeholder:text-muted focus:outline-none"
        />
        <kbd className="rounded bg-white/10 px-1 font-mono text-[9px] text-ink-2" aria-hidden>/</kbd>
      </div>

      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 w-[260px] overflow-hidden rounded-xl border border-white/10 bg-black/80 py-1 text-[11px] backdrop-blur"
        >
          {hits.length === 0 ? (
            <li className="px-2.5 py-1.5 text-muted">no place matches “{q.trim()}”</li>
          ) : (
            hits.map((m, k) => {
              const p = places[m.i];
              const active = k === hi;
              return (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => { e.preventDefault(); pick(m.i); }}
                  onMouseEnter={() => setHi(k)}
                  className={`flex cursor-pointer items-center gap-2 px-2.5 py-1 transition ${
                    active ? "bg-white/[0.06] text-ink" : "text-ink-2"
                  }`}
                >
                  <span className="truncate">
                    {p.name} <span className="text-muted">{p.country}</span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {p.capital && (
                      <span className="rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-ink-2">capital</span>
                    )}
                    <span className="font-mono text-[10px] text-muted">{p.continent}</span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
