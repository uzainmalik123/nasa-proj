"use client";
// Globe.tsx · DESIGN.md §4, contracts.md §5. MapLibre globe with places
// coloured by the selected hazard (current category in mode "now", forecast
// probability in mode "next14") or, when `trendVar` is set, by that trend
// variable's 10-year slope (M-MODE+URL), live FIRMS bins on top, optional
// GIBS raster underneath (off until `gibsLayer` is set), continent filter
// dims places elsewhere. Owns no React state: everything is props → map.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapLibreMap, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibre-worker";
import { P } from "@/lib/palette";
import { fmtCount } from "@/lib/format";
import type { FiresFile, Hazard, Mode, Place, RiskFile, TrendsFile, Variable } from "@/lib/types";
import Legend from "./Legend";
import GibsControl from "./GibsControl";
import MapControls from "./MapControls";
import {
  LOW_COLOUR, LOW_DOT_OPACITY, LOW_R_DOT, LOW_R_RING, LOW_RING_OPACITY, LOW_RING_WIDTH, LOW_ZOOM_DOT, LOW_ZOOM_RING,
  continentSet, hazardText, pickColouring, pointStates, trendText, type Colouring,
} from "./colour";
import {
  FIRE_CELL_DEG, FIRE_DOT_RADIUS, FIRE_FILL, FIRE_GLOW_RADIUS, FIRE_HEAT_PAINT, FIRE_STROKE, fadeInDots, fireSourceLabel,
  fmtAcq, fmtCentre, fmtFrp,
} from "./fires";
import {
  GIBS_LAYERS, clampGibsDate, gibsNewestDate, gibsTileUrl, resolveGibsDate, type GibsLayerKey, type GibsValid,
} from "./gibs";

// the GIBS registry and URL helpers live in ./gibs; re-exported so S3-B's imports keep working
export { GIBS_LAYERS, GIBS_WMTS_TEMPLATE, gibsTileUrl, type GibsLayerKey } from "./gibs";
/** @deprecated use gibsNewestDate from ./gibs */
export const gibsDefaultDate = gibsNewestDate;

if (typeof window !== "undefined") setWorkerUrl(MAPLIBRE_WORKER_URL);

export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const ZOOM_GLOBAL = 1.6;
export const ZOOM_REGIONAL = 2.7;
export const ZOOM_FLY_MIN = 5.2;
const CENTER_WORLD: [number, number] = [20, 15];

/** Pass a new object to fly again; identity change triggers the flight. */
export interface FlyTarget {
  lon: number;
  lat: number;
  zoom?: number;
}

export interface GlobeProps {
  places: Place[];
  risk: RiskFile | null;
  trends: TrendsFile | null;
  fires: FiresFile | null;
  mode: Mode;
  hazard: Hazard;
  trendVar: Variable | null;
  selected: number | null;
  onSelect: (i: number | null) => void;
  flyTo: FlyTarget | null;
  gibsLayer: GibsLayerKey | null; // null (the default) = no raster; a key turns the GIBS overlay on
  gibsDate: string | null; // YYYY-MM-DD; null = newest (today minus the layer's lag); a 404 day steps back
  /**
   * M-GIBS: when given, the globe renders the layer toggles + 30-day slider
   * (GibsControl) and reports changes here. Absent = read-only overlay.
   */
  onGibsChange?: (layer: GibsLayerKey | null, date: string | null) => void;
  /** Continent name; places elsewhere are dimmed (S3-B). null/undefined = world. */
  continent?: string | null;
}

const SRC_PLACES = "places";
const SRC_FIRES = "fires";
const SRC_GIBS = "gibs";
const L_PLACES = "places";
const L_SELECTED = "places-selected";
const L_FIRE_HEAT = "fires-heat";
const L_FIRE_GLOW = "fires-glow";
const L_FIRE_DOT = "fires-dot";
const L_GIBS = "gibs";

// radius in px is computed in colour.ts (rank breakpoints for risk, linear for trend)
const RADIUS: ExpressionSpecification = ["coalesce", ["feature-state", "r"], 3];
const SELECTED_RADIUS: ExpressionSpecification = ["*", 1.5, RADIUS];
// KI-2: a place under the risk floor is the low mark: a filled off-white dot at the world zoom that
// crossfades into a hollow ring by the detail zoom. Pure paint expressions, evaluated on the GPU: no
// JavaScript runs on zoom. ["zoom"] must be the input of a top-level interpolate, so the low / other
// branch sits inside each stop.
const IS_LOW: ExpressionSpecification = ["boolean", ["feature-state", "low"], false];
const lowOr = (low: number | string, other: ExpressionSpecification | number | string): ExpressionSpecification =>
  ["case", IS_LOW, low, other];
