// Shell.tsx · the pieces of the frame that exist before any data: brand block,
// safety footer (PRD §7.4) and the static loading shell page.tsx prerenders
// while the Dashboard chunk downloads, so the first paint is the real frame
// (top bar, left column, footer) instead of a blank page. Same markup and
// sizes as Dashboard's, so nothing moves when the app mounts over it.

export const SAFETY =
  "Informational tool, not an official warning service. Follow local authorities.";

export function BrandBlock() {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2.5">
      <span className="brand-mark" aria-hidden />
      <div className="hidden leading-tight min-[1280px]:block">
        <div className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Earth System Trend Detective</div>
        <div className="hidden text-[10px] text-muted min-[1820px]:block">NASA FIRMS · POWER · GIBS · forecast Open-Meteo</div>
      </div>
    </div>
  );
}

/** Desktop footer bar, 24 px, always visible. Phones get the same line at the end of each tab (Dashboard). */
export function SafetyFooter() {
  return (
    <footer className="relative z-30 hidden h-6 shrink-0 items-center gap-3 border-t border-border bg-page px-4 text-[10px] text-muted lg:flex">
      <span className="text-ink-2">{SAFETY}</span>
      <span aria-hidden>·</span>
      <span>observation, forecast, trend and risk assessment are labelled as four different things · all times UTC</span>
    </footer>
  );
}

/** The pill in its loading state; Dashboard swaps in the live text. */
export function LoadingPill({ text }: { text: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[#89878180] bg-[#89878114] px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] text-muted">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted" />
      {text}
    </div>
  );
}

export function LoadingShell() {
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-page text-ink">
      <header className="relative z-30 hidden h-14 shrink-0 items-center gap-5 border-b border-border bg-page px-4 lg:flex">
        <BrandBlock />
        <div className="flex-1" />
        <LoadingPill text="loading" />
      </header>
      <div className="relative flex min-h-0 flex-1">
        <aside className="hidden lg:block lg:w-[552px] lg:shrink-0 lg:border-r lg:border-border" />
        <div className="flex flex-1 items-center justify-center text-[11px] text-muted">loading the globe…</div>
      </div>
      <SafetyFooter />
    </div>
  );
}
