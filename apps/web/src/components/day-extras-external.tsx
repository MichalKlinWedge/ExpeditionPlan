"use client";

import { type DaySchedule, externalExtrasBrief, type ExternalSkip, importExternalExtras, localToday, parseExternalExtras, plural, type TripDocument } from "@expeditionplan/core";
import { useMemo, useState } from "react";

import type { OnRules } from "@/components/day-rules";

/**
 * „Po drodze i w pobliżu” z zewnętrznego AI: wytyczne z danymi dnia do pobrania albo skopiowania (`externalExtrasBrief`),
 * odpowiedź w ustalonym formacie JSON wklejona tutaj trafia do listy dnia (`importExternalExtras`; zapis jak inne
 * ustawienia dnia, `onRules`). Dla organizatora i edytora w edycji, bez dostępu do AI aplikacji.
 */
export function DayExtrasExternal({ doc, dayRef, schedule, onRules }: { doc: TripDocument; dayRef: string; schedule: DaySchedule; onRules: OnRules }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ ok?: string; error?: string; skipped?: ExternalSkip[] }>({});
  const date = doc.days.find((each) => each.ref === dayRef)?.date ?? "";
  const brief = useMemo(() => (open ? externalExtrasBrief(doc, dayRef, schedule) : ""), [open, doc, dayRef, schedule]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-mini self-start" title="Wytyczne dla ChatGPT, Claude albo Gemini i wczytanie ich odpowiedzi do listy">
        zewnętrzne AI…
      </button>
    );
  }

  const load = () => {
    const parsed = parseExternalExtras(text);
    if ("error" in parsed) return setMessage({ error: parsed.error });
    const refs = schedule.items.map((item) => item.ref);
    // Wynik liczony od dokumentu z chwili kliknięcia; zapis przez `onRules` jak odrzucenie.
    const result = importExternalExtras(doc, dayRef, refs, parsed.data, localToday());
    if (result.edit !== null) {
      onRules((current) => importExternalExtras(current, dayRef, refs, parsed.data, localToday()).edit);
      setText("");
    }
    const dateNote = result.wrongDate ? ` Uwaga: odpowiedź jest dla dnia ${result.wrongDate}, a wczytałem ją do ${date}.` : "";
    setMessage(
      result.added > 0
        ? { ok: `Dopisano ${plural(result.added, ["atrakcję", "atrakcje", "atrakcji"])}.${dateNote}`, skipped: result.skipped }
        : { error: `Nic nie doszło do listy.${dateNote}`, skipped: result.skipped },
    );
  };

  return (
    <div className="panel flex flex-col gap-2 p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium">Zewnętrzne AI</span>
        <button type="button" onClick={() => setOpen(false)} className="btn-mini ml-auto">
          zwiń
        </button>
      </div>
      <p className="text-zinc-600 dark:text-zinc-400">
        Gdy podpowiedzi jest za mało: 1) pobierz albo skopiuj wytyczne z planem dnia, trasą i formatem odpowiedzi, 2) wklej je do ChatGPT, Claude albo Gemini (najlepiej z wyszukiwaniem w sieci), 3) jego odpowiedź (JSON) wklej niżej. Odległość, objazd i punkt planu, przy którym leży, policzy aplikacja; atrakcje dalej niż 25 km od trasy dnia odpadną. W wytycznych są punkty planu z godzinami i współrzędnymi oraz wiek uczestników — bez imion.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(brief)}`} download={`po-drodze-${date}.md`} className="btn-secondary btn-sm">
          Pobierz wytyczne (.md)
        </a>
        <button type="button" onClick={() => void navigator.clipboard.writeText(brief).then(() => setCopied(true))} className="btn-secondary btn-sm">
          {copied ? "Skopiowane" : "Kopiuj wytyczne"}
        </button>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder='Wklej odpowiedź AI: { "format": "expeditionplan.day-extras/1", "items": [ … ] }' aria-label="Odpowiedź zewnętrznego AI" className="field px-2 py-1 font-mono text-xs" />
      <button type="button" onClick={load} disabled={text.trim() === ""} className="btn-primary btn-sm self-start">
        Wczytaj do listy
      </button>
      {message.error && <p className="msg-error">{message.error}</p>}
      {message.ok && <p className="msg-ok">{message.ok}</p>}
      {message.skipped && message.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-zinc-500">Pominięte ({message.skipped.length})</summary>
          <ul className="mt-1 ml-4 list-disc text-zinc-600 dark:text-zinc-400">
            {message.skipped.map((each, index) => (
              <li key={index}>
                {each.title} — {each.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
