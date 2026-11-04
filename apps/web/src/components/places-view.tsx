"use client";

import type { DayMap, PlaceUsage } from "@expeditionplan/core";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { type FormState, pinPlace, searchPlace } from "@/app/actions";
import { removePlace, savePlaceDetails } from "@/app/place-actions";
import { type LatLng, PlanMap } from "@/components/plan-map";

/**
 * Wszystkie miejsca wyjazdu: lista i mapa z tymi samymi numerami. Organizator i edytor poprawiają nazwę,
 * adres i współrzędne (wklejone, wskazane na mapie albo znalezione po nazwie) i usuwają nieużywane miejsca.
 * Pozycję zmienia się kliknięciem i osobnym zapisem, bez przeciągania: miejsce jest wspólne dla wielu punktów.
 */

export type PlaceRowData = {
  id: string;
  ref: string;
  name: string;
  address?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  provider: "osm" | "geoapify" | "user" | "unknown";
  searchName?: string | undefined;
  usage: PlaceUsage;
  n?: number | undefined;
};

type Filter = "all" | "missing" | "unused";

const PROVIDER: Record<PlaceRowData["provider"], string> = { osm: "z OpenStreetMap", geoapify: "z Geoapify", user: "wpisane ręcznie", unknown: "źródło nieustalone" };
const input = "field min-w-0 flex-1 px-2 py-1 text-sm";
const button = "btn-secondary btn-sm";

const usageLabel = ({ items, bookings, days, legs }: PlaceUsage) =>
  [items.length > 0 && `punkty: ${items.length}`, bookings.length > 0 && `rezerwacje: ${bookings.length}`, days > 0 && `baza dni: ${days}`, legs > 0 && `przejazdy: ${legs}`].filter(Boolean).join(", ");

