"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { DayMap, MapLine, MapPin } from "@expeditionplan/core";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Mapa dnia w edytorze (MVP-3): pinezki z numerami kolejności z silnika, linia dnia (ciągła po
 * drogach, gdy przejazd ma trasę z ORS, przerywana prosto między resztą miejsc), baza dnia i szare
 * kropki z puli. Przy edycji: kliknięcie mapy wskazuje miejsce nowego punktu, a własne pinezki
 * (`provider: 'user'`) da się przeciągnąć. Kafle OpenFreeMap bez klucza (docs/USLUGI.md);
 * MapLibre ładuje się dopiero w przeglądarce.
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

export type LatLng = { lat: number; lng: number };

/** Edycja na mapie: wskazywanie miejsca nowego punktu (`picking`) i przesuwanie własnych pinezek. */
export type MapEditing = {
  picking: boolean;
  picked: LatLng | null;
  onPick: (at: LatLng) => void;
  onMovePlace: (placeRef: string, at: LatLng) => void;
};

type Props = {
  map: DayMap;
  /** Zmiana klucza (inny dzień) dopasowuje widok do pinezek; nowy punkt widoku nie rusza. */
  fitKey: string;
  selected: string | null;
  onSelect: (ref: string) => void;
  editing?: MapEditing | null;
};

