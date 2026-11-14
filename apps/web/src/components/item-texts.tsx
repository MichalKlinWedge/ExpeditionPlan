"use client";

import { documentProblem, itemNoteList, setItemTexts, type TripDocument } from "@expeditionplan/core";
import { saveRulesEdit } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { LinkedText } from "@/components/linked-text";
import { NotePhotos } from "@/components/note-photos";
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
        <label
          className="flex flex-col gap-1 text-xs text-zinc-500"
          title={"Jeden tekst o tym, czym jest punkt: co to jest, dlaczego warto, warunki.\nNa karcie punktu (web i telefon) jako akapit. AI dostaje jego skrót jako kontekst (przewodnik, Propozycje AI, „Po drodze i w pobliżu”), więc pisz tu o samym miejscu, nie wskazówki ani linki."}>
          Opis
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Co to jest, dlaczego warto, warunki" className="field px-2 py-1 text-sm text-ink dark:text-zinc-100" />
        </label>
        <label
          className="flex flex-col gap-1 text-xs text-zinc-500"
          title={"Praktyczne wskazówki: jedna linia = jedna uwaga (jak dojść, co zabrać, na co uważać).\nNa karcie punktu jako lista z punktorami; w puli na telefonie widać 2 pierwsze. AI ich nie czyta. Puste linie i powtórzenia znikają przy zapisie."}>
          Uwagi (każda w osobnej linii)
          <textarea value={lines} onChange={(event) => setLines(event.target.value)} rows={Math.max(3, notes.length + 1)} placeholder="np. Na górze wieje, weźcie kurtki." className="field px-2 py-1 text-sm text-ink dark:text-zinc-100" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending} className="btn-primary btn-sm">
            Zapisz
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={pending} className="btn-secondary btn-sm">
            Anuluj
          </button>
          {pending && <span className="text-xs text-zinc-500">Zapisuję…</span>}
        </div>
        {error && <p className="text-xs msg-error">{error}</p>}
      </form>
    );
  }
  return (
    <>
      {item.description && (
        <p className="panel whitespace-pre-line px-3 py-2 font-medium text-ink dark:text-zinc-100">
          <LinkedText text={item.description} />
        </p>
      )}
      {notes.map((note, i) => (
        <p key={i} className="text-zinc-600 dark:text-zinc-400">
          • <LinkedText text={note} />
        </p>
      ))}
      <NotePhotos tripId={tripId} itemRef={itemRef} photos={item.notePhotos ?? []} editing={editing} />
      {editing && (
        <button type="button" onClick={begin} className="btn-mini self-start">
          {item.description || notes.length > 0 ? "zmień opis i uwagi" : "+ opis i uwagi"}
        </button>
      )}
    </>
  );
}
