"use client";
// DESIGN.md §5: measure the container with a ResizeObserver and render
// nothing until width > 0, so no chart ever draws a negative rect on first paint.
import { useEffect, useRef, useState } from "react";

export interface Size { width: number; height: number }

export function useSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}
