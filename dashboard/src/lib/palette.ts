// lib/palette.ts
export const P = {
  page:     "#0d0d0d",   // app background
  surface:  "#1a1a19",   // cards, tooltips body
  surface2: "#222221",   // hover rows, inputs
  ink:      "#ffffff",   // primary text, selected outline
  ink2:     "#c3c2b7",   // secondary text, chart labels
  muted:    "#898781",   // captions, axis labels, headings
  grid:     "#2c2c2a",   // chart gridlines
  axis:     "#383835",   // zero lines, axis strokes
  border:   "rgba(255,255,255,0.10)",

  s1: "#3987e5",   // blue    rainfall, soil moisture, "lowers risk", predicted
  s2: "#d95926",   // orange  fire, "raises risk", observed
  s3: "#199e70",   // aqua    vegetation / NDVI
  s4: "#c98500",   // yellow  temperature / LST

  critical: "#d03b3b",
  warning:  "#fab219",
  good:     "#0ca30c",
};

// Stop values = the 50 / 80 / 95 / 99th percentiles of wildfire p across all
// places on the first scoring run (DESIGN.md §2 "set the stops after the first
// scoring run"; run 20261114T0949Z, 554 places). Colours are not tunable.
export const RISK_STOPS: [number, string][] = [
  [0.000, "rgba(255,120,40,0)"],
  [0.150, "rgba(140,45,15,0.45)"],
  [0.590, "#9a3412"],
  [0.920, "#ea580c"],
  [0.995, "#fbbf24"],
  [1.000, "#fef3c7"],
];