export function PlacesView({ tripId, places, canEdit, hasRouted }: { tripId: string; places: PlaceRowData[]; canEdit: boolean; hasRouted: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [picked, setPicked] = useState<LatLng | null>(null);
  const mapBox = useRef<HTMLDivElement>(null);

  const map = useMemo<DayMap>(
    () => ({
      lines: [],
      numbers: {},
      pins: places.flatMap((place) => (place.lat === undefined || place.lng === undefined ? [] : [{ placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [{ ref: place.ref, n: place.n ?? 0, title: usageLabel(place.usage) || "nieużywane" }] }])),
    }),
    [places],
  );

  const counts: Record<Filter, number> = { all: places.length, missing: places.filter((place) => place.lat === undefined).length, unused: places.filter((place) => place.usage.total === 0).length };
  const needle = query.trim().toLowerCase();
  const shown = places.filter((place) => (filter === "all" || (filter === "missing" ? place.lat === undefined : place.usage.total === 0)) && (needle === "" || `${place.name} ${place.address ?? ""}`.toLowerCase().includes(needle)));

  const stopPicking = () => {
    setPicking(null);
    setPicked(null);
  };
  const select = (ref: string) => {
    stopPicking();
    setFilter("all");
    setQuery("");
    setOpen(ref);
    // Po wyczyszczeniu filtra wiersz może dopiero się pojawić.
    window.setTimeout(() => document.getElementById(`miejsce-${ref}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  };
  const startPicking = (ref: string) => {
    setPicked(null);
    setPicking(ref);
    mapBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <aside ref={mapBox} className="flex scroll-mt-4 flex-col gap-2 lg:sticky lg:top-6 lg:order-last lg:self-start">
        <PlanMap
          map={map}
          fitKey="miejsca"
          selected={open}
          onSelect={select}
          emptyText="Żadne miejsce nie ma jeszcze współrzędnych."
          editing={canEdit ? { picking: picking !== null, picked, onPick: setPicked, onMovePlace: () => {}, hints: ["Kliknij mapę w nowym położeniu tego miejsca.", "Zapisz pozycję przy miejscu na liście albo kliknij mapę jeszcze raz."] } : null}
        />
        <p className="text-xs text-zinc-500">Numery na mapie odpowiadają numerom na liście. Kliknięcie pinezki otwiera miejsce na liście.</p>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ["all", "Wszystkie"],
              ["missing", "Bez współrzędnych"],
              ["unused", "Nieużywane"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1 ${filter === key ? "bg-sea text-white" : "bg-sea-light text-sea"}`}>
              {label} ({counts[key]})
            </button>
          ))}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po nazwie lub adresie" aria-label="Szukaj miejsca" className={`${input} min-w-40`} />
        </div>

        {shown.length === 0 && <p className="text-sm text-zinc-500">Nic tu nie ma — zmień filtr albo szukany tekst.</p>}
        <ul className="flex flex-col gap-2">
          {shown.map((place) => (
            <PlaceRow
              key={place.id}
              tripId={tripId}
              place={place}
              canEdit={canEdit}
              hasRouted={hasRouted}
              open={open === place.ref}
              onToggle={() => {
                stopPicking();
                setOpen(open === place.ref ? null : place.ref);
              }}
              picking={picking === place.ref}
              picked={picking === place.ref ? picked : null}
              onStartPicking={() => startPicking(place.ref)}
              onStopPicking={stopPicking}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PlaceRow({
  tripId,
  place,
  canEdit,
  hasRouted,
  open,
  onToggle,
  picking,
  picked,
  onStartPicking,
  onStopPicking,
}: {
  tripId: string;
  place: PlaceRowData;
  canEdit: boolean;
  hasRouted: boolean;
  open: boolean;
  onToggle: () => void;
  picking: boolean;
  picked: LatLng | null;
  onStartPicking: () => void;
  onStopPicking: () => void;
}) {
  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address ?? "");
  const [coords, setCoords] = useState("");
  const [search, setSearch] = useState(place.searchName ?? place.name);
  const [result, setResult] = useState<FormState>({});
  const [moved, setMoved] = useState(false);
  const [pending, start] = useTransition();
  const pickBar = useRef<HTMLDivElement>(null);
  // Na telefonie lista jest pod mapą: po wskazaniu pokazuje przycisk zapisu.
  useEffect(() => {
    if (picked !== null) pickBar.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked]);
  const located = place.lat !== undefined && place.lng !== undefined;
  const { usage } = place;

  const run = (action: () => Promise<FormState>, changesPosition = false) =>
    start(async () => {
      const answer = await action();
      setResult(answer);
      setMoved(changesPosition && answer.ok !== undefined);
    });
  const savePosition = (text: string, done?: () => void) =>
    run(async () => {
      const answer = await pinPlace(tripId, place.id, text);
      if (answer.ok) done?.();
      return answer;
    }, true);

  const linked = [...usage.items.map((item) => ({ key: item.ref, title: item.title, href: `/trips/${tripId}/item/${item.ref}` })), ...usage.bookings.map((booking) => ({ key: booking.ref, title: booking.title, href: `/trips/${tripId}/logistics` }))];

  return (
    <li id={`miejsce-${place.ref}`} className={`card flex scroll-mt-4 flex-col gap-2 p-3 text-sm ${open ? "ring-2 ring-sea" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {place.n !== undefined && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sea px-1 text-xs font-semibold text-white">{place.n}</span>}
        <strong>{place.name}</strong>
        {!located && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">bez współrzędnych</span>}
        {canEdit && (
          <button type="button" onClick={onToggle} aria-expanded={open} className="ml-auto text-xs underline">
            {open ? "zwiń" : "zmień"}
          </button>
        )}
      </div>
      {place.address && <p className="text-xs text-zinc-600 dark:text-zinc-400">{place.address}</p>}
      <p className="text-xs text-zinc-500">
        {located && (
          <>
            <a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=17/${place.lat}/${place.lng}`} target="_blank" rel="noreferrer" className="underline">
              {place.lat!.toFixed(5)}, {place.lng!.toFixed(5)}
            </a>
            {" · "}
          </>
        )}
        {PROVIDER[place.provider]} · {usage.total > 0 ? usageLabel(usage) : "nieużywane"}
      </p>

      {open && (
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          {linked.length > 0 && (
            <p className="text-xs text-zinc-500">
              Korzystają:{" "}
              {linked.slice(0, 4).map((each, index) => (
                <span key={each.key}>
                  {index > 0 && ", "}
                  <Link href={each.href} className="underline">
                    {each.title}
                  </Link>
                </span>
              ))}
              {linked.length > 4 ? ` i ${linked.length - 4} więcej` : ""}
            </p>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => savePlaceDetails(tripId, place.id, { name, address }));
            }}>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Nazwa
              <input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              Adres
              <input value={address} onChange={(event) => setAddress(event.target.value)} disabled={pending} className={input} />
            </label>
            <button disabled={pending || name.trim() === "" || (name.trim() === place.name && address.trim() === (place.address ?? ""))} className={`${button} self-start`}>
              Zapisz nazwę i adres
            </button>
          </form>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-zinc-500">
              {located ? "Nowe współrzędne" : "Współrzędne"}
              {usage.total > 0 ? ` przesuną to miejsce wszędzie, gdzie jest użyte (${usageLabel(usage)}).` : "."} W Google Maps przytrzymaj miejsce i skopiuj liczby albo wklej pełny link; w OpenStreetMap wklej link z paska adresu.
            </p>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                savePosition(coords, () => setCoords(""));
              }}>
              <input value={coords} onChange={(event) => setCoords(event.target.value)} disabled={pending} placeholder="50.2771, 16.5373 albo link z mapy" aria-label={`Współrzędne: ${place.name}`} className={input} />
              <button disabled={pending || coords.trim() === ""} className={button}>
                Zapisz
              </button>
            </form>
            {picking ? (
              <div ref={pickBar} className="flex flex-wrap items-center gap-2 text-xs">
                <span>{picked === null ? "Kliknij mapę w nowym położeniu." : `Wskazano: ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}`}</span>
                <button type="button" disabled={pending || picked === null} onClick={() => savePosition(`${picked!.lat}, ${picked!.lng}`, onStopPicking)} className="btn-primary btn-sm">
                  Zapisz pozycję
                </button>
                <button type="button" onClick={onStopPicking} className="underline">
                  anuluj
                </button>
              </div>
            ) : (
              <button type="button" onClick={onStartPicking} className={`${button} self-start`}>
                Wskaż na mapie
              </button>
            )}
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => searchPlace(tripId, place.id, search), true);
              }}>
              <input value={search} onChange={(event) => setSearch(event.target.value)} disabled={pending} aria-label={`Szukaj: ${place.name}`} className={input} />
              <button disabled={pending || search.trim() === ""} className={button}>
                Znajdź po nazwie
              </button>
            </form>
          </div>

          {usage.total === 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Usunąć miejsce „${place.name}”? Nic z niego nie korzysta. W aplikacji nie da się tego cofnąć.`)) run(() => removePlace(tripId, place.ref));
              }}
              className="self-start text-xs underline disabled:opacity-50">
              usuń miejsce
            </button>
          )}
        </div>
      )}

      {pending && <p className="text-xs text-zinc-500">Zapisuję…</p>}
      {result.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result.ok && <p className="text-xs text-green-700 dark:text-green-400">{result.ok}</p>}
      {moved && hasRouted && usage.total > 0 && (
        <p className="text-xs text-zinc-500">
          Czasy przejazdów nie zmieniają się same:{" "}
          <Link href={`/trips/${tripId}/plan?edit=1`} className="underline">
            w planie użyj „Przelicz przejazdy”
          </Link>
          .
        </p>
      )}
    </li>
  );
}
