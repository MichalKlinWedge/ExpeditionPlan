"use client";

import { capitalized, type DayMap, distanceM, type PlaceGuide, type PlaceMemorySummary, type PlaceUsage, visitLabel } from "@expeditionplan/core";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import { type FormState, pinPlace, searchPlace } from "@/app/actions";
import { mergePlace, removePlace, savePlaceDetails } from "@/app/place-actions";
import { GuideArticle } from "@/components/guide-article";
import { PlaceGuideButtons } from "@/components/guide-button";
import { type LatLng, PlanMap } from "@/components/plan-map";
import { IconAction } from "@/components/icon-action";
import { PlaceMemory, VERDICT_ICON } from "@/components/place-memory";

/**
 * Wszystkie miejsca wyjazdu: lista i mapa z tymi samymi numerami. Organizator i edytor poprawiają nazwę,
 * adres i współrzędne (wklejone, wskazane na mapie albo znalezione po nazwie) i usuwają nieużywane miejsca.
 * Numer albo nazwa na liście wyróżnia pinezkę, tak jak numer punktu w planie; pinezka wyróżnia wiersz.
 * Duplikaty (podpowiedź z `similarPlaces` albo wybrane z listy) scala się do miejsca, przy którym się klika.
 * Pozycję zmienia się kliknięciem i osobnym zapisem, bez przeciągania: miejsce jest wspólne dla wielu punktów.
 * Pod kwadratową mapą jest ocena wybranego miejsca (pamięć miejsc między wyjazdami, głosuje każdy uczestnik),
 * jego opis (`placeGuide`) i przygotowanie nowego z AI.
 * Miejsca bez współrzędnych (postój na trasie, przerwa na szlaku) stoją na końcu listy, w osobnej podsekcji i bez ostrzeżenia.
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
  /** Refy możliwych duplikatów. */
  similar: string[];
  guide: PlaceGuide | null;
  /** Oceny i notatki z pamięci miejsc (`memorySummary`), wspólne z innymi wyjazdami z tym miejscem. */
  memory: PlaceMemorySummary;
  /** Byliśmy tu (punkt planu z minioną datą i godziną, w dowolnym moim wyjeździe): dopiero wtedy ocena. */
  canRate: boolean;
  years: number[];
};

type Filter = "all" | "missing" | "unused";

/** Punkt ze współrzędnych w Mapach Google (sam link, nic nie pobieramy). */
const googleMapsPointUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;

const PROVIDER: Record<PlaceRowData["provider"], string> = { osm: "z OpenStreetMap", geoapify: "z Geoapify", user: "wpisane ręcznie", unknown: "źródło nieustalone" };
const input = "field min-w-0 flex-1 px-2 py-1 text-sm";
const button = "btn-secondary btn-sm";

/** Dalej niż tyle: ostrzeżenie przed scaleniem. Bliżej niż `MOVED_M` trasy przejazdów dalej pasują. */
const FAR_M = 1000;
const MOVED_M = 100;

const usageLabel = ({ items, bookings, days, legs, travelers }: PlaceUsage) =>
  [items.length > 0 && `punkty: ${items.length}`, bookings.length > 0 && `rezerwacje: ${bookings.length}`, days > 0 && `baza dni: ${days}`, legs > 0 && `przejazdy: ${legs}`, travelers > 0 && `uczestnicy: ${travelers}`].filter(Boolean).join(", ");

