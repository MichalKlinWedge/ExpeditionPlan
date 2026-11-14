"use client";

import { documentProblem, itemNoteList, notesMarkdown, setItemTexts, type TripDocument } from "@expeditionplan/core";
import { saveRulesEdit } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { LinkedText } from "@/components/linked-text";
import { MarkdownField } from "@/components/markdown-field";
import { NoteMarkdown } from "@/components/note-markdown";
import { NotePhotos } from "@/components/note-photos";
import { createClient } from "@/lib/supabase/client";

/**
 * Opis i uwagi na karcie punktu. Uwagi to własne uwagi punktu razem z notatkami przypiętymi do niego,
 * bez powtórzeń, jako jeden tekst z formatowaniem Markdown (`notesMarkdown`; dawne uwagi „jedna w linii”
 * to lista). W trybie edycji „zmień” otwiera oba pola (uwagi: `MarkdownField` z paskiem, podglądem
 * i zachowaniem formatowania przy wklejaniu), zapis przez `setItemTexts` jako jedna pozycja `item.notes`.
 */
export function ItemTexts({ tripId, doc, ids, itemRef, editing }: { tripId: string; doc: TripDocument; ids: Record<string, string>; itemRef: string; editing: boolean }) {
  const router = useRouter();
  const item = doc.items.find((each) => each.ref === itemRef);
  const notes = itemNoteList(doc, itemRef);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(item?.description ?? "");
  const [text, setText] = useState(notesMarkdown(notes));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (item === undefined) return null;

  const begin = () => {
    setDescription(item.description ?? "");
    setText(notesMarkdown(notes));
    setError(null);
    setOpen(true);
  };
  const save = () => {
    const edit = setItemTexts(doc, itemRef, { description, notes: [text] });
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
        <div
          title={
            "Praktyczne wskazówki (jak dojść, co zabrać, na co uważać) z formatowaniem: **pogrubienie**, *kursywa*, ## nagłówek, - lista, 1. lista, [opis](https://…).\nTekst wklejony z Worda, Google Docs albo strony zachowuje pogrubienia, listy i linki. Na karcie punktu i w telefonie widać go sformatowanego, w puli na telefonie 2 pierwsze linie. AI uwag nie czyta."
          }>
          <MarkdownField label="Uwagi" value={text} onChange={setText} rows={Math.max(4, text.split("\n").length + 1)} placeholder="np. Na górze wieje, weźcie **kurtki**." />
        </div>
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
        <p className="whitespace-pre-line font-semibold text-ink dark:text-zinc-100">
          <LinkedText text={item.description} />
        </p>
      )}
      {notes.length > 0 && <NoteMarkdown text={notesMarkdown(notes)} className="text-zinc-600 dark:text-zinc-400" />}
      <NotePhotos tripId={tripId} itemRef={itemRef} photos={item.notePhotos ?? []} editing={editing} />
      {editing && (
        <button type="button" onClick={begin} className="btn-mini self-start">
          {item.description || notes.length > 0 ? "zmień opis i uwagi" : "+ opis i uwagi"}
        </button>
      )}
    </>
  );
}
