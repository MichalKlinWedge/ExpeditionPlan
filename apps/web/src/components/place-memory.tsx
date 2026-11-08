"use client";

import { PLACE_VERDICT, type PlaceMemorySummary, type PlaceVerdict, verdictLabel } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { savePlaceMemory } from "@/app/place-memory-actions";
import { IconAction } from "@/components/icon-action";

/**
 * Pamięć miejsca (`place_memories`): moja ocena „warto / nie warto” i notatka na przyszłość oraz wpisy innych
 * uczestników. Na stronie „Wszystkie miejsca” i przy wybranym miejscu na stronie „Miejsca” wyjazdu. To głos
 * osoby, nie zmiana planu, więc nie czeka na tryb edycji.
 */

export const VERDICT_ICON: Record<PlaceVerdict, string> = { worth: "👍", not_worth: "👎" };

/** Oceny i notatki uczestników oraz moje: „warto” / „nie warto” (drugi klik cofa) i notatka. */
export function PlaceMemory({ placeId, summary }: { placeId: string; summary: PlaceMemorySummary }) {
  const mine = summary.mine;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(mine?.note ?? "");
  const [message, setMessage] = useState<FormState>({});
  const [pending, start] = useTransition();
  const save = (verdict: PlaceVerdict | null, text: string, after?: () => void) =>
    start(async () => {
      const result = await savePlaceMemory(placeId, verdict, text);
      setMessage(result.error ? result : {});
      if (!result.error) after?.();
    });
  const others = summary.entries.filter((entry) => !entry.mine);
  const total = verdictLabel(summary);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["worth", "not_worth"] as const).map((verdict) => {
          const active = mine?.verdict === verdict;
          return (
            <button
              key={verdict}
              type="button"
              disabled={pending}
              aria-pressed={active}
              title={active ? "Cofnij moją ocenę" : `Moja ocena: ${PLACE_VERDICT[verdict]}`}
              onClick={() => save(active ? null : verdict, mine?.note ?? "")}
              className={`btn-mini ${active ? (verdict === "worth" ? "bg-emerald-600! text-white!" : "bg-red-600! text-white!") : ""}`}
            >
              {VERDICT_ICON[verdict]} {PLACE_VERDICT[verdict]}
            </button>
          );
        })}
        {!editing && (
          <IconAction
            kind="edit"
            tip={mine?.note ? "zmień moją notatkę" : "dodaj notatkę na przyszłość"}
            disabled={pending}
            onClick={() => {
              setNote(mine?.note ?? "");
              setEditing(true);
            }}
          />
        )}
        {total !== undefined && <span className="text-xs text-zinc-500">{total}</span>}
      </div>
      {editing ? (
        <div className="flex flex-col gap-1">
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} aria-label="Notatka na przyszłość" placeholder="Np. „rano tłumy, wejść przed 8:00”, „parking tylko za gotówkę”" className="field px-2 py-1 text-sm" />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={pending} onClick={() => save(mine?.verdict ?? null, note, () => setEditing(false))} className="btn-mini">
              zapisz
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(false)} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        mine?.note && (
          <p className="text-zinc-700 dark:text-zinc-300">
            <span className="text-xs text-zinc-500">Ty: </span>
            {mine.note}
          </p>
        )
      )}
      {others.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {others.map((entry) => (
            <li key={entry.userId} className="text-zinc-700 dark:text-zinc-300">
              <span className="font-medium">{entry.author}</span>
              {entry.verdict && (
                <span className={entry.verdict === "worth" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                  {" "}
                  {VERDICT_ICON[entry.verdict]} {PLACE_VERDICT[entry.verdict]}
                </span>
              )}
              {entry.note && <span>: {entry.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {message.error && <p className="text-xs text-red-600">{message.error}</p>}
    </div>
  );
}
