"use client";

import type { LodgingDraft, LodgingDraftRow } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { readLodging, saveLodging, saveLodgingLink } from "@/app/lodging-actions";
import { SparkIcon } from "@/components/icons";

/**
 * Edycja obiektu noclegu na karcie punktu: link do jego strony oraz dane odczytane przez AI z tekstu
 * wklejonego przez użytkownika. Pola z inną wartością w planie są domyślnie odznaczone.
 */
export function LodgingEditor({ tripId, itemRef, link }: { tripId: string; itemRef: string; link: string | undefined }) {
  const [url, setUrl] = useState(link ?? "");
  const [linkState, setLinkState] = useState<FormState>({});
  const [text, setText] = useState("");
  const [state, setState] = useState<FormState>({});
  const [draft, setDraft] = useState<{ draft: LodgingDraft; rows: LodgingDraftRow[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const read = () =>
    start(async () => {
      const result = await readLodging(tripId, itemRef, text);
      setState(result);
      if (result.draft && result.rows) {
        setDraft({ draft: result.draft, rows: result.rows });
        setPicked(new Set(result.rows.filter((row) => row.current === undefined).map((row) => row.key)));
      } else setDraft(null);
    });

  const save = () =>
    start(async () => {
      const result = await saveLodging(tripId, itemRef, draft!.draft, [...picked]);
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
          Link do obiektu (Booking.com, Airbnb, strona obiektu)
          <input value={url} onChange={(event) => setUrl(event.target.value)} inputMode="url" placeholder="https://www.booking.com/hotel/…" disabled={pending} className="field px-2 py-1 text-sm" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={() => start(async () => setLinkState(await saveLodgingLink(tripId, itemRef, url)))} className="btn-primary btn-sm">
            Zapisz link
          </button>
          {linkState.ok && <span className="text-xs msg-ok">{linkState.ok}</span>}
          {linkState.error && <span className="text-xs msg-error">{linkState.error}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Wklej opis obiektu albo potwierdzenie rezerwacji
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} disabled={pending} placeholder="Zaznacz i skopiuj tekst ze strony obiektu albo z maila, bez danych karty." className="field p-2 text-sm" />
        </label>
        <p className="text-xs text-zinc-500">Booking.com nie pozwala automatycznie czytać swoich stron, więc dane pochodzą tylko z wklejonego tekstu. AI przygotuje szkic, a Ty wybierzesz, co zapisać.</p>
        <button type="button" disabled={pending || text.trim() === ""} onClick={read} className="btn-primary btn-sm self-start">
          <SparkIcon className="size-4" />
          {pending ? "Czytam…" : "Odczytaj dane (AI)"}
        </button>
      </div>

      {draft && (
        <div className="flex flex-col gap-2 panel-ai p-3">
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
      {state.ok && <p className="text-xs msg-ok">{state.ok}</p>}
      {state.error && <p className="text-xs msg-error">{state.error}</p>}
    </div>
  );
}
