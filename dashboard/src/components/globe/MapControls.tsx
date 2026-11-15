// F1 band B · bottom-right glass control stack: zoom in / out, reset to the
// world view, and the fires on/off toggle. Pure: state lives in Globe.
const BTN =
  "flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-ink-2 backdrop-blur " +
  "transition-colors hover:text-ink hover:border-white/25 focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-white/60";

export default function MapControls({
  firesOn, onZoomIn, onZoomOut, onReset, onToggleFires,
}: {
  firesOn: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleFires: () => void;
}) {
  return (
    <div className="absolute bottom-12 right-3 z-10 flex flex-col items-center gap-1.5">
      <button type="button" aria-label="Zoom in" title="Zoom in" className={BTN} onClick={onZoomIn}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" aria-label="Zoom out" title="Zoom out" className={BTN} onClick={onZoomOut}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" aria-label="Reset to world view" title="Reset to world view" className={BTN} onClick={onReset}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.8 7h10.4M7 1.8c-1.6 1.5-2.4 3.2-2.4 5.2s.8 3.7 2.4 5.2M7 1.8c1.6 1.5 2.4 3.2 2.4 5.2s-.8 3.7-2.4 5.2"
            stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </button>
      <div className="my-0.5 h-px w-5 bg-white/15" aria-hidden="true" />
      <button
        type="button"
        aria-label={firesOn ? "Hide active fires" : "Show active fires"}
        aria-pressed={firesOn}
        title={firesOn ? "Hide active fires" : "Show active fires"}
        className={`${BTN} ${firesOn ? "" : "opacity-60"}`}
        style={firesOn ? { color: "#fb923c" } : undefined}
        onClick={onToggleFires}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 1.2c.4 2-1 3-2 4.3C4.1 6.7 3.6 7.7 3.6 9a3.4 3.4 0 0 0 6.8 0c0-1.3-.6-2.3-1.2-3-.1.9-.5 1.5-1.1 1.8.3-2.4-.3-4.9-1.1-6.6Z"
            fill={firesOn ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
