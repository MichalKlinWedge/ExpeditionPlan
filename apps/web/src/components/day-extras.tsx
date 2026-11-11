"use client";

import { addExtraToPlan, type DayExtraItem, dayExtras, EXTRA_FIT, EXTRA_SCOPE, extraDistanceText, type ExtraScope, extraMinutes, extraTimeText, plural, type PlanEdit, setExtraDismissed, shortDate, type TripDocument } from "@expeditionplan/core";
import { uuidv7 } from "@expeditionplan/sync";
import { useState, useTransition } from "react";

import { findDayExtras } from "@/app/day-extras-actions";
import type { OnRules } from "@/components/day-rules";
import { SparkIcon } from "@/components/icons";

/**
 * „Po drodze i w pobliżu” pod planem dnia: atrakcje przy trasie i miejscach dnia (OSM i pula, wybór i opis AI,
 * objazd policzony przez kod, `core/day-extras.ts`) na wypadek, gdy zostanie czas albo coś wypadnie z planu.
 * W edycji: szukanie z AI, „do planu” (zaraz po punkcie, przy którym leży), odrzucenie i przywrócenie.
 * Bez edycji i na telefonie — tylko podgląd.
 */

type Props = {
  doc: TripDocument;
  dayRef: string;
  tripId: string;
  /** Zapas dnia z silnika (min); `null` — nieznany. */
  slackMin: number | null;
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

export function DayExtras({ doc, dayRef, tripId, slackMin, onEdit, onRules, canFind, selected, onSelect }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  // Doprecyzowanie szukania: gdzie (cały dzień, trasa przejazdu, miasto) i czego (własne słowa dla AI).
  const [scope, setScope] = useState<ExtraScope>("day");
  const [city, setCity] = useState("");
  const [hint, setHint] = useState("");
  const list = dayExtras(doc, dayRef);
  const titles = new Map(doc.items.map((item) => [item.ref, item.title]));
  if (list.open.length === 0 && list.dismissed.length === 0 && !canFind) return null;

  const narrowed = scope !== "day" || hint.trim() !== "";
  const find = () =>
    start(async () => {
      setMessage({});
      setMessage(await findDayExtras(tripId, dayRef, { scope, ...(scope === "city" ? { city } : {}), ...(hint.trim() ? { hint } : {}) }));
    });

  return (
    // Osobna karta pod dniem, zwijana; stan pamięta przeglądarka (`RememberDetails`, wspólny dla dni).
    <details id={`extras-${dayRef}`} open data-remember="po-drodze" className="card p-4 text-sm">
      <summary className="card-title cursor-pointer">
        Po drodze i w pobliżu
        {list.open.length > 0 && <span className="font-normal text-zinc-500"> · {plural(list.open.length, ["atrakcja", "atrakcje", "atrakcji"])}</span>}
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
          {list.fetchedAt !== undefined && (
            <p className="text-xs text-zinc-500">
              {narrowed ? "Wyniki dojdą do listy poniżej." : "Cały dzień bez doprecyzowania wymienia listę (odrzucone i wstawione zostają)."} Długi przejazd autem, też z domu, daje miasta po drodze na przerwę.
            </p>
          )}
        </div>
      )}
      {list.fetchedAt === undefined && (
        <p className="text-xs text-zinc-500">Atrakcje przy trasie i punktach dnia, które da się dorzucić, gdy zostanie czas albo coś wypadnie z planu — z czasem, jaki zajmą. Odrzucone nie wracają przy kolejnym szukaniu.</p>
      )}
      {message.error && <p className="text-xs msg-error">{message.error}</p>}
      {message.ok && <p className="text-xs msg-ok">{message.ok}</p>}
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
                  <button type="button" onClick={() => onSelect(key)} title="Pokaż na mapie" aria-label={`${extra.title} — pokaż na mapie`} className="text-amber-600 dark:text-amber-400">
                    ★
                  </button>
                  <span className="font-medium">{extra.title}</span>
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
                    <a href={extra.wikipedia} target="_blank" rel="noreferrer" className="text-sea underline">
                      Wikipedia
                    </a>
                  )}
                  {extra.website && (
                    <a href={extra.website} target="_blank" rel="noreferrer" className="text-sea underline">
                      strona
                    </a>
                  )}
                  <a href={`https://www.openstreetmap.org/?mlat=${extra.lat}&mlon=${extra.lng}#map=17/${extra.lat}/${extra.lng}`} target="_blank" rel="noreferrer" className="text-sea underline">
                    mapa
                  </a>
                  {onEdit && (
                    <button type="button" onClick={() => onEdit(addExtraToPlan(doc, dayRef, extra.id, { itemId: uuidv7(), placeId: uuidv7() }))} title={near ? `Wstawia do planu zaraz po „${near}”` : "Wstawia na koniec dnia"} className="btn-mini ml-1">
                      do planu
                    </button>
                  )}
                  {onRules && (
                    <button type="button" onClick={() => onRules((current) => setExtraDismissed(current, dayRef, extra.id, true))} className="btn-mini btn-mini-danger">
                      odrzuć
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list.fetchedAt !== undefined && list.open.length === 0 && <p className="text-xs text-zinc-500">Nic więcej przy trasie tego dnia.</p>}
      {list.dismissed.length > 0 && onRules && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">Odrzucone ({list.dismissed.length})</summary>
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
          ; wybór i opis: AI (Gemini); czas objazdu szacunkowy, z odległości. Sprawdzone {shortDate(list.fetchedAt)}.
        </p>
      )}
      </div>
    </details>
  );
}