export function PlacesView({ tripId, places, canEdit, hasRouted, initial = null }: { tripId: string; places: PlaceRowData[]; canEdit: boolean; hasRouted: boolean; initial?: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(initial);
  // Strona zachowana przez Next dostaje nowe `?miejsce=` bez montowania od nowa.
  const [entry, setEntry] = useState(initial);
  if (entry !== initial) {
    setEntry(initial);
    if (initial !== null) setSelected(initial);
  }
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [picked, setPicked] = useState<LatLng | null>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  // Wejście z pinezką albo z listy wszystkich miejsc: wiersz wybranego miejsca na środku ekranu, mapa na tym miejscu.
  useEffect(() => {
    if (initial !== null) document.getElementById(`miejsce-${initial}`)?.scrollIntoView({ block: "center" });
  }, [initial]);
  // Nowe miejsce: kolumna wraca na górę, żeby mapa z pinezką była widoczna po czytaniu długiego opisu.
  useEffect(() => {
    if (selected !== null) mapBox.current?.scrollTo({ top: 0 });
  }, [selected]);

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

  const onMap = shown.filter((place) => place.lat !== undefined);
  const offMap = shown.filter((place) => place.lat === undefined);

  const chosen = places.find((place) => place.ref === selected);

  const stopPicking = () => {
    setPicking(null);
    setPicked(null);
  };
  const select = (ref: string) => {
    stopPicking();
    setFilter("all");
    setQuery("");
    setSelected(ref);
    if (canEdit) setOpen(ref);
    // Po wyczyszczeniu filtra wiersz może dopiero się pojawić.
    window.setTimeout(() => document.getElementById(`miejsce-${ref}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  };
  const startPicking = (ref: string) => {
    setPicked(null);
    setPicking(ref);
    setSelected(ref);
    mapBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  /** Na telefonie mapa jest nad listą, więc wyróżniona pinezka musi wrócić na ekran. */
  const show = (ref: string) => {
    setSelected(ref);
    mapBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const row = (place: PlaceRowData) => (
    <PlaceRow
      key={place.id}
      tripId={tripId}
      place={place}
      others={places.filter((each) => each.ref !== place.ref)}
      canEdit={canEdit}
      hasRouted={hasRouted}
      open={open === place.ref}
      selected={selected === place.ref}
      onShow={() => show(place.ref)}
      onToggle={() => {
        stopPicking();
        setSelected(place.ref);
        setOpen(open === place.ref ? null : place.ref);
      }}
      picking={picking === place.ref}
      picked={picking === place.ref ? picked : null}
      onStartPicking={() => startPicking(place.ref)}
      onStopPicking={stopPicking}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Długi opis przewija się w tej kolumnie, więc mapa i lista zostają obok siebie. Miejsce na pasek jest zarezerwowane: inaczej mapa zmieniałaby rozmiar przy dłuższym opisie. */}
      <aside ref={mapBox} className="flex scroll-mt-4 flex-col gap-2 lg:sticky lg:top-6 lg:order-last lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:[overflow-anchor:none] lg:[scrollbar-gutter:stable]">
        <PlanMap
          map={map}
          fitKey="miejsca"
          square
          focus={initial}
          selected={selected}
          onSelect={select}
          emptyText="Żadne miejsce nie ma jeszcze współrzędnych."
          editing={canEdit ? { picking: picking !== null, picked, onPick: setPicked, onMovePlace: () => {}, hints: ["Kliknij mapę w nowym położeniu tego miejsca.", "Zapisz pozycję przy miejscu na liście albo kliknij mapę jeszcze raz."] } : null}
        />
        <p className="text-xs text-zinc-500">Numery na mapie odpowiadają numerom na liście. Kliknięcie numeru albo nazwy na liście pokazuje miejsce na mapie i jego opis, a kliknięcie pinezki otwiera je na liście.</p>
        {chosen && (
          <section key={`ocena-${chosen.ref}`} className="card flex flex-col gap-2 p-4 text-sm">
            <h2 className="card-title">Czy warto? {chosen.name}</h2>
            <p className="text-xs text-zinc-500">
              {chosen.years.length > 0 && `${capitalized(visitLabel(chosen.years)!)}. `}Każdy uczestnik ocenia za siebie. Oceny i notatki widać też w innych wyjazdach z tym miejscem i bierze je pod uwagę „Zaplanuj z AI”.
            </p>
            <PlaceMemory placeId={chosen.id} summary={chosen.memory} canRate={chosen.canRate} />
          </section>
        )}
        {chosen && <PlaceDescription key={chosen.ref} tripId={tripId} place={chosen} canEdit={canEdit} />}
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(
            [
              ["all", "Wszystkie"],
              ["missing", "Bez lokalizacji"],
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
        {onMap.length > 0 && <ul className="flex flex-col gap-2">{onMap.map(row)}</ul>}
        {offMap.length > 0 && (
          <div className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold">Bez dokładnej lokalizacji</h2>
              <p className="text-xs text-zinc-500">Na przykład postój na trasie albo przerwa na szlaku.{canEdit ? " Współrzędne nie są tu potrzebne, a gdy jednak się przydadzą, dodasz je przez „zmień”." : ""}</p>
            </div>
            <ul className="flex flex-col gap-2">{offMap.map(row)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}

/** Opis wybranego miejsca: własny albo z punktu, który tam prowadzi; organizator i edytor przygotowują nowy. */
function PlaceDescription({ tripId, place, canEdit }: { tripId: string; place: PlaceRowData; canEdit: boolean }) {
  const { guide } = place;
  const own = guide !== null && guide.fromItem === undefined;
  const buttons = canEdit && <PlaceGuideButtons tripId={tripId} placeRef={place.ref} guideId={own ? guide.rowId : null} label={own ? "Odśwież opis" : "Przygotuj opis miejsca (AI)"} which={own ? guide.content.hint : undefined} />;
  return (
    guide === null ? (
      <section className="card flex flex-col gap-2 p-4 text-sm">
        <h2 className="card-title">{place.name}</h2>
        <p className="text-zinc-500">
          Brak opisu.
          {canEdit ? " Powstaje z artykułu w Wikipedii albo Wikivoyage o tym miejscu." : " Organizator może go przygotować."}
        </p>
        {buttons}
      </section>
    ) : (
      <GuideArticle guide={guide.content} title={guide.title} heading={place.name} targets={[]} itemBase={`/trips/${tripId}/item/`}>
        {guide.fromItem && (
          <p className="text-xs text-zinc-500">
            Opis z punktu{" "}
            <Link href={`/trips/${tripId}/item/${encodeURIComponent(guide.fromItem.ref)}`} className="btn-mini">
              {guide.fromItem.title}
            </Link>
          </p>
        )}
        {buttons}
      </GuideArticle>
    )
  );
}

function PlaceRow({
  tripId,
  place,
  others,
  canEdit,
  hasRouted,
  open,
  selected,
  onShow,
  onToggle,
  picking,
  picked,
  onStartPicking,
  onStopPicking,
}: {
  tripId: string;
  place: PlaceRowData;
  others: PlaceRowData[];
  canEdit: boolean;
  hasRouted: boolean;
  open: boolean;
  selected: boolean;
  onShow: () => void;
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
  const [mergeRef, setMergeRef] = useState("");
  // Scalenie może uzupełnić adres z drugiego miejsca: pole ma pokazać to, co jest zapisane.
  const [savedAddress, setSavedAddress] = useState(place.address);
  if (savedAddress !== place.address) {
    setSavedAddress(place.address);
    setAddress(place.address ?? "");
  }
  const [pending, start] = useTransition();
  const pickBar = useRef<HTMLParagraphElement>(null);
  const coordsForm = useId();
  // Wskazany na mapie punkt trafia do pola współrzędnych; na telefonie lista jest pod mapą, więc wraca na ekran.
  const [shownPick, setShownPick] = useState<LatLng | null>(null);
  if (picked !== shownPick) {
    setShownPick(picked);
    if (picked !== null) setCoords(`${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}`);
  }
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

  const merge = (drop: PlaceRowData) => {
    const far = located && drop.lat !== undefined && drop.lng !== undefined ? distanceM([place.lng!, place.lat!], [drop.lng, drop.lat]) : 0;
    const uses = drop.usage.total > 0 ? ` Przejdą na nie: ${usageLabel(drop.usage)}.` : "";
    const warning = far > FAR_M ? ` Uwaga: te miejsca są ${(far / 1000).toFixed(1).replace(".", ",")} km od siebie, punkty dostaną współrzędne „${place.name}”.` : "";
    if (!window.confirm(`Scalić „${drop.name}” do „${place.name}”? „${drop.name}” zniknie.${uses}${warning} W aplikacji nie da się tego cofnąć.`)) return;
    const changesPosition = drop.lat !== undefined && (!located || far > MOVED_M);
    run(async () => {
      const answer = await mergePlace(tripId, place.ref, drop.ref);
      if (answer.ok) setMergeRef("");
      return answer;
    }, changesPosition);
  };
  const similar = others.filter((each) => place.similar.includes(each.ref));

  const linked = [...usage.items.map((item) => ({ key: item.ref, title: item.title, href: `/trips/${tripId}/item/${item.ref}` })), ...usage.bookings.map((booking) => ({ key: booking.ref, title: booking.title, href: `/trips/${tripId}/logistics` }))];

  return (
    <li id={`miejsce-${place.ref}`} className={`card flex scroll-mt-4 flex-col gap-2 p-3 text-sm ${selected || open ? "ring-2 ring-sea" : ""}`}>
      <div className="card-title flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {located ? (
          <button type="button" onClick={onShow} aria-pressed={selected} title="Pokaż na mapie" className="flex items-baseline gap-x-2 text-left hover:text-sea">
            {place.n !== undefined && <span className="flex h-5 min-w-5 items-center justify-center self-center rounded-full bg-sea px-1 text-xs font-semibold text-white">{place.n}</span>}
            <strong>{place.name}</strong>
          </button>
        ) : (
          <strong>{place.name}</strong>
        )}
        {canEdit && (
          <span className="ml-auto flex gap-1">
            <IconAction kind={open ? "close" : "change"} tip={open ? "zwiń" : undefined} onClick={onToggle} aria-expanded={open} />
            {usage.total === 0 && (
              <IconAction kind="remove"
                disabled={pending}
                title="Nic w planie z niego nie korzysta"
                onClick={() => {
                  if (window.confirm(`Usunąć miejsce „${place.name}”? Nic w planie z niego nie korzysta. Jego opis też zniknie. W aplikacji nie da się tego cofnąć.`)) run(() => removePlace(tripId, place.ref));
                }} />
            )}
          </span>
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
            <a href={googleMapsPointUrl(place.lat!, place.lng!)} target="_blank" rel="noreferrer" className="underline">
              Google Maps
            </a>
            {" · "}
          </>
        )}
        {PROVIDER[place.provider]} · {usage.total > 0 ? usageLabel(usage) : "nieużywane"}
        {place.memory.worth > 0 && ` · ${VERDICT_ICON.worth} ${place.memory.worth}`}
        {place.memory.notWorth > 0 && ` · ${VERDICT_ICON.not_worth} ${place.memory.notWorth}`}
      </p>
      {canEdit && similar.length > 0 && (
        <div className="flex flex-col gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {similar.map((each) => (
            <p key={each.ref} className="flex flex-wrap items-baseline gap-x-2">
              <span>
                Możliwy duplikat: {each.n !== undefined ? `${each.n}. ` : ""}
                {each.name}
                {each.usage.total > 0 ? ` (${usageLabel(each.usage)})` : " (nieużywane)"}
              </span>
              <button type="button" disabled={pending} onClick={() => merge(each)} className="btn-mini">
                scal tutaj
              </button>
            </p>
          ))}
        </div>
      )}

      {open && (
        <div className="flex flex-col divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800 [&>*]:py-3 [&>*:last-child]:pb-0">
          {linked.length > 0 && (
            <p className="text-xs text-zinc-500">
              Korzystają:{" "}
              {linked.slice(0, 4).map((each, index) => (
                <span key={each.key}>
                  {index > 0 && " "}
                  <Link href={each.href} className="btn-mini">
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
              {usage.total > 0 ? ` przesuną to miejsce wszędzie, gdzie jest użyte (${usageLabel(usage)}).` : "."} W Google Maps przytrzymaj miejsce i skopiuj liczby albo wklej pełny link; w OpenStreetMap wklej link z paska adresu. Możesz też wskazać miejsce na mapie.
            </p>
            {/* Wpisane współrzędne i punkt wskazany na mapie (trafia do pola) zapisuje jeden „Zapisz”. */}
            <form
              id={coordsForm}
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                savePosition(coords, () => {
                  setCoords("");
                  if (picking) onStopPicking();
                });
              }}>
              <div className="flex flex-wrap gap-2">
                <input value={coords} onChange={(event) => setCoords(event.target.value)} disabled={pending} placeholder="50.2771, 16.5373 albo link z mapy" aria-label={`Współrzędne: ${place.name}`} className={input} />
                {picking ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Punkt z mapy w polu znika razem ze wskazywaniem.
                      if (picked !== null) setCoords("");
                      onStopPicking();
                    }}
                    className={button}>
                    Anuluj wskazywanie
                  </button>
                ) : (
                  <button type="button" onClick={onStartPicking} className={button}>
                    Wskaż na mapie
                  </button>
                )}
              </div>
              {picking && (
                <p ref={pickBar} className="text-xs text-zinc-500">
                  {picked === null ? "Kliknij mapę w nowym położeniu — współrzędne trafią do pola." : "Wskazany punkt jest w polu; zapisz albo kliknij mapę jeszcze raz."}
                </p>
              )}
            </form>
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
            {/* Na końcu sekcji, pod oboma polami; należy do formularza współrzędnych. */}
            <div className="flex flex-wrap items-center gap-3">
              <button form={coordsForm} disabled={pending || coords.trim() === ""} className={button}>
                Zapisz
              </button>
              {located && (
                <a href={googleMapsPointUrl(place.lat!, place.lng!)} target="_blank" rel="noreferrer" className="text-xs underline">
                  Otwórz zapisany punkt w Google Maps ↗
                </a>
              )}
            </div>
          </div>

          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-zinc-500">Scal z innym miejscem: to miejsce zostaje, a wybrane znika i wszystko, co z niego korzysta, przechodzi tutaj.</p>
              <div className="flex flex-wrap gap-2">
                <select value={mergeRef} onChange={(event) => setMergeRef(event.target.value)} disabled={pending} aria-label={`Scal z miejscem: ${place.name}`} className={input}>
                  <option value="">Wybierz miejsce…</option>
                  {others.map((each) => (
                    <option key={each.ref} value={each.ref}>
                      {each.n !== undefined ? `${each.n}. ` : ""}
                      {each.name}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={pending || mergeRef === ""} onClick={() => merge(others.find((each) => each.ref === mergeRef)!)} className={button}>
                  Scal
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {pending && <p className="text-xs text-zinc-500">Zapisuję…</p>}
      {result.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result.ok && <p className="text-xs text-green-700 dark:text-green-400">{result.ok}</p>}
      {moved && hasRouted && usage.total > 0 && (
        <p className="text-xs text-zinc-500">
          Czasy przejazdów nie zmieniają się same:{" "}
          <Link href={`/trips/${tripId}/plan`} className="btn-mini">
            w planie użyj „Przelicz przejazdy”
          </Link>
          .
        </p>
      )}
    </li>
  );
}
