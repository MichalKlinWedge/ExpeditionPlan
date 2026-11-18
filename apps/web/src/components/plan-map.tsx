"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { DayMap, MapLine, MapPin, TripMapPhotoPin } from "@expeditionplan/core";
import type { LngLatBoundsLike, Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Mapa dnia w edytorze (MVP-3): pinezki z numerami kolejności z silnika, linia dnia (ciągła po
 * drogach, gdy przejazd ma trasę z ORS, przerywana prosto między resztą miejsc), baza dnia i szare
 * kropki z puli. Przy edycji: kliknięcie mapy wskazuje miejsce nowego punktu, a własne pinezki
 * (`provider: 'user'`) da się przeciągnąć. Kafle OpenFreeMap bez klucza (docs/USLUGI.md);
 * MapLibre ładuje się dopiero w przeglądarce.
 */

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const FIT = { padding: 48, maxZoom: 15 };
/** Przybliżenie po „wyśrodkuj na wybranym punkcie” (ulice i budynki). */
const FOCUS_ZOOM = 16;

/** Prostokąt obejmujący punkty dnia (i podane linie); szare kropki z puli liczą się tylko, gdy nie ma innych pinezek. */
function boundsOf(all: MapPin[], lines: readonly { coordinates: readonly (readonly number[])[] }[] = []): LngLatBoundsLike | null {
  // Dojazd i start z domu (`approach`) zostają na mapie, ale widok skupia się na miejscu wyjazdu — chyba że nic innego nie ma.
  const near = all.filter((pin) => !pin.approach);
  const pins = near.length > 0 ? near : all;
  const main = pins.filter((pin) => pin.stops.length > 0 || pin.base || pin.arrival);
  const focus = main.length > 0 ? main : pins;
  if (focus.length === 0) return null;
  const along = lines.flatMap((line) => line.coordinates);
  const lngs = [...focus.map((pin) => pin.lng), ...along.map((point) => point[0]!)];
  const lats = [...focus.map((pin) => pin.lat), ...along.map((point) => point[1]!)];
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export type LatLng = { lat: number; lng: number };

const routeListeners = new Set<(ref: string | null) => void>();
/** Podświetla linię punktu na mapie (najechanie na link do trasy). Poza stanem Reacta: przelicza tylko warstwę, nie cały plan. */
export const highlightRoute = (ref: string | null) => routeListeners.forEach((listener) => listener(ref));

/** Edycja na mapie: wskazywanie miejsca nowego punktu (`picking`) i przesuwanie własnych pinezek. */
export type MapEditing = {
  picking: boolean;
  picked: LatLng | null;
  onPick: (at: LatLng) => void;
  onMovePlace: (placeRef: string, at: LatLng) => void;
  /** Podpowiedź przy wskazywaniu: przed kliknięciem i po nim (domyślnie: nowy punkt planu). */
  hints?: [string, string];
};

type Props = {
  map: DayMap;
  /** Zmiana klucza (inny dzień) dopasowuje widok do pinezek; nowy punkt widoku nie rusza. */
  fitKey: string;
  selected: string | null;
  onSelect: (ref: string) => void;
  editing?: MapEditing | null;
  /** Napis, gdy nie ma pinezek (domyślnie: o punktach dnia). */
  emptyText?: string;
  /** Kwadrat zamiast wysokości ekranu: pod mapą jest treść. */
  square?: boolean;
  /** Prostokąt na szerokość strony: połowa zwykłej wysokości. */
  banner?: boolean;
  /** Dopasowanie widoku na ten punkt zamiast na wszystkie (wejście z odnośnikiem do miejsca, także powrót na zachowaną stronę). */
  focus?: string | null;
  /** Dopasowanie widoku także do linii (mapa jednej trasy: ślad wychodzi daleko poza pinezki). */
  fitLines?: boolean;
  /** Dojazd i powrót widoczne od razu (mapa wyjazdu); przycisk „✈ Dojazd i powrót” je wyłącza. */
  transitShown?: boolean;
  /** Kliknięcie linii trasy punktu (ślad, trasa po drogach, prosta przejazdu) — ref tego punktu. */
  onSelectLine?: (ref: string) => void;
  /** Miniatury zdjęć z dziennika przy miejscach (mapa wyjazdu); kliknięcie — `onSelectPhotos(placeRef)`. */
  photoPins?: readonly TripMapPhotoPin[];
  onSelectPhotos?: (placeRef: string) => void;
};

const NO_PHOTOS: readonly TripMapPhotoPin[] = [];

export function PlanMap({
  map: full,
  fitKey: dayKey,
  selected,
  onSelect,
  editing = null,
  emptyText = "Żaden punkt tego dnia nie ma miejsca ze współrzędnymi.",
  square = false,
  banner = false,
  focus = null,
  fitLines = false,
  transitShown = false,
  onSelectLine,
  photoPins = NO_PHOTOS,
  onSelectPhotos,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Dojazd i powrót (lot, długa droga) domyślnie ukryte — skala kraju gubi szczegóły na miejscu.
  const [showTransit, setShowTransit] = useState(transitShown);
  const hasTransit = full.pins.some((pin) => pin.transit) || full.lines.some((line) => line.transit);
  // Gwiazdki „po drodze i w pobliżu” można schować, gdy zasłaniają plan dnia.
  const [hideExtras, setHideExtras] = useState(false);
  const hasExtras = full.pins.some((pin) => pin.extra !== undefined);
  const data = useMemo(() => {
    const pins = full.pins.filter((pin) => (showTransit || !pin.transit) && !(hideExtras && pin.extra !== undefined));
    return { ...full, pins, lines: showTransit ? full.lines : full.lines.filter((line) => !line.transit) };
  }, [full, showTransit, hideExtras]);
  const fitKey = `${dayKey}:${showTransit && hasTransit}`;
  const selectedPin = data.pins.find((pin) => holds(pin, selected));
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const markers = useRef<{ pin: MapPin; marker: Marker }[]>([]);
  const draft = useRef<Marker | null>(null);
  const fitted = useRef<string | null>(null);
  /** Dopasowanie widoku w toku: zmiana rozmiaru mapy je przerywa, więc wtedy trzeba je dokończyć. */
  const fitting = useRef<LngLatBoundsLike | null>(null);
  /** Licznik pokazań kontenera (rozmiar z 0 na >0) — wtedy dopasowanie widoku od nowa. */
  const [shown, setShown] = useState(0);
  const select = useRef(onSelect);
  const selectLine = useRef(onSelectLine);
  const selectPhotos = useRef(onSelectPhotos);
  const photoMarkers = useRef<Marker[]>([]);
  const edit = useRef(editing);
  const chosen = useRef(selected);
  useEffect(() => {
    select.current = onSelect;
    selectLine.current = onSelectLine;
    selectPhotos.current = onSelectPhotos;
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
          attributionControl: { compact: true, customAttribution:
            '<a href="https://openrouteservice.org/" target="_blank">Trasy: openrouteservice.org</a> · Linie komunikacji: <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> (ODbL), <a href="https://openstreetmap.org/fixthemap" target="_blank">zgłoś błąd</a>',
        },
        });
        created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        created.on("error", (event) => console.warn("Mapa:", event.error?.message));
        created.on("click", (event) => {
          if (edit.current?.picking) edit.current.onPick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
        });
        created.on("load", () => {
          if (cancelled || created === undefined) return;
          polishLabels(created);
          // Na wąskiej mapie (kwadrat obok profilu trasy) rozwinięta atrybucja zasłania pół widoku: zostaje ikona ⓘ, która ją rozwija.
          if ((container.current?.clientWidth ?? Infinity) < 420) container.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
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
          // Szeroka, niewidoczna linia pod kliknięcie trasy (cienką trudno trafić).
          created.addSource("path-hit", { type: "geojson", data: lines([]) });
          created.addLayer({ id: "path-hit", type: "line", source: "path-hit", layout: { "line-cap": "round" }, paint: { "line-color": "#000", "line-width": 16, "line-opacity": 0 } });
          created.on("click", "path-hit", (event) => {
            // Pinezka nad linią: kliknięcie należy do niej, nie do trasy pod spodem.
            if (event.originalEvent.target instanceof Element && event.originalEvent.target.closest(".maplibregl-marker") !== null) return;
            const ref: unknown = event.features?.[0]?.properties?.ref;
            if (typeof ref === "string" && !edit.current?.picking) selectLine.current?.(ref);
          });
          created.on("mouseenter", "path-hit", () => {
            if (selectLine.current !== undefined && created !== undefined) created.getCanvas().style.cursor = "pointer";
          });
          created.on("mouseleave", "path-hit", () => {
            if (created !== undefined && !edit.current?.picking) created.getCanvas().style.cursor = "";
          });
          created.addSource("path-hover", { type: "geojson", data: lines([]) });
          created.addLayer({
            id: "path-hover",
            type: "line",
            source: "path-hover",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#e0662f", "line-width": 6 },
          });
          // Strona zachowana przez Next tworzy mapę od nowa po powrocie: nowa też musi dostać dopasowanie.
          fitted.current = null;
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

  const fitTo = (target: MapLibreMap, bounds: LngLatBoundsLike) => {
    // Najpierw koniec poprzedniego ruchu: jego `moveend` nie może skasować nowego dopasowania.
    target.stop();
    fitting.current = bounds;
    target.once("moveend", () => {
      fitting.current = null;
    });
    target.fitBounds(bounds, { ...FIT, duration: 600 });
  };

  // Ponowne wejście z innym miejscem na zachowanej stronie: dopasowanie od nowa, na to miejsce.
  useEffect(() => {
    if (focus !== null) fitted.current = null;
  }, [focus]);

  // Dane dnia: linia, pinezki, a przy zmianie dnia — dopasowanie widoku.
  const movable = editing !== null;
  useEffect(() => {
    if (map === null) return;
    void import("maplibre-gl").then((maplibre) => {
      (map.getSource("path") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(lines(data.lines));
      for (const { marker } of markers.current) marker.remove();
      markers.current = data.pins.map((pin) => {
        const element = pinElement(pin);
        const first = pin.stops[0]?.ref ?? pin.pool?.[0]?.ref ?? pin.extra?.ref ?? pin.clickRef;
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
      const focused = data.pins.filter((pin) => focus !== null && pin.stops.some((stop) => stop.ref === focus));
      const bounds = focused.length > 0 ? boundsOf(focused) : boundsOf(data.pins, fitLines ? data.lines : []);
      if (bounds === null) return;
      fitted.current = fitKey;
      fitTo(map, bounds);
    });
  }, [map, data, fitKey, movable, shown, focus, fitLines]);

  // Linie do kliknięcia: trasy z punktem i proste przejazdów bez zapisanej trasy.
  const lineClicks = onSelectLine !== undefined;
  useEffect(() => {
    if (map === null) return;
    const parts = lineClicks
      ? [
          ...data.lines.filter((line) => (line.refs?.length ?? 0) > 0).map((line) => ({ coordinates: line.coordinates, ref: line.refs![0]! })),
          ...Object.entries(data.straightLegs ?? {}).map(([ref, coordinates]) => ({ coordinates, ref })),
        ]
      : [];
    (map.getSource("path-hit") as import("maplibre-gl").GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: parts.map((part) => ({ type: "Feature", properties: { ref: part.ref }, geometry: { type: "LineString", coordinates: part.coordinates } })),
    });
  }, [map, data, lineClicks]);

  // Miniatury zdjęć z dziennika: obok pinezki miejsca, z liczbą zdjęć.
  useEffect(() => {
    if (map === null) return;
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled) return;
      for (const marker of photoMarkers.current) marker.remove();
      photoMarkers.current = photoPins.map((pin) => {
        const element = photoElement(pin);
        element.addEventListener("click", () => selectPhotos.current?.(pin.placeRef));
        return new maplibre.Marker({ element, anchor: "bottom-left", offset: [8, -8] }).setLngLat([pin.lng, pin.lat]).addTo(map);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [map, photoPins]);

  // Najechanie na link do trasy: ślad, trasa po drogach albo kawałek prostej tego punktu w kolorze sygnałowym.
  useEffect(() => {
    if (map === null) return;
    const listener = (ref: string | null) => {
      const straight = ref === null ? undefined : data.straightLegs?.[ref];
      const parts: MapLine[] = ref === null ? [] : [...data.lines.filter((line) => line.refs?.includes(ref)), ...(straight === undefined ? [] : [{ coordinates: straight, routed: false }])];
      (map.getSource("path-hover") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(lines(parts));
    };
    routeListeners.add(listener);
    return () => {
      routeListeners.delete(listener);
    };
  }, [map, data]);

  // Kontener zmienia rozmiar: mapa się przelicza, a po pokazaniu z ukrycia — dopasowuje od nowa.
  useEffect(() => {
    const element = container.current;
    if (map === null || element === null) return;
    let hidden = element.clientWidth === 0 || element.clientHeight === 0;
    const observer = new ResizeObserver(() => {
      const now = element.clientWidth === 0 || element.clientHeight === 0;
      if (!now) {
        // `resize` zatrzymuje ruch mapy: bez dokończenia zostałby widok sprzed dopasowania, np. cały świat.
        const pending = fitting.current;
        map.resize();
        if (pending !== null) {
          fitting.current = null;
          map.fitBounds(pending, { ...FIT, duration: 0 });
        }
      }
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
    if (pin !== undefined && fitting.current === null && !map.getBounds().contains([pin.lng, pin.lat])) map.easeTo({ center: [pin.lng, pin.lat], duration: 500 });
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
    <div className={`relative w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${square ? "aspect-square shrink-0" : banner ? "h-72 lg:h-[calc(50vh-4rem)]" : "h-72 lg:h-[calc(100vh-8rem)]"} ${picking ? "ring-2 ring-signal" : ""}`}>
      {/* Nie `absolute inset-0`: CSS MapLibre (poza warstwami Tailwinda) ustawia `position: relative`. */}
      <div ref={container} className="h-full w-full" />
      {failure && <p className="absolute inset-x-0 top-0 bg-red-50 p-2 text-xs text-red-700">Mapa się nie wczytała: {failure}</p>}
      {map !== null && data.pins.length > 0 && (
        <button
          type="button"
          onClick={() => {
            const bounds = boundsOf(data.pins, fitLines ? data.lines : []);
            if (bounds !== null) fitTo(map, bounds);
          }}
          title="Pokaż wszystkie punkty (bez dojazdu i startu z domu)"
          aria-label="Pokaż wszystkie punkty"
          className="absolute top-[76px] right-[10px] flex size-[29px] items-center justify-center rounded bg-white text-zinc-800 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] hover:bg-zinc-100">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
          </svg>
        </button>
      )}
      {/* Wybrany punkt (podświetlona pinezka): środek mapy na nim i przybliżenie. */}
      {map !== null && selectedPin !== undefined && (
        <button
          type="button"
          onClick={() => {
            map.stop();
            map.flyTo({ center: [selectedPin.lng, selectedPin.lat], zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: 700 });
          }}
          title={`Wyśrodkuj i przybliż: ${selectedPin.name}`}
          aria-label="Wyśrodkuj mapę na wybranym punkcie i przybliż"
          className="absolute top-[113px] right-[10px] flex size-[29px] items-center justify-center rounded bg-white text-zinc-800 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] hover:bg-zinc-100">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="8" cy="8" r="3.5" />
            <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
          </svg>
        </button>
      )}
      {/* Pod przyciskami mapy: pokaż / schowaj gwiazdki „po drodze i w pobliżu”. */}
      {map !== null && hasExtras && (
        <button
          type="button"
          onClick={() => setHideExtras((value) => !value)}
          aria-pressed={hideExtras}
          title={hideExtras ? "Pokaż atrakcje „po drodze i w pobliżu” (★)" : "Schowaj atrakcje „po drodze i w pobliżu” (★)"}
          aria-label={hideExtras ? "Pokaż atrakcje po drodze i w pobliżu" : "Schowaj atrakcje po drodze i w pobliżu"}
          style={{ top: selectedPin !== undefined ? 150 : 113 }}
          className={`absolute right-[10px] flex size-[29px] items-center justify-center rounded shadow-[0_0_0_2px_rgba(0,0,0,0.1)] ${hideExtras ? "bg-zinc-200 text-zinc-500 hover:bg-zinc-300" : "bg-white text-amber-500 hover:bg-zinc-100"}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill={hideExtras ? "none" : "currentColor"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M8 1.5l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.1l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" />
            {hideExtras && <path d="M2 2l12 12" strokeLinecap="round" />}
          </svg>
        </button>
      )}
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
          {(editing?.hints ?? ["Kliknij mapę w miejscu nowego punktu.", "Wpisz nazwę pod mapą albo kliknij inne miejsce."])[picked === null ? 0 : 1]}
        </p>
      )}
      {map !== null && data.pins.length === 0 && !picking && (
        <p className="absolute inset-x-4 top-4 rounded bg-white/90 p-2 text-center text-xs text-zinc-600 shadow dark:bg-zinc-900/90 dark:text-zinc-300">
          {emptyText}
        </p>
      )}
    </div>
  );
}

/** Pinezka zawiera wybrany punkt (dnia, z puli albo atrakcję po drodze). */
const holds = (pin: MapPin, selected: string | null) => selected !== null && (pin.clickRef === selected || pin.stops.some((stop) => stop.ref === selected) || (pin.pool ?? []).some((each) => each.ref === selected) || pin.extra?.ref === selected);

/** Wyróżnia pinezkę z wybranym punktem (dnia albo z puli); zwraca ją. */
function highlight(markers: { pin: MapPin; marker: Marker }[], selected: string | null): MapPin | undefined {
  let found: MapPin | undefined;
  for (const { pin, marker } of markers) {
    const active = holds(pin, selected);
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
  const titles = [...pin.stops.map((stop) => `${stop.n}. ${stop.title}`), ...(pin.pool ?? []).map((each) => `pula: ${each.title}`), ...(pin.extra ? ["po drodze i w pobliżu"] : [])];
  element.title = [pin.name, ...titles, ...(pin.base ? ["nocleg"] : [])].join("\n");
  const face = document.createElement("span");
  const ring = "border-2 border-white shadow-md transition-[scale,box-shadow] group-data-[active=true]:scale-125 group-data-[active=true]:ring-4 group-data-[active=true]:ring-signal/60";
  if (pin.stops.length > 0) {
    face.textContent = ranges(pin.stops.map((stop) => stop.n));
    face.className = `flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${pin.base ? "bg-indigo-500" : "bg-sea"} ${ring}`;
  } else if (pin.base) {
    face.textContent = "⌂";
    face.className = `flex size-6 items-center justify-center rounded-full bg-indigo-500 text-sm text-white ${ring}`;
  } else if (pin.extra) {
    // Atrakcja po drodze: mała gwiazdka, nie punkt planu.
    face.textContent = "★";
    face.className = `flex size-5 items-center justify-center rounded-full bg-amber-500 text-[11px] text-white ${ring}`;
  } else {
    // Sam cel przejazdu (numer stoi przy starcie) jest w kolorze planu, szare są tylko punkty z puli.
    face.className = `block size-3 rounded-full ${pin.arrival ? "bg-sea" : "bg-zinc-400"} ${ring}`;
  }
  element.append(face);
  return element;
}

/** Miniatura zdjęcia z dziennika na mapie wyjazdu: okrągła, z liczbą zdjęć w tym miejscu. */
function photoElement(pin: TripMapPhotoPin): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "group relative cursor-pointer";
  element.title = pin.count === 1 ? "Zdjęcie z dziennika" : `Zdjęcia z dziennika: ${pin.count}`;
  element.setAttribute("aria-label", element.title);
  const face = document.createElement("span");
  face.className = "block size-9 overflow-hidden rounded-full border-2 border-white bg-zinc-300 bg-cover bg-center shadow-md transition-[scale] group-hover:scale-125";
  face.style.backgroundImage = `url("${pin.thumbUrl.replace(/"/g, "%22")}")`;
  element.append(face);
  if (pin.count > 1) {
    const badge = document.createElement("span");
    badge.textContent = String(pin.count);
    badge.className = "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-semibold text-white";
    element.append(badge);
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
export function polishLabels(map: MapLibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const field = map.getLayoutProperty(layer.id, "text-field");
    if (field === undefined || !JSON.stringify(field).includes("name")) continue;
    map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:pl"], ["get", "name"]]);
  }
}