const lowByZoom = (atDot: number, atRing: number, other: ExpressionSpecification | number): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], LOW_ZOOM_DOT, lowOr(atDot, other), LOW_ZOOM_RING, lowOr(atRing, other)];
const PLACE_PAINT = {
  "circle-radius": lowByZoom(LOW_R_DOT, LOW_R_RING, RADIUS),
  "circle-color": lowOr(LOW_COLOUR, ["coalesce", ["feature-state", "color"], P.muted]),
  "circle-opacity": lowByZoom(LOW_DOT_OPACITY, 0, ["coalesce", ["feature-state", "o"], 0.5]),
  "circle-stroke-color": lowOr(LOW_COLOUR, "rgba(0,0,0,0.6)"),
  "circle-stroke-width": lowOr(LOW_RING_WIDTH, 1),
  "circle-stroke-opacity": lowByZoom(0, LOW_RING_OPACITY, 1),
};
/** Legend zoom, quantised to a quarter so a zoom gesture re-renders React a handful of times, not per frame. */
const quantZoom = (z: number) => Math.round(z * 4) / 4;
const NO_SELECTION: ExpressionSpecification = ["==", ["id"], -1];

const KEEP_LABEL = /country|state|region|city|capital/i;

type MapFn = (map: MapLibreMap) => void;

/** Map handle plus a queue of work waiting for the layers to exist. */
interface MapState {
  map: MapLibreMap | null;
  ready: boolean;
  queue: MapFn[];
}

function runWhenReady(s: MapState, fn: MapFn) {
  if (s.map && s.ready) fn(s.map);
  else s.queue.push(fn);
}

