"use client";

import {
  activeVariants as resolveVariants,
  addItem,
  addItemAtPin,
  dayItems,
  dayLodging,
  dayMap,
  documentProblem as problem,
  dropItem,
  type DaySchedule,
  instantToZoned,
  flightLine,
  flightOf,
  itemIcon,
  legLabel,
  mapCoverage,
  missingOnMap,
  movePlace,
  moveToDay,
  moveWithinDay,
  type PlanEdit as Edit,
  type PlanItem as Item,
  proposeCuts,
  removeItemClosingGap,
  type Scenario,
  scheduleDay,
  type TripDocument,
  updateItem,
  type DayWeather,
  fetchWeather,
  localToday,
  WEATHER_ATTRIBUTION,
  weatherIcon,
  weatherLine,
  weatherPoints,
  weatherVariantHint,
} from "@expeditionplan/core";
import { savePlanEdit, saveRulesEdit, type TripState, uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DayConstraints, DayVariants, ItemVariants, type OnRules } from "@/components/day-rules";
import { ItemEditor } from "@/components/item-editor";
import { type LatLng, PlanMap } from "@/components/plan-map";
import { createClient } from "@/lib/supabase/client";
import { useHydrated } from "@/lib/use-hydrated";
import { useRefreshOnReturn } from "@/lib/use-refresh-on-return";

/**
 * Widok planu (MVP-3): dni z godzinami policzonymi przez silnik (§7), ostrzeżenia, audyt zapasu,
 * cięcia, słońce, warianty i pula, a obok mapa wybranego dnia. Silnik działa w przeglądarce —
 * przełączenie scenariusza, wariantu albo przeciągnięcie punktu przelicza dzień od razu.
 */

const KIND: Record<string, string> = {
  visit: "zwiedzanie",
  activity: "aktywność",
  meal: "posiłek",
  transport: "przejazd",
  lodging: "nocleg",
  errand: "sprawa",
  meetup: "spotkanie",
  free: "czas wolny",
  decision: "decyzja",
};

