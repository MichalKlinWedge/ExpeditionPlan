"use client";

import { addExtraToPlan, type DayExtraItem, dayExtras, type DaySchedule, EXTRA_CATEGORY, EXTRA_FIT, EXTRA_INTEREST, EXTRA_SCOPE, type ExtraCategory, extraFilterText, extraInterest, isExtraFilterNarrow, extraDistanceText, type ExtraScope, extraMinutes, extraTimeText, plural, type PlanEdit, setExtraDismissed, setExtrasDismissed, shortDate, type TripDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import Link from "next/link";
import { useState, useTransition } from "react";

import { extraPlaceWithGuide, findDayExtras } from "@/app/day-extras-actions";
import { DayExtrasExternal } from "@/components/day-extras-external";
import type { OnRules } from "@/components/day-rules";
import { ArticleIcon, GlobeIcon, PinIcon, SparkIcon } from "@/components/icons";
import { DEFAULT_EXTRA_FILTER, setExtraFilter, useExtraFilter } from "@/lib/extra-filter";

/**
 * „Po drodze i w pobliżu” pod planem dnia: atrakcje przy trasie i miejscach dnia (OSM i pula, wybór i opis AI,
 * objazd policzony przez kod, `core/day-extras.ts`) na wypadek, gdy zostanie czas albo coś wypadnie z planu.
 * W edycji: szukanie z AI, „do planu” (zaraz po punkcie, przy którym leży), „miejsce + opis” (miejsce wyjazdu
 * bez punktu planu i jego opis, `extraPlaceWithGuide`), odrzucenie i przywrócenie, a także
 * wytyczne dla zewnętrznego AI i wczytanie jego odpowiedzi (`DayExtrasExternal`).
 * Bez edycji i na telefonie — tylko podgląd.
 */

type Props = {
  doc: TripDocument;
  dayRef: string;
  tripId: string;
  /** Dzień z silnika (warianty oglądane w planie); `null` — nie dało się policzyć. */
  schedule: DaySchedule | null;
  /** Edycja planu (`null` — podgląd). */
  onEdit: ((edit: PlanEdit | null) => void) | null;
  onRules: OnRules | null;
  /** Szukanie z AI (edycja i dostęp do AI). */
  canFind: boolean;
  selected: string | null;
  onSelect: (ref: string) => void;
};

/** Klucz dodatku w wyborze na mapie i w liście (`item-extra:<id>`). */
export const extraKey = (extra: Pick<DayExtraItem, "id">) => `extra:${extra.id}`;

export function DayExtras({ doc, dayRef, tripId, schedule, onEdit, onRules, canFind, selected, onSelect }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  // Doprecyzowanie szukania: gdzie (cały dzień, trasa przejazdu, miasto) i czego (własne słowa dla AI).
  const [scope, setScope] = useState<ExtraScope>("day");
  const [city, setCity] = useState("");
  const [hint, setHint] = useState("");
  // „miejsce + opis” w toku (klucz atrakcji).
  const [describing, setDescribing] = useState<string | null>(null);
  const [placeNote, setPlaceNote] = useState<{ id: string; ok?: string; error?: string } | null>(null);
  // Zaznaczone na liście (odrzucanie wielu naraz); liczą się tylko widoczne po filtrze.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const slackMin = schedule?.slackMin ?? null;
  // Rodzaje i atrakcyjność: ustawienie tej przeglądarki, wspólne z mapą i znacznikami przy punktach.
  const filter = useExtraFilter();
  const list = dayExtras(doc, dayRef, filter);
  const marked = list.open.filter((extra) => checked.has(extra.id));
  const toggle = (id: string) => setChecked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const dismissMarked = () => {
    if (onRules === null || marked.length === 0) return;
    const ids = marked.map((extra) => extra.id);
    onRules((current) => setExtrasDismissed(current, dayRef, ids, true));
    setChecked(new Set());
  };
  const titles = new Map(doc.items.map((item) => [item.ref, item.title]));
  if (list.open.length === 0 && list.hidden === 0 && list.dismissed.length === 0 && !canFind && onRules === null) return null;
  const toggleCategory = (category: ExtraCategory) =>
    setExtraFilter({ ...filter, categories: filter.categories.includes(category) ? filter.categories.filter((each) => each !== category) : [...filter.categories, category] });

  const narrowed = scope !== "day" || hint.trim() !== "" || filter.categories.length > 0;
  const describe = (extra: DayExtraItem) => {
    setDescribing(extra.id);
    start(async () => {
      setPlaceNote(null);
      const result = await extraPlaceWithGuide(tripId, dayRef, extra.id);
      setPlaceNote({ id: extra.id, ...(result.error ? { error: result.error } : { ok: result.ok ?? "" }) });
      setDescribing(null);
    });
  };
  const placeNames = new Map(doc.places.map((place) => [place.ref, place.name]));
  const iconLink = "inline-flex size-7 items-center justify-center rounded text-sea hover:bg-zinc-100 dark:hover:bg-zinc-800";
  const find = () =>
    start(async () => {
      setMessage({});
      setMessage(await findDayExtras(tripId, dayRef, { scope, ...(scope === "city" ? { city } : {}), ...(hint.trim() ? { hint } : {}), ...(isExtraFilterNarrow(filter) ? { filter } : {}) }));
    });

  return (
    // Osobna karta pod dniem, zwijana; stan pamięta przeglądarka (`RememberDetails`, wspólny dla dni).
    <details id={`extras-${dayRef}`} open data-remember="po-drodze" className="card p-4 text-sm">
      <summary className="card-title cursor-pointer">
        Po drodze i w pobliżu
        {list.open.length > 0 && <span className="font-normal text-zinc-500"> · {plural(list.open.length, ["atrakcja", "atrakcje", "atrakcji"])}</span>}
        {list.hidden > 0 && <span className="font-normal text-zinc-500"> (+{list.hidden} ukrytych filtrem)</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-2">
      {canFind && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Gdzie szukać</span>
            {(Object.keys(EXTRA_SCOPE) as ExtraScope[]).map((each) => (
              <button key={each} type="button" onClick={() => setScope(each)} disabled={pending} aria-pressed={scope === each} className="toggle-chip">
                {EXTRA_SCOPE[each]}
              </button>
            ))}
            {scope === "city" && (
              <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} placeholder="np. Brno" aria-label="Miasto, w którym szukać" className="field w-48 px-2 py-1 text-sm" />
            )}
          </div>
          <input
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            maxLength={300}
            placeholder="Doprecyzuj (opcjonalnie): np. przerwa na obiad w połowie drogi, zamki i punkty widokowe, coś dla dzieci"
            aria-label="Doprecyzowanie dla AI"
            className="field w-full max-w-2xl px-2 py-1 text-sm"
          />
          <button type="button" onClick={find} disabled={pending || (scope === "city" && city.trim() === "")} className="btn-secondary btn-sm self-start">
            <SparkIcon className="size-4" />
            {pending ? "Szukam…" : narrowed ? "Szukaj i dopisz (AI)" : list.fetchedAt ? "Szukaj od nowa (AI)" : "Znajdź atrakcje (AI)"}
          </button>
          {isExtraFilterNarrow(filter) && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Szukam tylko: {extraFilterText(filter)} — jak w filtrze niżej; reszta nie trafi na listę ani na mapę.
            </p>
          )}
          {list.fetchedAt !== undefined && (
            <p className="text-xs text-zinc-500">
              {narrowed ? "Wyniki dojdą do listy poniżej." : "Cały dzień bez doprecyzowania wymienia listę (odrzucone i wstawione zostają)."} Długi przejazd autem, też z domu, daje miasta po drodze na przerwę.
            </p>
          )}
        </div>
      )}
      {onRules && schedule && <DayExtrasExternal doc={doc} dayRef={dayRef} schedule={schedule} onRules={onRules} />}
      {list.fetchedAt === undefined && (
        <p className="text-xs text-zinc-500">Atrakcje przy trasie i punktach dnia, które da się dorzucić, gdy zostanie czas albo coś wypadnie z planu — z czasem, jaki zajmą. Odrzucone nie wracają przy kolejnym szukaniu.</p>
      )}
      {message.error && <p className="text-xs msg-error">{message.error}</p>}
      {message.ok && <p className="text-xs msg-ok">{message.ok}</p>}
      {(canFind || list.open.length + list.hidden > 0) && (
        // Filtr listy i szukania: atrakcyjność (od AI, 1–3) i rodzaje z liczbą otwartych; puste rodzaje = wszystkie.
        // Widać go też przed pierwszym szukaniem — zawęża, czego szukać.
        <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Atrakcyjność</span>
            {([3, 2, 1] as const).map((level) => (
              <button key={level} type="button" onClick={() => setExtraFilter({ ...filter, minInterest: level })} aria-pressed={filter.minInterest === level} className="toggle-chip">
                {"★".repeat(level)} {EXTRA_INTEREST[level]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Rodzaje</span>
            {(Object.keys(EXTRA_CATEGORY) as ExtraCategory[])
              // Bez listy wszystkie rodzaje (do szukania); z listą — te, które na niej są, i wybrane.
              .filter((category) => list.open.length + list.hidden === 0 || canFind || (list.categories[category] ?? 0) > 0 || filter.categories.includes(category))
              .map((category) => (
                <button key={category} type="button" onClick={() => toggleCategory(category)} aria-pressed={filter.categories.includes(category)} className="toggle-chip">
                  {EXTRA_CATEGORY[category]}
                  {(list.categories[category] ?? 0) > 0 && <span className="text-zinc-500"> {list.categories[category]}</span>}
                </button>
              ))}
            {filter.categories.length > 0 && (
              <button type="button" onClick={() => setExtraFilter({ ...filter, categories: [] })} className="btn-mini">
                wszystkie rodzaje
              </button>
            )}
          </div>
          {list.hidden > 0 && (
            <p className="text-xs text-zinc-500">
              Filtr ukrywa {plural(list.hidden, ["atrakcję", "atrakcje", "atrakcji"])} — też na mapie i przy punktach.{" "}
              <button type="button" onClick={() => setExtraFilter({ categories: [], minInterest: 1 })} className="btn-mini">
                pokaż wszystkie
              </button>
              {(filter.minInterest !== DEFAULT_EXTRA_FILTER.minInterest || filter.categories.length > 0) && (
                <button type="button" onClick={() => setExtraFilter(DEFAULT_EXTRA_FILTER)} className="btn-mini ml-1">
                  domyślny
                </button>
              )}
            </p>
          )}
        </div>
      )}
      {onRules && list.open.length > 1 && (
        // Odrzucanie wielu naraz: zaznacz wszystkie widoczne albo pojedynczo przy nazwach.
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={marked.length === list.open.length}
              ref={(box) => {
                if (box) box.indeterminate = marked.length > 0 && marked.length < list.open.length;
              }}
              onChange={() => setChecked(marked.length === list.open.length ? new Set() : new Set(list.open.map((extra) => extra.id)))}
            />
            zaznacz wszystkie widoczne ({list.open.length})
          </label>
          {marked.length > 0 && (
            <>
              <button type="button" onClick={dismissMarked} className="btn-mini btn-mini-danger">
                odrzuć zaznaczone ({marked.length})
              </button>
              <button type="button" onClick={() => setChecked(new Set())} className="btn-mini">
                odznacz
              </button>
            </>
          )}
        </div>
      )}
      {list.open.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.open.map((extra) => {
            const key = extraKey(extra);
            const minutes = extraMinutes(extra);
            const near = extra.nearRef === undefined ? undefined : titles.get(extra.nearRef);
            const swap = extra.swapRef === undefined ? undefined : titles.get(extra.swapRef);
            return (
              <li key={extra.id} id={`item-${key}`} className={`flex flex-col gap-0.5 rounded px-1 ${selected === key ? "bg-signal/10" : ""}`}>
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  {onRules && <input type="checkbox" checked={checked.has(extra.id)} onChange={() => toggle(extra.id)} aria-label={`Zaznacz: ${extra.title}`} className="self-center" />}
                  <button type="button" onClick={() => onSelect(key)} title="Pokaż na mapie" aria-label={`${extra.title} — pokaż na mapie`} className="text-amber-600 dark:text-amber-400">
                    ★
                  </button>
                  <span className="font-medium">{extra.title}</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400" title="Atrakcyjność (ocena AI): ★★★ wyjątkowe, ★★ warte uwagi, ★ drobne">
                    {"★".repeat(extraInterest(extra))}
                  </span>
                  {extra.type && <span className="text-zinc-500">· {extra.type}</span>}
                  {extra.town && <span className="text-zinc-500">· {extra.town}</span>}
                  {extra.poolRef && <span className="rounded bg-sky-100 px-1 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">z puli</span>}
                  {extra.weather === "indoor" && <span className="rounded bg-zinc-100 px-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">pod dachem</span>}
                </div>
                <p className="text-xs">
                  <span className={extra.fit === "pass" ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium"}>{extraTimeText(extra)}</span>
                  <span className="text-zinc-500">
                    {" "}
                    · {EXTRA_FIT[extra.fit]} · {extraDistanceText(extra)}
                    {near ? ` · przy „${near}”` : ""}
                  </span>
                  {extra.fit !== "pass" && slackMin !== null && (
                    <span className={minutes <= slackMin ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      {" "}
                      · {minutes <= slackMin ? "mieści się w zapasie dnia" : "więcej niż zapas dnia"}
                    </span>
                  )}
                </p>
                {swap && <p className="text-xs text-zinc-600 dark:text-zinc-400">⇄ może zastąpić „{swap}”, gdy wypadnie</p>}
                {extra.why && <p className="text-xs text-zinc-600 dark:text-zinc-400">{extra.why}</p>}
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {extra.wikipedia && (
                    <a href={extra.wikipedia} target="_blank" rel="noreferrer" title="Wikipedia" aria-label={`${extra.title} — Wikipedia`} className={iconLink}>
                      <ArticleIcon className="size-4" />
                    </a>
                  )}
                  {extra.website && (
                    <a href={extra.website} target="_blank" rel="noreferrer" title={`Strona: ${extra.website}`} aria-label={`${extra.title} — strona`} className={iconLink}>
                      <GlobeIcon className="size-4" />
                    </a>
                  )}
                  <a href={`https://www.openstreetmap.org/?mlat=${extra.lat}&mlon=${extra.lng}#map=17/${extra.lat}/${extra.lng}`} target="_blank" rel="noreferrer" title="Mapa (OpenStreetMap)" aria-label={`${extra.title} — mapa`} className={iconLink}>
                    <PinIcon className="size-4" />
                  </a>
                  {onEdit && (
                    <button type="button" onClick={() => onEdit(addExtraToPlan(doc, dayRef, extra.id, { itemId: uuidv7(), placeId: uuidv7() }))} title={near ? `Wstawia do planu zaraz po „${near}”` : "Wstawia na koniec dnia"} className="btn-mini ml-1">
                      do planu
                    </button>
                  )}
                  {extra.placeRef !== undefined && placeNames.has(extra.placeRef) ? (
                    <Link href={`/trips/${tripId}/places?miejsce=${encodeURIComponent(extra.placeRef)}`} title="Miejsce z opisem na stronie „Miejsca”" className="btn-mini">
                      miejsce i opis
                    </Link>
                  ) : (
                    canFind && (
                      <button type="button" onClick={() => describe(extra)} disabled={pending} title="Dodaje miejsce do wyjazdu (bez punktu planu) i przygotowuje jego opis z Wikipedii" className="btn-mini">
                        <SparkIcon className="size-3.5" />
                        {describing === extra.id ? "Przygotowuję…" : "miejsce + opis"}
                      </button>
                    )
                  )}
                  {onRules && (
                    <button type="button" onClick={() => onRules((current) => setExtraDismissed(current, dayRef, extra.id, true))} className="btn-mini btn-mini-danger">
                      odrzuć
                    </button>
                  )}
                </div>
                {placeNote?.id === extra.id && <p className={`text-xs ${placeNote.error ? "msg-error" : "msg-ok"}`}>{placeNote.error ?? placeNote.ok}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {list.fetchedAt !== undefined && list.open.length === 0 && list.hidden === 0 && <p className="text-xs text-zinc-500">Nic więcej przy trasie tego dnia.</p>}
      {list.dismissed.length > 0 && onRules && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">Odrzucone ({list.dismissed.length})</summary>
          {list.dismissed.length > 1 && (
            <button type="button" onClick={() => onRules((current) => setExtrasDismissed(current, dayRef, list.dismissed.map((extra) => extra.id), false))} className="btn-mini mt-1">
              przywróć wszystkie
            </button>
          )}
          <ul className="mt-1 flex flex-col gap-1">
            {list.dismissed.map((extra) => (
              <li key={extra.id} className="flex flex-wrap items-center gap-1.5">
                <span>{extra.title}</span>
                <button type="button" onClick={() => onRules((current) => setExtraDismissed(current, dayRef, extra.id, false))} className="btn-mini">
                  przywróć
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {list.fetchedAt !== undefined && (
        <p className="text-xs text-zinc-500">
          Atrakcje:{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
            © OpenStreetMap
          </a>{" "}
          (ODbL),{" "}
          <a href="https://openstreetmap.org/fixthemap" target="_blank" rel="noreferrer" className="underline">
            zgłoś błąd
          </a>
          ; wybór i opis: AI (Gemini albo wczytane z zewnętrznego AI); czas objazdu szacunkowy, z odległości. Sprawdzone {shortDate(list.fetchedAt)}.
        </p>
      )}
      </div>
    </details>
  );
}
