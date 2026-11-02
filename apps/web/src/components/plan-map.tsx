"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { DayMap, MapPin } from "@expeditionplan/core";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

/**
 * Mapa dnia w edytorze (MVP-3): pinezki z numerami kolejności z silnika, linia między kolejnymi
 * miejscami (prosta — trasa jest tylko w czasie przejazdu), baza dnia i szare kropki z puli.
 * Kafle OpenFreeMap bez klucza (docs/USLUGI.md); MapLibre ładuje się dopiero w przeglądarce.
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

type Props = { map: DayMap; selected: string | null; onSelect: (ref: string) => void };

export function PlanMap({ map: data, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const markers = useRef<{ pin: MapPin; marker: Marker }[]>([]);
  const fitted = useRef<string | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | undefined;
    void import("maplibre-gl").then(
      (maplibre) => {
        if (cancelled || container.current === null) return;
        // Worker MapLibre to osobny plik; po bundlowaniu jego adres nie wynika już z adresu modułu.
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        created = new maplibre.Map({ container: container.current, style: STYLE, center: [15, 35], zoom: 1, attributionControl: { compact: true } });
        created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        created.on("error", (event) => console.warn("Mapa:", event.error?.message));
        created.on("load", () => {
          if (cancelled || created === undefined) return;
          polishLabels(created);
          created.addSource("path", { type: "geojson", data: line([]) });
          created.addLayer({
            id: "path",
            type: "line",
            source: "path",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2e7d74", "line-width": 3, "line-opacity": 0.8, "line-dasharray": [2, 1.5] },
          });
          setMap(created);
        });
      },
      (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
      created?.remove();
    };
  }, []);

  // Dane dnia: linia, pinezki, a przy zmianie zestawu miejsc — dopasowanie widoku.
  useEffect(() => {
    if (map === null) return;
    void import("maplibre-gl").then((maplibre) => {
      (map.getSource("path") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(line(data.path));
      for (const { marker } of markers.current) marker.remove();
      markers.current = data.pins.map((pin) => {
        const element = pinElement(pin);
        const first = pin.stops[0]?.ref ?? pin.pool?.[0]?.ref;
        if (first !== undefined) element.addEventListener("click", () => select.current(first));
        return { pin, marker: new maplibre.Marker({ element }).setLngLat([pin.lng, pin.lat]).addTo(map) };
      });
      const key = data.pins.map((pin) => pin.placeRef).join(",");
      if (fitted.current === key) return;
      fitted.current = key;
      const main = data.pins.filter((pin) => pin.stops.length > 0 || pin.base);
      const focus = main.length > 0 ? main : data.pins;
      if (focus.length === 0) return;
      const bounds = new maplibre.LngLatBounds();
      for (const pin of focus) bounds.extend([pin.lng, pin.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
    });
  }, [map, data]);

  // Wybrany punkt: wyróżniona pinezka, a gdy jest poza widokiem — przesunięcie mapy.
  useEffect(() => {
    if (map === null) return;
    for (const { pin, marker } of markers.current) {
      const active = selected !== null && (pin.stops.some((stop) => stop.ref === selected) || (pin.pool ?? []).some((each) => each.ref === selected));
      const element = marker.getElement();
      element.dataset.active = String(active);
      element.style.zIndex = active ? "10" : "";
      if (active && !map.getBounds().contains([pin.lng, pin.lat])) map.easeTo({ center: [pin.lng, pin.lat], duration: 500 });
    }
  }, [map, selected, data]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border border-zinc-200 lg:h-[calc(100vh-8rem)] dark:border-zinc-800">
      {/* Nie `absolute inset-0`: CSS MapLibre (poza warstwami Tailwinda) ustawia `position: relative`. */}
      <div ref={container} className="h-full w-full" />
      {failure && <p className="absolute inset-x-0 top-0 bg-red-50 p-2 text-xs text-red-700">Mapa się nie wczytała: {failure}</p>}
      {map !== null && data.pins.length === 0 && (
        <p className="absolute inset-x-4 top-4 rounded bg-white/90 p-2 text-center text-xs text-zinc-600 shadow dark:bg-zinc-900/90 dark:text-zinc-300">
          Żaden punkt tego dnia nie ma miejsca ze współrzędnymi.
        </p>
      )}
    </div>
  );
}

function line(path: [number, number][]) {
  return { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: path } };
}

/** Pinezka: numery punktów dnia („3 · 4”), baza dnia albo szara kropka z puli. */
function pinElement(pin: MapPin): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  const titles = [...pin.stops.map((stop) => `${stop.n}. ${stop.title}`), ...(pin.pool ?? []).map((each) => `pula: ${each.title}`)];
  element.title = [pin.name, ...titles, ...(pin.base ? ["baza dnia"] : [])].join("\n");
  const ring = "border-2 border-white shadow-md transition data-[active=true]:scale-125 data-[active=true]:ring-4 data-[active=true]:ring-signal/60";
  if (pin.stops.length > 0) {
    element.textContent = ranges(pin.stops.map((stop) => stop.n));
    element.className = `flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${pin.base ? "bg-indigo-500" : "bg-sea"} ${ring}`;
  } else if (pin.base) {
    element.textContent = "⌂";
    element.className = `flex size-6 cursor-pointer items-center justify-center rounded-full bg-indigo-500 text-sm text-white ${ring}`;
  } else {
    element.className = `size-3 cursor-pointer rounded-full bg-zinc-400 ${ring}`;
  }
  return element;
}

/** [2, 3, 4, 7] → „2–4 · 7” — powrót do noclegu nie robi z pinezki długiego paska. */
function ranges(numbers: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${numbers[i]}–${numbers[j]}` : numbers.slice(i, j + 1).join(" · "));
    i = j;
  }
  return parts.join(" · ");
}

/** Napisy po polsku tam, gdzie OSM ma `name:pl` — reszta zostaje w nazwie lokalnej. */
function polishLabels(map: MapLibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const field = map.getLayoutProperty(layer.id, "text-field");
    if (field === undefined || !JSON.stringify(field).includes("name")) continue;
    map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pl"], ["get", "name"]]);
  }
}