export function PlanMap({ map: full, fitKey: dayKey, selected, onSelect, editing = null }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Dojazd i powrót (lot, długa droga) domyślnie ukryte — skala kraju gubi szczegóły na miejscu.
  const [showTransit, setShowTransit] = useState(false);
  const hasTransit = full.pins.some((pin) => pin.transit) || full.lines.some((line) => line.transit);
  const data = useMemo(
    () => (showTransit ? full : { ...full, pins: full.pins.filter((pin) => !pin.transit), lines: full.lines.filter((line) => !line.transit) }),
    [full, showTransit],
  );
  const fitKey = `${dayKey}:${showTransit && hasTransit}`;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const markers = useRef<{ pin: MapPin; marker: Marker }[]>([]);
  const draft = useRef<Marker | null>(null);
  const fitted = useRef<string | null>(null);
  /** Licznik pokazań kontenera (rozmiar z 0 na >0) — wtedy dopasowanie widoku od nowa. */
  const [shown, setShown] = useState(0);
  const select = useRef(onSelect);
  const edit = useRef(editing);
  const chosen = useRef(selected);
  useEffect(() => {
    select.current = onSelect;
    edit.current = editing;
    chosen.current = selected;
  });

  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | undefined;
    void import("maplibre-gl").then(
      (maplibre) => {
        if (cancelled || container.current === null) return;
        // Worker MapLibre to osobny plik; po bundlowaniu jego adres nie wynika już z adresu modułu.
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        created = new maplibre.Map({
          container: container.current,
          style: STYLE,
          center: [15, 35],
          zoom: 1,
          attributionControl: { compact: true, customAttribution: '<a href="https://openrouteservice.org/" target="_blank">Trasy: openrouteservice.org</a>' },
        });
        created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        created.on("error", (event) => console.warn("Mapa:", event.error?.message));
        created.on("click", (event) => {
          if (edit.current?.picking) edit.current.onPick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
        });
        created.on("load", () => {
          if (cancelled || created === undefined) return;
          polishLabels(created);
          created.addSource("path", { type: "geojson", data: lines([]) });
          // Prosto między miejscami — przerywana; trasa po drogach z ORS — ciągła.
          created.addLayer({
            id: "path-straight",
            type: "line",
            source: "path",
            filter: ["!", ["get", "routed"]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2e7d74", "line-width": 3, "line-opacity": 0.7, "line-dasharray": [2, 1.5] },
          });
          created.addLayer({
            id: "path-routed",
            type: "line",
            source: "path",
            filter: ["get", "routed"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#2e7d74", "line-width": 4, "line-opacity": 0.9 },
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

  // Dane dnia: linia, pinezki, a przy zmianie dnia — dopasowanie widoku.
  const movable = editing !== null;
  useEffect(() => {
    if (map === null) return;
    void import("maplibre-gl").then((maplibre) => {
      (map.getSource("path") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(lines(data.lines));
      for (const { marker } of markers.current) marker.remove();
      markers.current = data.pins.map((pin) => {
        const element = pinElement(pin);
        const first = pin.stops[0]?.ref ?? pin.pool?.[0]?.ref;
        if (first !== undefined) element.addEventListener("click", () => select.current(first));
        const draggable = movable && pin.movable === true;
        if (draggable) element.title += "\n(przeciągnij, żeby przesunąć)";
        const marker = new maplibre.Marker({ element, draggable }).setLngLat([pin.lng, pin.lat]).addTo(map);
        if (draggable) {
          marker.on("dragend", () => {
            const at = marker.getLngLat();
            edit.current?.onMovePlace(pin.placeRef, { lat: at.lat, lng: at.lng });
          });
        }
        return { pin, marker };
      });
      // Pinezki powstają po `import()` — wyróżnienie musi dostać też nowa pinezka wybranego punktu.
      highlight(markers.current, chosen.current);
      if (fitted.current === fitKey) return;
      // Ukryty kontener (powrót na stronę zachowaną przez Next, zwinięty układ) ma rozmiar 0 —
      // dopasowanie dałoby widok całego świata; czekamy, aż kontener się pokaże.
      if (container.current === null || container.current.clientWidth === 0 || container.current.clientHeight === 0) return;
      const main = data.pins.filter((pin) => pin.stops.length > 0 || pin.base);
      const focus = main.length > 0 ? main : data.pins;
      if (focus.length === 0) return;
      fitted.current = fitKey;
      const bounds = new maplibre.LngLatBounds();
      for (const pin of focus) bounds.extend([pin.lng, pin.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 600 });
    });
  }, [map, data, fitKey, movable, shown]);

  // Kontener zmienia rozmiar: mapa się przelicza, a po pokazaniu z ukrycia — dopasowuje od nowa.
  useEffect(() => {
    const element = container.current;
    if (map === null || element === null) return;
    let hidden = element.clientWidth === 0 || element.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const now = element.clientWidth === 0 || element.clientHeight === 0;
      if (!now) map.resize();
      if (hidden && !now) {
        fitted.current = null;
        setShown((count) => count + 1);
      }
      hidden = now;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map]);

  // Wybrany punkt: wyróżniona pinezka, a gdy jest poza widokiem — przesunięcie mapy.
  useEffect(() => {
    if (map === null) return;
    const pin = highlight(markers.current, selected);
    if (pin !== undefined && !map.getBounds().contains([pin.lng, pin.lat])) map.easeTo({ center: [pin.lng, pin.lat], duration: 500 });
  }, [map, selected, data]);

  // Wskazywanie miejsca nowego punktu: celownik zamiast rączki i znacznik wskazanego miejsca.
  const picking = editing?.picking ?? false;
  const picked = editing?.picked ?? null;
  useEffect(() => {
    if (map === null) return;
    map.getCanvas().style.cursor = picking ? "crosshair" : "";
    void import("maplibre-gl").then((maplibre) => {
      draft.current?.remove();
      draft.current = picked === null ? null : new maplibre.Marker({ color: "#e0662f" }).setLngLat([picked.lng, picked.lat]).addTo(map);
    });
  }, [map, picking, picked]);

  return (
    <div className={`relative h-72 w-full overflow-hidden rounded-xl border border-zinc-200 lg:h-[calc(100vh-8rem)] dark:border-zinc-800 ${picking ? "ring-2 ring-signal" : ""}`}>
      {/* Nie `absolute inset-0`: CSS MapLibre (poza warstwami Tailwinda) ustawia `position: relative`. */}
      <div ref={container} className="h-full w-full" />
      {failure && <p className="absolute inset-x-0 top-0 bg-red-50 p-2 text-xs text-red-700">Mapa się nie wczytała: {failure}</p>}
      {hasTransit && !picking && (
        <button
          onClick={() => setShowTransit((value) => !value)}
          aria-pressed={showTransit}
          title={showTransit ? "Ukryj dojazd i powrót — mapa skupi się na miejscu" : "Pokaż dojazd i powrót (lot, długa droga)"}
          className={`absolute top-2 left-2 rounded-full px-3 py-1 text-xs font-semibold shadow ${showTransit ? "bg-sea text-white" : "bg-white/95 text-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"}`}>
          ✈ Dojazd i powrót
        </button>
      )}
      {picking && (
        <p className="absolute inset-x-4 top-4 rounded bg-white/90 p-2 text-center text-xs text-zinc-700 shadow dark:bg-zinc-900/90 dark:text-zinc-200">
          {picked === null ? "Kliknij mapę w miejscu nowego punktu." : "Wpisz nazwę pod mapą albo kliknij inne miejsce."}
        </p>
      )}
      {map !== null && data.pins.length === 0 && !picking && (
        <p className="absolute inset-x-4 top-4 rounded bg-white/90 p-2 text-center text-xs text-zinc-600 shadow dark:bg-zinc-900/90 dark:text-zinc-300">
          Żaden punkt tego dnia nie ma miejsca ze współrzędnymi.
        </p>
      )}
    </div>
  );
}

/** Wyróżnia pinezkę z wybranym punktem (dnia albo z puli); zwraca ją. */
function highlight(markers: { pin: MapPin; marker: Marker }[], selected: string | null): MapPin | undefined {
  let found: MapPin | undefined;
  for (const { pin, marker } of markers) {
    const active = selected !== null && (pin.stops.some((stop) => stop.ref === selected) || (pin.pool ?? []).some((each) => each.ref === selected));
    const element = marker.getElement();
    element.dataset.active = String(active);
    element.style.zIndex = active ? "10" : "";
    if (active) found = pin;
  }
  return found;
}

function lines(parts: MapLine[]) {
  return {
    type: "FeatureCollection" as const,
    features: parts.map((part) => ({ type: "Feature" as const, properties: { routed: part.routed }, geometry: { type: "LineString" as const, coordinates: part.coordinates } })),
  };
}

/**
 * Pinezka: numery punktów dnia („3 · 4”), baza dnia albo szara kropka z puli. Zewnętrzny element
 * należy do MapLibre (pozycja przez `transform`) — wygląd, powiększenie i animacja są na
 * wewnętrznym. Inaczej `scale` (Tailwind 4: osobna właściwość CSS) mnoży też przesunięcie
 * pinezki, a `transition` animuje jej pozycję przy każdym ruchu mapy.
 */
function pinElement(pin: MapPin): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "group cursor-pointer";
  const titles = [...pin.stops.map((stop) => `${stop.n}. ${stop.title}`), ...(pin.pool ?? []).map((each) => `pula: ${each.title}`)];
  element.title = [pin.name, ...titles, ...(pin.base ? ["nocleg"] : [])].join("\n");
  const face = document.createElement("span");
  const ring = "border-2 border-white shadow-md transition-[scale,box-shadow] group-data-[active=true]:scale-125 group-data-[active=true]:ring-4 group-data-[active=true]:ring-signal/60";
  if (pin.stops.length > 0) {
    face.textContent = ranges(pin.stops.map((stop) => stop.n));
    face.className = `flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${pin.base ? "bg-indigo-500" : "bg-sea"} ${ring}`;
  } else if (pin.base) {
    face.textContent = "⌂";
    face.className = `flex size-6 items-center justify-center rounded-full bg-indigo-500 text-sm text-white ${ring}`;
  } else {
    face.className = `block size-3 rounded-full bg-zinc-400 ${ring}`;
  }
  element.append(face);
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