const SLACK: Record<string, { label: string; tone: string }> = {
  large: { label: "duży zapas", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  small: { label: "mały zapas", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  none: { label: "bez zapasu", tone: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200" },
  negative: { label: "dzień się nie spina", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

const STATUS: Record<string, string> = {
  candidate: "kandydat",
  alternative: "alternatywa",
  does_not_fit: "nie mieści się",
  rejected: "odrzucony",
  scheduled: "w planie",
};

/** Wybór widoku „pula” zamiast dnia. */
const POOL = "pool";

const weekday = (date: string) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const hm = (instant: number | null | undefined, tz: string) => (instant == null ? "—" : instantToZoned(instant, tz).time);

type Props = {
  state: TripState;
  tripId: string;
  ids: Record<string, string>;
  canEdit: boolean;
  /** Adres karty punktu bez klucza (`/trips/<id>/item/`); brak — tytuły bez linku (link publiczny). */
  itemBase?: string;
};

export function PlanView({ state, tripId, ids: initialIds, canEdit, itemBase }: Props) {
  useRefreshOnReturn();
  const { inputs } = state;
  const [doc, setDoc] = useState(state.doc);
  const [ids, setIds] = useState(initialIds);
  const [saving, setSaving] = useState<{ pending: number; error?: string; ok?: boolean }>({ pending: 0 });
  const [scenario, setScenario] = useState<Scenario>("optimistic");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const variants = useMemo(() => ({ ...inputs.activeVariants, ...overrides }), [inputs.activeVariants, overrides]);
  const options = { scenario, activeVariants: variants, delays: inputs.delays, skipRefs: inputs.skipRefs };
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const pool = doc.items.filter((item) => item.dayRef === undefined);
  const hydrated = useHydrated();
  // Prognoza Open-Meteo z przeglądarki (limit per IP); dni poza horyzontem 16 dni jej nie mają.
  const [weather, setWeather] = useState<Record<string, DayWeather>>({});
  const weatherKey = weatherPoints(doc)
    .map((point) => `${point.dayRef}@${point.lat.toFixed(2)},${point.lng.toFixed(2)}`)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    void fetchWeather(weatherPoints(doc), localToday()).then(
      (days) => {
        if (!cancelled) setWeather(days);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // `weatherKey` streszcza miejsca i dni — bez nowego zapytania przy każdej edycji punktu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherKey]);
  // Widok: jeden dzień albo pula (`POOL`); mapa pokazuje to samo.
  const [mapDayRef, setMapDay] = useState<string | undefined>(doc.days[0]?.ref ?? (pool.length > 0 ? POOL : undefined));
  const showPool = mapDayRef === POOL;
  const mapDay = showPool ? undefined : (doc.days.find((day) => day.ref === mapDayRef) ?? doc.days[0]);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ ref: string; over: DropTarget | null } | null>(null);
  /** Własna pinezka: tryb wskazywania na mapie — miejsce nowego punktu albo pinezka dla miejsca bez współrzędnych (`place`). */
  const [pick, setPick] = useState<{ at: LatLng | null; place?: { ref: string; name: string } } | null>(null);
  const pinPlace = (ref: string, name: string) => {
    setPick({ at: null, place: { ref, name } });
    window.document.querySelector(".maplibregl-map")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Kolejność na mapie = kolejność z silnika (warianty, pominięcia); przed hydratacją — z klucza.
  let mapRefs: string[] = [];
  if (mapDay !== undefined) {
    try {
      mapRefs = hydrated ? scheduleDay(doc, mapDay.ref, options).items.map((item) => item.ref) : dayItems(doc, mapDay.ref).map((item) => item.ref);
    } catch {
      mapRefs = dayItems(doc, mapDay.ref).map((item) => item.ref);
    }
  }
  const map = dayMap(doc, mapRefs, { baseRef: mapDay ? dayLodging(doc, mapDay.ref)?.placeRef : undefined, pool: true });
  const mapKey = JSON.stringify([map.lines, map.pins.map((pin) => [pin.placeRef, pin.lat, pin.lng, pin.stops.map((stop) => stop.n), pin.pool?.length])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mapa przerysowuje się tylko przy zmianie tego, co pokazuje
  const stableMap = useMemo(() => map, [mapKey]);

  /** Punkt z listy albo z mapy: wyróżnienie w obu miejscach. */
  const select = (ref: string, from: "list" | "map") => {
    setSelected(ref);
    if (from === "map") document.getElementById(`item-${ref}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /**
   * Zmiana: najpierw w dokumencie (silnik przelicza od razu), potem zapis w tle. Dokument, który
   * nie przechodzi walidacji, nie trafia do bazy; błąd zapisu cofa zmianę.
   */
  const apply = (edit: Edit | null) => {
    if (edit === null) return;
    const invalid = problem(edit.doc);
    if (invalid !== null) return setSaving({ pending: 0, error: `Nie zapisano: ${invalid}` });
    const before = doc;
    setDoc(edit.doc);
    setSaving((current) => ({ pending: current.pending + 1 }));
    void persist(edit).then(
      () => setSaving((current) => ({ pending: current.pending - 1, ok: true })),
      (error: unknown) => {
        setDoc(before);
        setSaving((current) => ({ pending: current.pending - 1, error: error instanceof Error ? error.message : String(error) }));
      },
    );
  };

  const persist = async (edit: Edit) => {
    setIds(await savePlanEdit(createClient(), tripId, edit, ids));
  };

  /** Warianty i ograniczenia (`plan-rules`): ta sama droga co `apply`, zapis przez `saveRulesEdit`. */
  const onRules: OnRules | null = canEdit
    ? (build) => {
        let edit: ReturnType<typeof build>;
        try {
          edit = build(doc);
        } catch (error) {
          return setSaving({ pending: 0, error: error instanceof Error ? error.message : String(error) });
        }
        if (edit === null) return;
        const invalid = problem(edit.doc);
        if (invalid !== null) return setSaving({ pending: 0, error: `Nie zapisano: ${invalid}` });
        const before = doc;
        const next = edit;
        setDoc(next.doc);
        setSaving((current) => ({ pending: current.pending + 1 }));
        void saveRulesEdit(createClient(), tripId, next, ids).then(
          (known) => {
            setIds(known);
            setSaving((current) => ({ pending: current.pending - 1, ok: true }));
          },
          (error: unknown) => {
            setDoc(before);
            setSaving((current) => ({ pending: current.pending - 1, error: error instanceof Error ? error.message : String(error) }));
          },
        );
      }
    : null;

  const actions: Actions | null = canEdit
    ? {
        move: (ref, direction) => apply(moveWithinDay(doc, ref, direction)),
        moveTo: (ref, dayRef) => apply(moveToDay(doc, ref, dayRef)),
        update: (ref, patch) => apply(updateItem(doc, ref, patch)),
        add: (dayRef, fields) => apply(addItem(doc, dayRef, uuidv7(), fields)),
        remove: (ref) => {
          try {
            apply(removeItemClosingGap(doc, ref));
          } catch (error) {
            setSaving({ pending: 0, error: error instanceof Error ? error.message : String(error) });
          }
        },
      }
    : null;

  // Przeciąganie (HTML5 drag & drop, mysz): uchwyt ⠿ przy punkcie, cel = miejsce przed punktem,
  // koniec dnia albo pula. Strzałki ↑↓ i „przenieś…” zostają — dla klawiatury i ekranów dotykowych.
  const dnd: Dnd | null = canEdit
    ? {
        dragging: drag?.ref ?? null,
        over: drag?.over ?? null,
        start: (ref, event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", ref);
          const row = event.currentTarget.closest("li");
          if (row) event.dataTransfer.setDragImage(row, 16, 16);
          setDrag({ ref, over: null });
        },
        hover: (target, event) => {
          if (drag === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (drag.over?.dayRef !== target.dayRef || drag.over?.nextRef !== target.nextRef) setDrag({ ...drag, over: target });
        },
        drop: (target, event) => {
          if (drag === null) return;
          event.preventDefault();
          setDrag(null);
          apply(dropItem(doc, drag.ref, target.dayRef, target.nextRef));
        },
        end: () => setDrag(null),
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <p className="sticky top-0 z-10 -mx-4 bg-[var(--background)] px-4 py-1 text-xs text-zinc-500">
          {saving.pending > 0 ? "Zapisuję…" : saving.error ? <span className="text-red-600">{saving.error}</span> : saving.ok ? "Zapisano." : "Zmiany zapisują się od razu."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Scenariusz:</span>
        {(["optimistic", "pessimistic"] as const).map((each) => (
          <button
            key={each}
            onClick={() => setScenario(each)}
            className={`rounded-full border px-3 py-1 ${scenario === each ? "border-sea bg-sea text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
            {each === "optimistic" ? "optymistyczny (krótsze czasy)" : "pesymistyczny (dłuższe czasy)"}
          </button>
        ))}
      </div>

      <Coverage doc={doc} />

      {(mapDay !== undefined || showPool) && (
        <DayTabs
          doc={doc}
          current={mapDay?.ref ?? POOL}
          pool={pool.length > 0 || canEdit ? pool.length : null}
          onChoose={(ref) => {
            setMapDay(ref);
            setSelected(null);
            setPick(null);
          }}
          weather={weather}
          dnd={dnd}
          below={canEdit}
        />
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,42%)] lg:items-start">
        {(mapDay !== undefined || showPool) && (
          <aside className="flex flex-col gap-2 lg:sticky lg:top-24 lg:order-last">
            <PlanMap
              map={stableMap}
              fitKey={mapDay?.ref ?? POOL}
              selected={selected}
              onSelect={(ref) => select(ref, "map")}
              editing={
                canEdit
                  ? {
                      picking: pick !== null,
                      picked: pick?.at ?? null,
                      onPick: (at) => {
                        if (pick?.place) {
                          apply(movePlace(doc, pick.place.ref, at));
                          setPick(null);
                        } else setPick({ at });
                      },
                      onMovePlace: (placeRef, at) => apply(movePlace(doc, placeRef, at)),
                    }
                  : null
              }
            />
            {pick?.place && (
              <div className="flex flex-col gap-2 rounded-lg border border-signal/60 p-2 text-sm">
                <p className="text-xs text-zinc-500">Kliknij mapę tam, gdzie jest „{pick.place.name}” — potem pinezkę można przeciągnąć.</p>
                <button onClick={() => setPick(null)} className="self-start text-xs underline">
                  anuluj
                </button>
              </div>
            )}
            {canEdit && mapDay !== undefined && !pick?.place && (
              <div className="flex flex-col gap-2 text-sm">
                {pick === null ? (
                  <button onClick={() => setPick({ at: null })} className="btn-secondary btn-sm self-start">
                    + Dodaj punkt na mapie
                  </button>
                ) : (
                  <div className="flex flex-col gap-2 rounded-lg border border-signal/60 p-2">
                    <p className="text-xs text-zinc-500">
                      {pick.at === null ? "Kliknij mapę w miejscu nowego punktu" : "Nowy punkt w zaznaczonym miejscu"} — na koniec dnia „{weekday(mapDay.date)}”.
                    </p>
                    {pick.at !== null && (
                      <AddItemForm
                        autoFocus
                        onAdd={(fields) => {
                          apply(addItemAtPin(doc, mapDay.ref, { itemId: uuidv7(), placeId: uuidv7() }, pick.at!, fields));
                          setPick(null);
                        }}
                      />
                    )}
                    <button onClick={() => setPick(null)} className="self-start text-xs underline">
                      anuluj
                    </button>
                  </div>
                )}
              </div>
            )}
            {showPool ? (
              <p className="text-xs text-zinc-500">
                Szare kropki: punkty z puli{canEdit && map.pins.some((pin) => pin.movable) ? " · własne pinezki można przeciągnąć" : ""}.
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                Numery = kolejność dnia. Linia ciągła: trasa po drogach („Przelicz przejazdy”), przerywana: prosto między miejscami
                {map.pins.some((pin) => pin.pool) ? " · szare kropki: pula" : ""}
                {map.pins.some((pin) => pin.base) ? " · fioletowa: nocleg" : ""}
                {canEdit && map.pins.some((pin) => pin.movable) ? " · własne pinezki można przeciągnąć" : ""}.
              </p>
            )}
          </aside>
        )}

        <div className="flex flex-col gap-6">
          {doc.days.length === 0 && <p className="text-sm text-zinc-500">Plan nie ma jeszcze dni.</p>}
          {mapDay !== undefined && (
            <Day
              key={mapDay.ref}
              doc={doc}
              dayRef={mapDay.ref}
              options={options}
              active={resolveVariants(doc, variants)}
              onChoose={(groupRef, variantRef) => setOverrides((current) => ({ ...current, [groupRef]: variantRef }))}
              places={places}
              actions={actions}
              onPin={canEdit ? pinPlace : null}
              onRules={onRules}
              dnd={dnd}
              numbers={map.numbers}
              selected={selected}
              onSelect={(ref) => select(ref, "list")}
              weather={weather[mapDay.ref]}
              itemBase={itemBase}
            />
          )}
          {Object.keys(weather).length > 0 && <p className="text-xs text-zinc-500">{WEATHER_ATTRIBUTION}</p>}

          {showPool && (
            <section className="flex flex-col gap-2 card p-4">
              <h2 className="text-lg font-semibold">Pula — poza dniami ({pool.length})</h2>
              {pool.length === 0 && (
                <p className="text-sm text-zinc-500">Pula jest pusta. Punkt trafia tu przez „przenieś… → do puli” albo po przeciągnięciu na przycisk „Pula”.</p>
              )}
              {Object.entries(Object.groupBy(pool, (item) => item.area ?? "bez obszaru")).map(([area, items]) => (
                <div key={area} className="text-sm">
                  <p className="font-medium">{area}</p>
                  <ul className="ml-4 flex flex-col text-zinc-600 dark:text-zinc-400">
                    {items!.map((item) => (
                      <li key={item.ref} id={`item-${item.ref}`} className={`flex items-center gap-1 rounded ${selected === item.ref ? "bg-signal/10" : ""}`}>
                        {dnd ? <DragHandle onStart={(event) => dnd.start(item.ref, event)} onEnd={dnd.end} /> : <span aria-hidden="true">•</span>}
                        <span>
                          {item.title} <span className="text-zinc-500">· {STATUS[item.planStatus]}</span>
                          {item.priority === "must" && <span className="text-zinc-500"> · koniecznie</span>}
                          {missingOnMap(doc, item) && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">brak na mapie</span>}
                          {canEdit && missingOnMap(doc, item) && item.placeRef && (
                            <PinButton onClick={() => pinPlace(item.placeRef!, doc.places.find((place) => place.ref === item.placeRef)?.name ?? item.title)} />
                          )}
                        </span>
                        {actions && <MoveSelect doc={doc} current={undefined} onMove={(dayRef) => actions.moveTo(item.ref, dayRef)} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Przy „brak na mapie” w edycji: wskazanie miejsca kliknięciem w mapę. */
function PinButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="ml-1.5 text-xs text-sea underline dark:text-teal-300">
      postaw pinezkę
    </button>
  );
}

/** Gdzie upuścić punkt: przed `nextRef` w dniu (brak = na koniec dnia) albo do puli (`dayRef: null`). */
type DropTarget = { dayRef: string | null; nextRef?: string };

type Dnd = {
  dragging: string | null;
  over: DropTarget | null;
  start: (ref: string, event: React.DragEvent<HTMLElement>) => void;
  hover: (target: DropTarget, event: React.DragEvent<HTMLElement>) => void;
  drop: (target: DropTarget, event: React.DragEvent<HTMLElement>) => void;
  end: () => void;
};

/**
 * Wybór dnia: mini przyciski nad planem (data, pogoda). Widać jeden dzień, mapa pokazuje ten sam.
 * Ostatni przycisk to pula (punkty poza dniami). Punkt przeciągnięty na przycisk dnia trafia
 * na koniec tego dnia, na „Pulę” — do puli.
 */
function DayTabs({
  doc,
  current,
  pool,
  onChoose,
  weather,
  dnd,
  below,
}: {
  doc: TripDocument;
  current: string;
  /** Liczba punktów w puli; `null` = bez przycisku „Pula”. */
  pool: number | null;
  onChoose: (ref: string) => void;
  weather: Record<string, DayWeather>;
  dnd: Dnd | null;
  below: boolean;
}) {
  const short = (date: string) =>
    new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return (
    // Pod paskiem „Zapisuję…” w trybie edycji; przewija się w bok, gdy dni jest dużo.
    <nav aria-label="Dni planu" className={`sticky ${below ? "top-6" : "top-0"} z-10 -mx-4 flex gap-1.5 overflow-x-auto bg-[var(--background)] px-4 py-2`}>
      {doc.days.map((day, index) => {
        const active = day.ref === current;
        const over = dnd?.dragging != null && dnd.over?.dayRef === day.ref && dnd.over.nextRef === undefined;
        const sky = weather[day.ref];
        return (
          <button
            key={day.ref}
            onClick={() => onChoose(day.ref)}
            onDragOver={dnd ? (event) => dnd.hover({ dayRef: day.ref }, event) : undefined}
            onDrop={dnd ? (event) => dnd.drop({ dayRef: day.ref }, event) : undefined}
            aria-current={active ? "true" : undefined}
            title={day.title ? `${weekday(day.date)} — ${day.title}` : weekday(day.date)}
            className={`flex shrink-0 flex-col items-center rounded-lg border px-2.5 py-1 text-xs leading-tight transition-colors ${
              active ? "border-sea bg-sea text-white" : over ? "border-sea bg-sea-light/60 dark:bg-sea/20" : "border-zinc-300 hover:border-sea dark:border-zinc-700"
            }`}>
            <span className="font-semibold">Dzień {index + 1}</span>
            <span className={active ? "text-white/85" : "text-zinc-500"}>
              {short(day.date)}
              {sky ? ` ${weatherIcon(sky.code)}` : ""}
            </span>
          </button>
        );
      })}
      {pool !== null && (
        <button
          onClick={() => onChoose(POOL)}
          onDragOver={dnd ? (event) => dnd.hover({ dayRef: null }, event) : undefined}
          onDrop={dnd ? (event) => dnd.drop({ dayRef: null }, event) : undefined}
          aria-current={current === POOL ? "true" : undefined}
          title="Punkty poza dniami"
          className={`flex shrink-0 flex-col items-center rounded-lg border border-dashed px-2.5 py-1 text-xs leading-tight transition-colors ${
            current === POOL
              ? "border-solid border-sea bg-sea text-white"
              : dnd?.dragging != null && dnd.over?.dayRef === null
                ? "border-sea bg-sea-light/60 dark:bg-sea/20"
                : "border-zinc-400 hover:border-sea dark:border-zinc-600"
          }`}>
          <span className="font-semibold">Pula</span>
          <span className={current === POOL ? "text-white/85" : "text-zinc-500"}>{pool} pkt</span>
        </button>
      )}
    </nav>
  );
}

function DragHandle({ onStart, onEnd }: { onStart: (event: React.DragEvent<HTMLElement>) => void; onEnd: () => void }) {
  return (
    <span
      draggable
      onDragStart={onStart}
      onDragEnd={onEnd}
      title="Przeciągnij, żeby przenieść"
      aria-hidden="true"
      className="cursor-grab px-0.5 text-zinc-400 select-none hover:text-zinc-700 active:cursor-grabbing dark:hover:text-zinc-200">
      ⠿
    </span>
  );
}

/** Ile planu jest na mapie: miejsca ze współrzędnymi i przejazdy policzone trasą. */
function Coverage({ doc }: { doc: TripDocument }) {
  const { places, legs } = mapCoverage(doc);
  if (places.total === 0 && legs.routable === 0) return null;
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Na mapie {places.onMap} z {places.total} miejsc
      {legs.routable > 0 && ` · przejazdy z trasy: ${legs.routed} z ${legs.routable}`}
      {places.onMap < places.total && " · miejsca bez współrzędnych mają znaczek „brak na mapie”"}
    </p>
  );
}

type Actions = {
  move: (ref: string, direction: -1 | 1) => void;
  moveTo: (ref: string, dayRef: string | null) => void;
  update: (ref: string, patch: Partial<Item>) => void;
  add: (dayRef: string, fields: Pick<Item, "title" | "kind"> & Partial<Item>) => void;
  remove: (ref: string) => void;
};

/** „Przenieś do…” — inny dzień albo pula. */
function MoveSelect({ doc, current, onMove }: { doc: TripDocument; current: string | undefined; onMove: (dayRef: string | null) => void }) {
  return (
    <select
      value=""
      onChange={(event) => onMove(event.target.value === "pool" ? null : event.target.value)}
      className="ml-2 max-w-36 rounded border border-zinc-300 bg-transparent px-1 text-xs text-zinc-500 dark:border-zinc-700"
      aria-label="Przenieś do">
      <option value="">przenieś…</option>
      {doc.days
        .filter((day) => day.ref !== current)
        .map((day) => (
          <option key={day.ref} value={day.ref}>
            {weekday(day.date)}
          </option>
        ))}
      {current !== undefined && <option value="pool">do puli</option>}
    </select>
  );
}

function AddItemForm({ onAdd, autoFocus = false }: { onAdd: (fields: Pick<Item, "title" | "kind"> & Partial<Item>) => void; autoFocus?: boolean }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Item["kind"]>("visit");
  const [duration, setDuration] = useState("60");
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "") return;
        onAdd({ title: title.trim(), kind, durationMin: Number(duration) || undefined });
        setTitle("");
      }}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nowy punkt" autoFocus={autoFocus} className="flex-1 field px-2 py-1" />
      <select value={kind} onChange={(event) => setKind(event.target.value as Item["kind"])} className="field px-2 py-1">
        {Object.entries(KIND).map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
      <input value={duration} onChange={(event) => setDuration(event.target.value)} type="number" min={0} className="w-20 field px-2 py-1" aria-label="Czas trwania w minutach" />
      <span className="text-xs text-zinc-500">min</span>
      <button className="btn-secondary btn-sm">Dodaj</button>
    </form>
  );
}

type DayProps = {
  /** Prognoza dnia (Open-Meteo); brak — dzień poza horyzontem albo bez współrzędnych. */
  weather?: DayWeather;
  doc: TripDocument;
  dayRef: string;
  options: Parameters<typeof scheduleDay>[2];
  active: Set<string>;
  onChoose: (groupRef: string, variantRef: string) => void;
  places: Map<string, TripDocument["places"][number]>;
  actions: Actions | null;
  /** Postawienie pinezki miejscu bez współrzędnych — `null` dla widza. */
  onPin: ((placeRef: string, name: string) => void) | null;
  /** Warianty i ograniczenia — `null` dla widza. */
  onRules: OnRules | null;
  dnd: Dnd | null;
  /** Numery punktów na mapie — tylko dla dnia, który jest na mapie. */
  numbers: Record<string, number> | null;
  selected: string | null;
  onSelect: (ref: string) => void;
  itemBase?: string;
};

/** Kolor kropki na osi dnia według rodzaju punktu. */
const DOT: Record<string, string> = {
  visit: "bg-sea",
  activity: "bg-sea",
  meal: "bg-signal",
  meetup: "bg-signal",
  transport: "bg-zinc-700 dark:bg-zinc-300",
  lodging: "bg-indigo-500",
  errand: "bg-zinc-400",
  free: "bg-emerald-500",
  decision: "bg-amber-500",
};

function Day({ doc, dayRef, options, active, onChoose, places, actions, onPin, onRules, dnd, numbers, selected, onSelect, weather, itemBase }: DayProps) {
  const day = doc.days.find((each) => each.ref === dayRef)!;
  const [editing, setEditing] = useState<string | null>(null);
  const hydrated = useHydrated();
  let schedule: DaySchedule | null = null;
  let failure: string | null = null;
  try {
    // Godziny tylko w przeglądarce — patrz `useHydrated`.
    if (hydrated) schedule = scheduleDay(doc, dayRef, options);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const cuts = schedule?.slack === "negative" || schedule?.warnings.some((each) => each.severity === "hard") ? proposeCuts(doc, dayRef, options) : [];
  const notes = doc.notes.filter((note) => note.scope === "day" && note.targetRef === dayRef);
  const byRef = new Map(doc.items.map((item) => [item.ref, item]));
  const base = day.baseRef === undefined ? undefined : places.get(day.baseRef)?.name;
  const lodging = dayLodging(doc, dayRef);
  const sun = schedule?.facts.sun;

  return (
    <section className="flex flex-col gap-3 card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold first-letter:uppercase">
            {weekday(day.date)}
            {day.title ? ` — ${day.title}` : ""}
          </h2>
          <p className="text-xs text-zinc-500">
            {base ? `baza: ${base} · ` : ""}
            {sun ? `wschód ${hm(sun.sunrise, day.tz)} · zachód ${hm(sun.sunset, day.tz)} · zmrok ${hm(sun.civilDusk, day.tz)}` : "słońce: brak współrzędnych bazy"}
            {schedule?.facts.dst ? " · zmiana czasu" : ""}
          </p>
        </div>
        {schedule?.slack && (
          <span className={`rounded-full px-3 py-1 text-xs ${SLACK[schedule.slack]!.tone}`}>
            {SLACK[schedule.slack]!.label}
            {schedule.slackMin !== null ? ` (${schedule.slackMin} min)` : ""}
          </span>
        )}
      </header>

      {weather && <p className="text-sm font-semibold text-sea dark:text-teal-300">{weatherLine(weather)}</p>}
      {(() => {
        // Niepogoda w dniu z wariantem pogodowym — podpowiedź B (tylko przełączenie widoku, działa też w podglądzie).
        const hint = weatherVariantHint(doc, dayRef, weather);
        if (hint === null || active.has(hint.variantRef)) return null;
        return (
          <button onClick={() => onChoose(hint.groupRef, hint.variantRef)} className="self-start rounded-xl border-2 border-signal/60 bg-signal/5 px-3 py-1.5 text-left text-sm">
            Zapowiada się niepogoda — {hint.group}: <strong>„{hint.variant}”</strong> (pokaż)
          </button>
        );
      })()}

      {day.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{day.summary}</p>}

      <DayVariants doc={doc} dayRef={dayRef} active={active} onChoose={onChoose} onRules={onRules} />

      {failure && <p className="text-sm text-red-600">Nie udało się policzyć dnia: {failure}</p>}

      {schedule && (
        <ol className="flex flex-col gap-1 text-sm">
          {schedule.items.map((item, index) => {
            const source = byRef.get(item.ref);
            const n = numbers?.[item.ref];
            // Górna połowa wiersza = przed tym punktem, dolna = przed następnym widocznym.
            const target = (event: React.DragEvent<HTMLElement>): DropTarget => {
              const box = event.currentTarget.getBoundingClientRect();
              return event.clientY < box.top + box.height / 2 ? { dayRef, nextRef: item.ref } : { dayRef, nextRef: schedule!.items[index + 1]?.ref };
            };
            const dropHere = dnd?.over?.dayRef === dayRef && dnd.over.nextRef === item.ref && dnd.dragging !== item.ref;
            const warnings = schedule.warnings.filter((warning) => warning.itemRef === item.ref);
            const place = source?.placeRef === undefined ? undefined : places.get(source.placeRef)?.name;
            const leg = source === undefined ? null : legLabel(source);
            const flight = source === undefined ? undefined : flightOf(doc, source);
            const flightText = flight === undefined ? undefined : flightLine(flight);
            const offMap = source !== undefined && missingOnMap(doc, source);
            return (
              <li
                key={item.ref}
                id={`item-${item.ref}`}
                onDragOver={dnd && source ? (event) => dnd.hover(target(event), event) : undefined}
                onDrop={dnd && source ? (event) => dnd.drop(target(event), event) : undefined}
                className={`relative flex flex-col border-l-2 border-zinc-200 pb-1.5 pl-4 dark:border-zinc-800 ${source?.parentRef ? "ml-6" : ""} ${selected === item.ref ? "rounded-r bg-signal/10" : ""} ${dnd?.dragging === item.ref ? "opacity-40" : ""}`}>
                {dropHere && <span aria-hidden="true" className="absolute -top-0.5 right-0 left-2 h-1 rounded bg-sea" />}
                <span aria-hidden="true" className={`absolute top-1.5 -left-[7px] size-3 rounded-full ring-2 ring-white dark:ring-zinc-900 ${DOT[item.kind] ?? "bg-zinc-400"}`} />
                <div className="flex gap-3">
                  {dnd && source && (
                    <span className="-ml-3 w-3">
                      <DragHandle onStart={(event) => dnd.start(item.ref, event)} onEnd={dnd.end} />
                    </span>
                  )}
                  <span className="w-28 shrink-0 font-semibold text-ink tabular-nums dark:text-zinc-100">
                    {item.startLocal}–{item.endLocal}
                    {item.endDate !== day.date ? "+1" : ""}
                  </span>
                  <span>
                    {n !== undefined && (
                      <button
                        onClick={() => onSelect(item.ref)}
                        title="Pokaż na mapie"
                        aria-label={`${n} — pokaż na mapie`}
                        className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sea px-1 align-text-bottom text-[10px] font-semibold text-white">
                        {n}
                      </button>
                    )}
                    {source && (
                      <span aria-hidden="true" className="mr-1.5">
                        {itemIcon(doc, source)}
                      </span>
                    )}
                    {itemBase ? (
                      <Link href={`${itemBase}${encodeURIComponent(item.ref)}`} title="Szczegóły i przewodnik" className="font-medium hover:text-sea hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{item.title}</span>
                    )}
                    <span className="text-zinc-500">
                      {" "}
                      · {KIND[item.kind]}
                      {place && place !== item.title ? ` · ${place}` : ""}
                      {item.driftMin > 15 && item.statedLocal ? ` · plan mówi ${item.statedLocal}, wychodzi +${item.driftMin} min` : ""}
                    </span>
                    {offMap && (
                      <span title="Miejsce bez współrzędnych — nie ma go na mapie i nie policzy się do niego trasy" className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        brak na mapie
                      </span>
                    )}
                    {offMap && onPin && source?.placeRef && <PinButton onClick={() => onPin(source.placeRef!, places.get(source.placeRef!)?.name ?? item.title)} />}
                  </span>
                </div>
                {flightText && <p className="ml-31 text-xs font-semibold text-sea dark:text-teal-300">✈ {flightText}</p>}
                {leg && <p className="ml-31 text-xs text-zinc-500">{leg}</p>}
                {warnings.map((warning, index) => (
                  <p key={index} className={`ml-31 text-xs ${warning.severity === "hard" ? "text-red-600" : "text-amber-600"}`}>
                    {warning.severity === "hard" ? "⚠ " : "· "}
                    {warning.message}
                  </p>
                ))}
                {actions && source && (
                  <div className="ml-31 flex min-w-0 flex-wrap items-center gap-1 text-xs text-zinc-500">
                    <button onClick={() => actions.move(item.ref, -1)} aria-label="Wyżej" className="px-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                      ↑
                    </button>
                    <button onClick={() => actions.move(item.ref, 1)} aria-label="Niżej" className="px-1 hover:text-zinc-900 dark:hover:text-zinc-100">
                      ↓
                    </button>
                    <button onClick={() => setEditing(editing === item.ref ? null : item.ref)} className="px-1 underline">
                      edytuj
                    </button>
                    <button
                      onClick={() => window.confirm(`Usunąć „${item.title}” z planu?`) && actions.remove(item.ref)}
                      className="px-1 underline">
                      usuń
                    </button>
                    <MoveSelect doc={doc} current={dayRef} onMove={(target) => actions.moveTo(item.ref, target)} />
                    {onRules && <ItemVariants doc={doc} dayRef={dayRef} itemRef={item.ref} onRules={onRules} />}
                  </div>
                )}
                {actions && source && editing === item.ref && (
                  <ItemEditor
                    item={source}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => {
                      actions.update(item.ref, patch);
                      setEditing(null);
                    }}
                  />
                )}
              </li>
            );
          })}
          {/* Nocleg na koniec dnia (baza dnia / rezerwacja tej nocy) — na mapie fioletowa pinezka. */}
          {lodging && (
            <li className="relative flex flex-col border-l-2 border-zinc-200 pb-1.5 pl-4 dark:border-zinc-800">
              <span aria-hidden="true" className="absolute top-1.5 -left-[7px] size-3 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-zinc-900" />
              <div className="flex gap-3">
                <span className="w-28 shrink-0 font-semibold text-ink tabular-nums dark:text-zinc-100">{lodging.booking?.checkInFrom ? `od ${lodging.booking.checkInFrom}` : ""}</span>
                <span>
                  <span aria-hidden="true" className="mr-1.5">
                    🛏️
                  </span>
                  <span className="font-medium">Nocleg: {lodging.name}</span>
                  <span className="text-zinc-500">
                    {lodging.booking && lodging.booking.title !== lodging.name ? ` · ${lodging.booking.title}` : ""}
                    {lodging.booking?.code ? ` · kod ${lodging.booking.code}` : ""}
                  </span>
                  {!lodging.onMap && (
                    <span title="Miejsce noclegu bez współrzędnych — „Uzupełnij współrzędne miejsc” albo własna pinezka" className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      brak na mapie
                    </span>
                  )}
                  {!lodging.onMap && onPin && lodging.placeRef && <PinButton onClick={() => onPin(lodging.placeRef!, lodging.name)} />}
                </span>
              </div>
            </li>
          )}
          {dnd?.dragging && (
            <li
              onDragOver={(event) => dnd.hover({ dayRef }, event)}
              onDrop={(event) => dnd.drop({ dayRef }, event)}
              className={`rounded border-2 border-dashed px-3 py-2 text-center text-xs ${dnd.over?.dayRef === dayRef && dnd.over.nextRef === undefined ? "border-sea bg-sea-light/40 text-sea dark:bg-sea/10" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}>
              Upuść na koniec dnia
            </li>
          )}
        </ol>
      )}

      {schedule?.warnings
        .filter((warning) => warning.itemRef === undefined)
        .map((warning, index) => (
          <p key={index} className={`text-xs ${warning.severity === "hard" ? "text-red-600" : "text-amber-600"}`}>
            {warning.severity === "hard" ? "⚠ " : "· "}
            {warning.message}
          </p>
        ))}

      {schedule && <DayConstraints doc={doc} dayRef={dayRef} items={schedule.items} warnings={schedule.warnings} onRules={onRules} />}

      {actions && <AddItemForm onAdd={(fields) => actions.add(dayRef, fields)} />}

      {cuts.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Co wyciąć, żeby dzień się spiął (scenariusz pesymistyczny):</p>
          <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">
            {cuts.map((cut) => (
              <li key={cut.itemRef}>
                {cut.title} — zwalnia {cut.freesMin} min{cut.resolves ? " (wystarczy)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500">Notatki dnia ({notes.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {notes.map((note, index) => (
              <li key={index} className="whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                {note.title ? <span className="font-medium">{note.title}: </span> : null}
                {note.body}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
