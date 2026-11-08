"use client";

import { documentProblem, itemNoteList, setItemTexts, type TripDocument } from "@expeditionplan/core";
import { saveRulesEdit } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Opis i uwagi na karcie punktu. Uwagi to własne uwagi punktu razem z notatkami przypiętymi do niego,
 * bez powtórzeń; w trybie edycji „zmień” otwiera oba pola (uwagi: jedna w linii), zapis przez `setItemTexts`.
 */
export function ItemTexts({ tripId, doc, ids, itemRef, editing }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; editing: boolean }) {
  const router = useRouter();
  const item = doc.items.find((each) => each.ref === itemRef);
  const notes = itemNoteList(doc, itemRef);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(item?.description ?? "");
  const [lines, setLines] = useState(notes.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (item === undefined) return null;

  const begin = () => {
    setDescription(item.description ?? "");
    setLines(notes.join("\n"));
    setError(null);
    setOpen(true);
  };
  const save = () => {
    const edit = setItemTexts(doc, itemRef, { description, notes: lines.split("\n") });
    if (edit === null) return setOpen(false);
    const invalid = documentProblem(edit.doc);
    if (invalid !== null) return setError(`Nie zapisano: ${invalid}`);
    start(async () => {
      try {
        await saveRulesEdit(createClient(), tripId, edit, ids);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (open) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Opis
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Co to jest, dlaczego warto, warunki" className="field px-2 py-1 text-sm text-ink dark:text-zinc-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Uwagi (każda w osobnej linii)
          <textarea value={lines} onChange={(event) => setLines(event.target.value)} rows={Math.max(3, notes.length + 1)} placeholder="np. Na górze wieje, weźcie kurtki." className="field px-2 py-1 text-sm text-ink dark:text-zinc-100" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending} className="btn-secondary btn-sm">
            Zapisz
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn-mini">
            anuluj
          </button>
          {pending && <span className="text-xs text-zinc-500">Zapisuję…</span>}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    );
  }
  return (
    <>
      {item.description && <p className="whitespace-pre-line">{item.description}</p>}
      {notes.map((note, i) => (
        <p key={i} className="text-zinc-600 dark:text-zinc-400">
          • {note}
        </p>
      ))}
      {editing && (
        <button type="button" onClick={begin} className="btn-mini self-start">
          {item.description || notes.length > 0 ? "zmień opis i uwagi" : "+ opis i uwagi"}
        </button>
      )}
    </>
  );
}
