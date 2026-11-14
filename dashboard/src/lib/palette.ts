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

export const RISK_STOPS: [number, string][] = [
  [0.00, "rgba(255,120,40,0)"],
  [0.05, "rgba(140,45,15,0.45)"],
  [0.20, "#9a3412"],
  [0.40, "#ea580c"],
  [0.65, "#fbbf24"],
  [1.00, "#fef3c7"],
];
