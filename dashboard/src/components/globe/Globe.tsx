"use client";
// Globe.tsx · DESIGN.md §4, contracts.md §5. MapLibre globe with places
// coloured by the selected hazard (mode "next14") or by the selected trend
// variable's 10-year slope (mode "now"), live FIRMS bins on top, optional
// GIBS raster underneath. Owns no React state: everything is props → map.
import { useEffect, useMemo, useRef } from "react";
import {
  Map as MapLibreMap, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibre-worker";
import { P } from "@/lib/palette";
import type { FiresFile, Hazard, Mode, Place, RiskFile, TrendsFile, Variable } from "@/lib/types";
import Legend from "./Legend";
import { hazardText, pickColouring, pointStates, trendText, type Colouring } from "./colour";

if (typeof window !== "undefined") setWorkerUrl(MAPLIBRE_WORKER_URL);

export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
export const ZOOM_GLOBAL = 1.6;
export const ZOOM_REGIONAL = 2.7;
export const ZOOM_FLY_MIN = 5.2;

/** Pass a new object to fly again; identity change triggers the flight. */
export interface FlyTarget {
  lon: number;
  lat: number;
  zoom?: number;
}

/**
 * GIBS WMTS layers the overlay can show (M1). Key is what `gibsLayer` takes.
 * `level` is the layer's GoogleMapsCompatible tile set; `lagDays` is how far
 * behind today the newest daily image usually is (checked 14 Nov 2026).
 */
export const GIBS_LAYERS = {
  rain: { id: "IMERG_Precipitation_Rate", ext: "png", level: 6, lagDays: 2, label: "rain rate (IMERG)" },
  ndvi: { id: "MODIS_Terra_NDVI_8Day", ext: "png", level: 9, lagDays: 1, label: "vegetation (MODIS NDVI)" },
  lst: { id: "MODIS_Terra_Land_Surface_Temp_Day", ext: "png", level: 7, lagDays: 1, label: "surface temp (MODIS LST)" },
  truecolor: { id: "MODIS_Terra_CorrectedReflectance_TrueColor", ext: "jpg", level: 9, lagDays: 1, label: "true colour (MODIS)" },
} as const;
export type GibsLayerKey = keyof typeof GIBS_LAYERS;

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
  gibsLayer: GibsLayerKey | null;
  gibsDate: string | null; // YYYY-MM-DD; defaults to today minus the layer's lag
}

const SRC_PLACES = "places";
const SRC_FIRES = "fires";
const SRC_GIBS = "gibs";
const L_PLACES = "places";
const L_SELECTED = "places-selected";
const L_FIRE_GLOW = "fires-glow";
const L_FIRE_DOT = "fires-dot";
const L_GIBS = "gibs";

const RADIUS: ExpressionSpecification = [
  "interpolate", ["linear"], ["coalesce", ["feature-state", "v"], 0], 0, 3, 1, 11,
];
const SELECTED_RADIUS: ExpressionSpecification = ["*", 1.5, RADIUS];
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

export function gibsDefaultDate(key: GibsLayerKey): string {
  return new Date(Date.now() - GIBS_LAYERS[key].lagDays * 86_400_000).toISOString().slice(0, 10);
}