function placesGeoJson(places: Place[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((p, i) => ({
      type: "Feature",
      id: i,
      properties: { i, name: p.name, country: p.country },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
}

function firesGeoJson(fires: FiresFile | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (fires?.bins ?? []).map(([lon, lat, count, frp]) => ({
      type: "Feature",
      properties: { count, frp },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

function gibsTiles(key: GibsLayerKey, date: string): { tiles: string[]; maxzoom: number } {
  return { tiles: [gibsTileUrl(key, date)], maxzoom: GIBS_LAYERS[key].level };
}

/** Raster goes under every label: the first symbol layer of the basemap style. */
function gibsBeforeId(map: MapLibreMap): string {
  return (map.getStyle().layers ?? []).find((l) => l.type === "symbol")?.id ?? L_PLACES;
}

function removeGibs(map: MapLibreMap) {
  if (map.getLayer(L_GIBS)) map.removeLayer(L_GIBS);
  if (map.getSource(SRC_GIBS)) map.removeSource(SRC_GIBS);
}

/** Everything the map-side handlers need from the latest render. */
interface Latest {
  places: Place[];
  risk: RiskFile | null;
  trends: TrendsFile | null;
  fires: FiresFile | null;
  colouring: Colouring;
  onSelect: (i: number | null) => void;
}

function valueText(l: Latest, i: number): string {
  if (l.colouring.kind === "risk") {
    const r = l.risk?.now[i];
    return r ? hazardText(l.colouring.hazard, r) : "no assessment";
  }
  if (!l.trends) return "no trend";
  return trendText(l.trends, i, l.trends.variables.indexOf(l.colouring.variable));
}

export default function Globe(props: GlobeProps) {
  const {
    places, risk, trends, fires, mode, hazard, trendVar, selected, onSelect, flyTo, gibsLayer, gibsDate,
    onGibsChange, continent = null,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // view state only (what the 404 fallback resolved to), never app state
  const [gibsValid, setGibsValid] = useState<GibsValid | null>(null);
  // view state: the legend swaps the low mark (dot / ring) with the zoom (KI-2)
  const [zoom, setZoom] = useState(ZOOM_GLOBAL);
  // view state: F1 band B fires on/off toggle (heatmap + glow + dots)
  const [firesOn, setFiresOn] = useState(true);
  const tipRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<MapState>({ map: null, ready: false, queue: [] });
  const latestRef = useRef<Latest | null>(null);

  const colouring = useMemo(
    () => pickColouring(mode, hazard, trendVar, trends, risk),
    [mode, hazard, trendVar, trends, risk],
  );

  useEffect(() => {
    latestRef.current = { places, risk, trends, fires, colouring, onSelect };
  });

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const s = stateRef.current;
    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      center: CENTER_WORLD,
      zoom: ZOOM_GLOBAL,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    s.map = map;
    s.ready = false;
    map.on("zoom", () => {
      const z = quantZoom(map.getZoom());
      setZoom((prev) => (prev === z ? prev : z));
    });

    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
      map.setSky({ "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 0] });
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type !== "symbol") continue;
        if (KEEP_LABEL.test(layer.id)) map.setPaintProperty(layer.id, "text-opacity", 0.55);
        else map.setLayoutProperty(layer.id, "visibility", "none");
      }
    });

    map.on("load", () => {
      map.addSource(SRC_PLACES, { type: "geojson", data: placesGeoJson([]) });
      map.addSource(SRC_FIRES, { type: "geojson", data: firesGeoJson(null) });

      map.addLayer({
        id: L_PLACES,
        type: "circle",
        source: SRC_PLACES,
        paint: PLACE_PAINT,
      });
      map.addLayer({
        id: L_SELECTED,
        type: "circle",
        source: SRC_PLACES,
        filter: NO_SELECTION,
        paint: {
          "circle-radius": SELECTED_RADIUS,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": P.ink,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: L_FIRE_GLOW,
        type: "circle",
        source: SRC_FIRES,
        paint: {
          "circle-color": FIRE_FILL,
          "circle-radius": FIRE_GLOW_RADIUS,
          "circle-opacity": fadeInDots(0.18),
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: L_FIRE_DOT,
        type: "circle",
        source: SRC_FIRES,
        // small cells draw over big ones so a single detection next to a 100-cell stays hittable
        layout: { "circle-sort-key": ["-", 0, ["get", "count"]] },
        paint: {
          "circle-color": FIRE_FILL,
          "circle-radius": FIRE_DOT_RADIUS,
          "circle-stroke-color": FIRE_STROKE,
          "circle-stroke-width": 1.2,
          "circle-opacity": fadeInDots(1),
          "circle-stroke-opacity": fadeInDots(1),
        },
      });
      // F1: density view at world zoom, inserted under the places (and so under the fire glow and
      // dots) so the hazard dots stay readable; no hit-test, hovering the heatmap does nothing
      map.addLayer({ id: L_FIRE_HEAT, type: "heatmap", source: SRC_FIRES, paint: FIRE_HEAT_PAINT }, L_PLACES);

      // hover tooltip + click, driven straight off the DOM (no React state).
      // One map-level handler queries both hit layers; a place wins over a fire
      // cell under the same pixel (places are clickable, cells are not, KI-1).
      const tip = tipRef.current;
      const hide = () => {
        map.getCanvas().style.cursor = "";
        if (tip) tip.style.display = "none";
      };
      const line = (text: string, className: string) => {
        const el = document.createElement("div");
        el.className = className;
        el.textContent = text;
        return el;
      };
      const show = (e: MapMouseEvent) => {
        const l = latestRef.current;
        if (!tip || !l) { hide(); return; }
        const hits = map.queryRenderedFeatures(e.point, { layers: [L_PLACES, L_FIRE_DOT] });
        const placeHit = hits.find((f) => f.layer.id === L_PLACES);
        const fireHit = hits.find((f) => f.layer.id === L_FIRE_DOT);
        const i = placeHit ? Number(placeHit.id) : -1;
        const place = l.places[i];
        tip.replaceChildren();
        if (place) {
          map.getCanvas().style.cursor = "pointer";
          const name = line(`${place.name} `, "text-ink");
          const country = document.createElement("span");
          country.className = "text-muted";
          country.textContent = place.country;
          name.appendChild(country);
          tip.append(name, line(valueText(l, i), "font-mono text-ink-2"));
        } else if (fireHit && l.fires) {
          map.getCanvas().style.cursor = "";
          const { count, frp } = fireHit.properties as { count: number; frp: number };
          const [lon, lat] = (fireHit.geometry as GeoJSON.Point).coordinates;
          tip.append(
            line(`${fmtCount(count)} active fire ${count === 1 ? "detection" : "detections"} · ${FIRE_CELL_DEG}° cell`, "text-ink"),
            line(`max FRP ${fmtFrp(frp)} MW · centre ${fmtCentre(lon, lat)}`, "font-mono text-ink-2"),
            line(`observation · ${fireSourceLabel(l.fires.source)} · newest ${fmtAcq(l.fires.newest_acq)}`, "text-muted"),
          );
        } else { hide(); return; }
        const { x, y } = e.point;
        const flip = x > container.clientWidth * 0.62;
        tip.style.left = flip ? "auto" : `${x + 12}px`;
        tip.style.right = flip ? `${container.clientWidth - x + 12}px` : "auto";
        tip.style.top = `${y - 10}px`;
        tip.style.display = "block";
      };
      map.on("mousemove", show);
      map.on("mouseout", hide);
      map.on("click", L_PLACES, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (f) latestRef.current?.onSelect(Number(f.id));
      });

      s.ready = true;
      const queue = s.queue.splice(0);
      for (const fn of queue) fn(map);
    });

    return () => {
      s.ready = false;
      s.map = null;
      s.queue = [];
      map.remove();
    };
  }, []);

  // ---- places source ------------------------------------------------------
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      const src = map.getSource(SRC_PLACES) as GeoJSONSource | undefined;
      src?.setData(placesGeoJson(places));
    });
  }, [places]);

  // ---- colour + radius via feature state (continent filter dims the rest) --
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      const states = pointStates(colouring, places.length, risk, trends, continentSet(places, continent));
      for (let i = 0; i < states.length; i++) {
        map.setFeatureState({ source: SRC_PLACES, id: i }, states[i]);
      }
    });
  }, [places, risk, trends, colouring, continent]);

  // ---- selected ring ------------------------------------------------------
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      map.setFilter(L_SELECTED, selected == null ? NO_SELECTION : ["==", ["id"], selected]);
    });
  }, [selected]);

  // ---- fires --------------------------------------------------------------
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      const src = map.getSource(SRC_FIRES) as GeoJSONSource | undefined;
      src?.setData(firesGeoJson(fires));
    });
  }, [fires]);

  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      for (const id of [L_FIRE_HEAT, L_FIRE_GLOW, L_FIRE_DOT]) {
        map.setLayoutProperty(id, "visibility", firesOn ? "visible" : "none");
      }
    });
  }, [firesOn]);

  // ---- zoom buttons (F1 band B) --------------------------------------------
  const zoomBy = (d: number) => stateRef.current.map?.easeTo({ zoom: stateRef.current.map.getZoom() + d, duration: 300 });
  const resetView = () => stateRef.current.map?.flyTo({ center: CENTER_WORLD, zoom: ZOOM_GLOBAL, speed: 1.2 });

  // ---- fly-to -------------------------------------------------------------
  useEffect(() => {
    if (!flyTo) return;
    runWhenReady(stateRef.current, (map) => {
      map.flyTo({
        center: [flyTo.lon, flyTo.lat],
        zoom: Math.max(map.getZoom(), flyTo.zoom ?? ZOOM_FLY_MIN),
        speed: 0.9,
      });
    });
  }, [flyTo]);

  // ---- GIBS raster overlay (PRD M1) ---------------------------------------
  // Resolve the day first (a 404 day steps back, ./gibs), then swap the
  // raster source; the previous image stays up while the probe runs.
  useEffect(() => {
    if (!gibsLayer) {
      // gibsValid is left as is: every reader checks its key/requested against the props
      runWhenReady(stateRef.current, removeGibs);
      return;
    }
    let cancelled = false;
    const key = gibsLayer;
    const requested = clampGibsDate(key, gibsDate);
    resolveGibsDate(key, requested).then((res) => {
      if (cancelled) return;
      setGibsValid(res);
      runWhenReady(stateRef.current, (map) => {
        if (cancelled) return;
        removeGibs(map);
        if (!res.valid) return;
        const { tiles, maxzoom } = gibsTiles(key, res.valid);
        map.addSource(SRC_GIBS, { type: "raster", tiles, tileSize: 256, maxzoom, attribution: "NASA GIBS" });
        map.addLayer(
          { id: L_GIBS, type: "raster", source: SRC_GIBS, paint: { "raster-opacity": 0.55 } },
          gibsBeforeId(map),
        );
      });
    });
    return () => { cancelled = true; };
  }, [gibsLayer, gibsDate]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* MapLibre CSS forces position:relative on the map, so inset is inline */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        ref={tipRef}
        role="tooltip"
        className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-[11px] leading-snug backdrop-blur"
        style={{ display: "none" }}
      />
      <Legend
        colouring={colouring} fires={fires} firesOn={firesOn} zoom={zoom}
        gibs={gibsLayer && gibsValid?.key === gibsLayer ? gibsValid : null}
      />
      <MapControls
        firesOn={firesOn}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onReset={resetView}
        onToggleFires={() => setFiresOn((v) => !v)}
      />
      {onGibsChange && <GibsControl layer={gibsLayer} date={gibsDate} valid={gibsValid} onChange={onGibsChange} />}
    </div>
  );
}
