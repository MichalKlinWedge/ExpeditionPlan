"use client";

import type { TransitDetailField, TransitDraft, TransitDraftRow } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { drawTransit, readTransit, removeTransit, saveTransit } from "@/app/transit-actions";
import { SparkIcon } from "@/components/icons";

const DETAIL_NAME: Record<TransitDetailField, string> = { segments: "trasę", frequencyMin: "częstotliwość", departures: "odjazdy", instructions: "wskazówki", alternative: "plan B" };

/** Szczegóły przejazdu w edycji: każdy wpis z „usuń” (np. opis z importu, który nie pasuje do nowej trasy). */
export function TransitDetails({ tripId, itemRef, rows }: { tripId: string; itemRef: string; rows: { key: TransitDetailField; text: string }[] }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const remove = (key: TransitDetailField) => {
    if (!window.confirm(`Usunąć ${DETAIL_NAME[key]} z tego przejazdu?`)) return;
    start(async () => setState(await removeTransit(tripId, itemRef, key)));
  };
  return (
    <>
      {rows.map((row) => (
        <p key={row.key}>
          {row.text}{" "}
          <button type="button" disabled={pending} onClick={() => remove(row.key)} className="btn-mini btn-mini-danger">
            usuń
          </button>
        </p>
      ))}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </>
  );
}

/**
 * Przejazd komunikacją na karcie punktu: tekst połączenia wklejony z wyszukiwarki albo ze strony
 * przewoźnika, z którego AI robi szkic (linie, przesiadki, czas, odjazdy). Inaczej niż przy noclegu
 * wszystkie pola są domyślnie zaznaczone: wklejone połączenie to świadoma nowa trasa, a stara z importu
 * zostałaby obok nowego czasu. Przy polach zastępujących plan widać „teraz w planie”.
 */
export function TransitEditor({ tripId, itemRef, routeUrl, canDraw }: { tripId: string; itemRef: string; routeUrl: string | undefined; canDraw: boolean }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<FormState>({});
  const [draft, setDraft] = useState<{ draft: TransitDraft; rows: TransitDraftRow[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const read = () =>
    start(async () => {
      const result = await readTransit(tripId, itemRef, text);
      setState(result);
      if (result.draft && result.rows) {
        setDraft({ draft: result.draft, rows: result.rows });
        setPicked(new Set(result.rows.map((row) => row.key)));
      } else setDraft(null);
    });

  const save = () =>
    start(async () => {
      const result = await saveTransit(tripId, itemRef, draft!.draft, [...picked]);
      setState(result);
      if (result.ok) {
        setDraft(null);
        setText("");
      }
    });

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Wklej połączenie z wyszukiwarki albo ze strony przewoźnika
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} disabled={pending} placeholder="Np. zaznacz i skopiuj trasę z Map Google, Jakdojade albo rozkład ze strony przewoźnika." className="field p-2 text-sm" />
        </label>
        <p className="text-xs text-zinc-500">
          {routeUrl ? (
            <>
              Trasę znajdziesz np. przez{" "}
              <a href={routeUrl} target="_blank" rel="noreferrer" className="underline">
                Mapy Google
              </a>
              , a w mniejszych miastach na stronie lokalnego przewoźnika.
            </>
          ) : (
            "Trasę znajdziesz w Mapach Google, a w mniejszych miastach na stronie lokalnego przewoźnika."
          )}{" "}
          Wyników Google nie wolno zapisywać automatycznie, więc dane pochodzą tylko z wklejonego tekstu. AI przygotuje szkic, a Ty wybierzesz, co zapisać.
        </p>
        <button type="button" disabled={pending || text.trim() === ""} onClick={read} className="btn-primary btn-sm self-start">
          <SparkIcon className="size-4" />
          {pending ? "Czytam…" : "Odczytaj trasę (AI)"}
        </button>
      </div>

      {canDraw && !draft && (
        <div className="flex flex-col gap-1">
          <button type="button" disabled={pending} onClick={() => start(async () => setState(await drawTransit(tripId, itemRef)))} className="btn-secondary btn-sm self-start">
            Narysuj na mapie (OpenStreetMap)
          </button>
          <p className="text-xs text-zinc-500">Przebieg linii między przystankami z OpenStreetMap. Po zapisie nowej trasy rysuje się sam.</p>
        </div>
      )}

      {draft && (
        <div className="flex flex-col gap-2 rounded-lg border border-signal/60 p-3">
          <p className="font-medium">Co zapisać?</p>
          <ul className="flex flex-col gap-1.5">
            {draft.rows.map((row) => (
              <li key={row.key}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={picked.has(row.key)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.key);
                        else next.delete(row.key);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="text-zinc-500">{row.label}:</span> {row.value}
                    {row.current && <span className="block text-xs text-amber-700 dark:text-amber-400">teraz w planie: {row.current}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={pending || picked.size === 0} onClick={save} className="btn-primary btn-sm">
              Zapisz zaznaczone
            </button>
            <button type="button" disabled={pending} onClick={() => setDraft(null)} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </div>
      )}
      {state.ok && <p className="text-xs text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