function gibsTiles(key: GibsLayerKey, date: string): { tiles: string[]; maxzoom: number } {
  const l = GIBS_LAYERS[key];
  return {
    tiles: [
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.id}/default/${date}/GoogleMapsCompatible_Level${l.level}/{z}/{y}/{x}.${l.ext}`,
    ],
    maxzoom: l.level,
  };
}

/** Everything the map-side handlers need from the latest render. */
interface Latest {
  places: Place[];
  risk: RiskFile | null;
  trends: TrendsFile | null;
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
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<MapState>({ map: null, ready: false, queue: [] });
  const latestRef = useRef<Latest | null>(null);

  const colouring = useMemo(
    () => pickColouring(mode, hazard, trendVar, trends, risk),
    [mode, hazard, trendVar, trends, risk],
  );

  useEffect(() => {
    latestRef.current = { places, risk, trends, colouring, onSelect };
  });

  // ---- create the map once ------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const s = stateRef.current;
    const map = new MapLibreMap({
      container,
      style: STYLE_URL,
      center: [20, 15],
      zoom: ZOOM_GLOBAL,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    s.map = map;
    s.ready = false;

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
        paint: {
          "circle-radius": RADIUS,
          "circle-color": ["coalesce", ["feature-state", "color"], P.muted],
          "circle-opacity": ["coalesce", ["feature-state", "o"], 0.5],
          "circle-stroke-color": "rgba(0,0,0,0.6)",
          "circle-stroke-width": 1,
        },
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
          "circle-color": "#fff7ed",
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 6, 60, 18],
          "circle-opacity": 0.18,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: L_FIRE_DOT,
        type: "circle",
        source: SRC_FIRES,
        paint: {
          "circle-color": "#fff7ed",
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 2.2, 60, 5],
          "circle-stroke-color": "#d03b3b",
          "circle-stroke-width": 1.2,
        },
      });

      // hover tooltip + click, driven straight off the DOM (no React state)
      const tip = tipRef.current;
      const hide = () => {
        map.getCanvas().style.cursor = "";
        if (tip) tip.style.display = "none";
      };
      const show = (e: MapMouseEvent) => {
        const f = map.queryRenderedFeatures(e.point, { layers: [L_PLACES] })[0];
        const l = latestRef.current;
        const i = f ? Number(f.id) : -1;
        const place = l?.places[i];
        if (!f || !tip || !l || !place) { hide(); return; }
        map.getCanvas().style.cursor = "pointer";
        tip.replaceChildren();
        const name = document.createElement("div");
        name.className = "text-ink";
        name.textContent = `${place.name} `;
        const country = document.createElement("span");
        country.className = "text-muted";
        country.textContent = place.country;
        name.appendChild(country);
        const value = document.createElement("div");
        value.className = "font-mono text-ink-2";
        value.textContent = valueText(l, i);
        tip.append(name, value);
        const { x, y } = e.point;
        const flip = x > container.clientWidth * 0.62;
        tip.style.left = flip ? "auto" : `${x + 12}px`;
        tip.style.right = flip ? `${container.clientWidth - x + 12}px` : "auto";
        tip.style.top = `${y - 10}px`;
        tip.style.display = "block";
      };
      map.on("mousemove", L_PLACES, show);
      map.on("mouseleave", L_PLACES, hide);
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

  // ---- colour + radius via feature state ----------------------------------
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      const states = pointStates(colouring, places.length, risk, trends);
      for (let i = 0; i < states.length; i++) {
        map.setFeatureState({ source: SRC_PLACES, id: i }, states[i]);
      }
    });
  }, [places, risk, trends, colouring]);

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

  // ---- GIBS raster overlay ------------------------------------------------
  useEffect(() => {
    runWhenReady(stateRef.current, (map) => {
      if (map.getLayer(L_GIBS)) map.removeLayer(L_GIBS);
      if (map.getSource(SRC_GIBS)) map.removeSource(SRC_GIBS);
      if (!gibsLayer) return;
      const { tiles, maxzoom } = gibsTiles(gibsLayer, gibsDate ?? gibsDefaultDate(gibsLayer));
      map.addSource(SRC_GIBS, { type: "raster", tiles, tileSize: 256, maxzoom, attribution: "NASA GIBS" });
      map.addLayer(
        { id: L_GIBS, type: "raster", source: SRC_GIBS, paint: { "raster-opacity": 0.55 } },
        L_PLACES,
      );
    });
  }, [gibsLayer, gibsDate]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* MapLibre CSS forces position:relative on the map, so inset is inline */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        ref={tipRef}
        className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-[11px] leading-snug backdrop-blur"
        style={{ display: "none" }}
      />
      <Legend colouring={colouring} />
    </div>
  );
}
