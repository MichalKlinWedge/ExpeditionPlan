"use client";

import { applyBriefImport, type BriefDraft, type BriefImport as BriefImportDraft, type BriefImportField, briefImportRows } from "@expeditionplan/core";
import { useState, useTransition } from "react";

import { readBriefImport } from "@/app/brief-import-actions";
import { SparkIcon } from "@/components/icons";

/**
 * „Wczytaj z dokumentu” w kreatorze briefu: plik przygotowany poza aplikacją (PDF, DOCX, TXT/MD, zdjęcie strony)
 * albo wklejony tekst → szkic AI → podgląd pole po polu → wybrane pola trafiają do formularza. Zapis to dalej
 * „Zapisz brief”. Zmiana wpisanej już wartości jest domyślnie odznaczona; listy tylko dopisują nowe pozycje.
 */

const ACCEPT = [".pdf", ".docx", ".txt", ".md", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const AI_FILE_BYTES = 3_800_000;

export function BriefImport({ tripId, tripTz, draft, onApply }: { tripId: string; tripTz: string; draft: BriefDraft; onApply: (next: BriefDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [found, setFound] = useState<BriefImportDraft | null>(null);
  const [picked, setPicked] = useState<Set<BriefImportField>>(new Set());
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const rows = found === null ? [] : briefImportRows(draft, found, tripTz);

  const reset = () => {
    setFile(null);
    setText("");
    setFound(null);
    setPicked(new Set());
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => (setOpen(true), setMessage({}))} className="btn-secondary btn-sm self-start">
          <SparkIcon className="size-4" />
          Wczytaj z dokumentu
        </button>
        {message.ok && <p className="text-xs msg-ok">{message.ok}</p>}
      </div>
    );
  }

  const read = () =>
    start(async () => {
      setMessage({});
      if (file !== null && file.size > AI_FILE_BYTES) return setMessage({ error: "Plik jest za duży do odczytu przez AI (limit ok. 3,8 MB). Wklej najważniejszą część jako tekst." });
      const form = new FormData();
      if (file !== null) form.set("file", file);
      else form.set("text", text);
      const result = await readBriefImport(tripId, form);
      if (result.error || !result.draft) return setMessage({ error: result.error ?? "Nie udało się odczytać dokumentu." });
      const next = briefImportRows(draft, result.draft, tripTz);
      setFound(result.draft);
      setPicked(new Set(next.filter((row) => row.current === undefined).map((row) => row.key)));
      if (result.ok) setMessage({ ok: result.ok });
    });

  const apply = () => {
    onApply(applyBriefImport(draft, found!, tripTz, [...picked]));
    reset();
    setOpen(false);
    setMessage({ ok: "Wstawiono do briefu. Sprawdź kroki i zapisz brief." });
  };

  return (
    <div className={`flex flex-col gap-3 p-3 text-sm ${found ? "panel-ai" : "panel"}`}>
      <p className="font-medium">Brief z dokumentu</p>
      {found === null ? (
        <>
          <p className="text-xs text-zinc-500">Plan, notatki albo rozpiska przygotowane wcześniej poza aplikacją. AI (Gemini) odczyta z nich cel, miejsca, ograniczenia, rzeczy już ustalone i resztę wskazówek dla planisty, a Ty wybierzesz, co wstawić.</p>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Plik: PDF, DOCX, TXT, MD albo zdjęcie strony
            <input type="file" accept={ACCEPT.join(",")} disabled={pending} onChange={(event) => (setFile(event.target.files?.[0] ?? null), setMessage({}))} className="text-sm" />
          </label>
          {file === null && (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              albo wklej tekst dokumentu
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} disabled={pending} placeholder="Skopiuj treść planu albo notatek." className="field p-2 text-sm" />
            </label>
          )}
          <p className="text-xs text-zinc-500">Dokument nie zostaje w aplikacji. Danych osobowych i płatniczych AI nie przepisuje.</p>
          <div className="flex gap-2">
            <button type="button" disabled={pending || (file === null && text.trim() === "")} onClick={read} className="btn-primary btn-sm">
              <SparkIcon className="size-4" />
              {pending ? "Czytam…" : "Odczytaj (AI)"}
            </button>
            <button type="button" disabled={pending} onClick={() => (reset(), setMessage({}), setOpen(false))} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-zinc-500">Dokument nie wnosi nic nowego do briefu.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <li key={row.key}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.has(row.key)}
                      disabled={pending}
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.key);
                          else next.delete(row.key);
                          return next;
                        })
                      }
                    />
                    <span className="whitespace-pre-line">
                      <span className="text-zinc-500">{row.label}:</span> {row.value}
                      {row.current && <span className="block text-xs text-amber-700 dark:text-amber-400">teraz w briefie: {row.current}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={picked.size === 0} onClick={apply} className="btn-primary btn-sm">
              Wstaw zaznaczone
            </button>
            <button type="button" onClick={() => (reset(), setMessage({}))} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </>
      )}
      {message.ok && found !== null && <p className="text-xs msg-ok">{message.ok}</p>}
      {message.error && <p className="text-xs msg-error">{message.error}</p>}
    </div>
  );
}
