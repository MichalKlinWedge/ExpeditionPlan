"use client";

import { type BookingDraft, type BookingDraftRow, codeLabel, DOCUMENT_MIME, formatBytes, MAX_DOCUMENT_BYTES } from "@expeditionplan/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { type BookingTarget, previewBookingImport, readBookingImport, saveBookingImport } from "@/app/booking-import-actions";
import { SparkIcon } from "@/components/icons";
import { type DetectedCode, detectCode } from "@/lib/barcode";
import { uploadToVault } from "@/lib/vault-upload";

/**
 * Import rezerwacji z potwierdzenia: plik (PDF, zrzut ekranu) albo wklejony mail → szkic AI →
 * podgląd pole po polu (pola z inną wartością w planie domyślnie odznaczone) → zapis do nowej albo
 * wskazanej rezerwacji, a plik do sejfu przy niej, z kodem odczytanym z pliku (karta pokładowa, voucher).
 */

/** Plik do AI: akcja przyjmuje do 4 MB, więc większy obraz idzie zmniejszony; do sejfu zawsze oryginał. */
const AI_FILE_BYTES = 3_800_000;
const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

async function shrinkForAi(file: File): Promise<File | string> {
  if (file.size <= AI_FILE_BYTES) return file;
  if (file.type === "application/pdf") return "PDF jest za duży do odczytu przez AI (limit ok. 3,8 MB) — wklej treść potwierdzenia jako tekst albo dodaj rezerwację ręcznie.";
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob === null || blob.size > AI_FILE_BYTES) return "Zdjęcie jest za duże do odczytu przez AI — zrób mniejszy zrzut ekranu.";
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return "Nie udało się zmniejszyć zdjęcia — zrób mniejszy zrzut ekranu (JPG albo PNG).";
  }
}

type Preview = { draft: BookingDraft; targetRef: string | null; rows: BookingDraftRow[]; targets: BookingTarget[] };

const defaultPicked = (rows: BookingDraftRow[]) => new Set(rows.filter((row) => row.current === undefined).map((row) => row.key));

export function BookingImport({ tripId, owner }: { tripId: string; owner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState<DetectedCode | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toVault, setToVault] = useState(true);
  const [ownerOnly, setOwnerOnly] = useState(false);
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  const reset = () => {
    setFile(null);
    setCode(null);
    setText("");
    setPreview(null);
    setPicked(new Set());
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <button onClick={() => setOpen(true)} className="btn-secondary btn-sm self-start">
          <SparkIcon className="size-4" />
          Importuj z potwierdzenia
        </button>
        {message.ok && <p className="text-xs msg-ok">{message.ok}</p>}
      </div>
    );
  }

  const choose = (chosen: File | null) => {
    setFile(chosen);
    setCode(null);
    setPreview(null);
    setMessage({});
    if (chosen === null) return;
    if (!ACCEPT.includes(chosen.type)) return setMessage({ error: "AI czyta PDF i zdjęcia (JPG, PNG, WebP, HEIC)." });
    // Kod z pliku (QR na karcie pokładowej, Aztec na bilecie) — do sejfu, jak przy zwykłym wgrywaniu.
    void detectCode(chosen)
      .then(setCode)
      .catch(() => setCode(null));
  };

  const read = () =>
    start(async () => {
      setMessage({});
      const form = new FormData();
      if (file !== null) {
        const forAi = await shrinkForAi(file);
        if (typeof forAi === "string") return setMessage({ error: forAi });
        form.set("file", forAi);
      } else form.set("text", text);
      const result = await readBookingImport(tripId, form);
      if (result.error || !result.draft || !result.rows) return setMessage({ error: result.error ?? "Nie udało się odczytać dokumentu." });
      setPreview({ draft: result.draft, targetRef: result.targetRef ?? null, rows: result.rows, targets: result.targets ?? [] });
      setPicked(defaultPicked(result.rows));
    });

  const retarget = (targetRef: string | null) =>
    start(async () => {
      const result = await previewBookingImport(tripId, preview!.draft, targetRef);
      if (result.error || !result.rows) return setMessage({ error: result.error ?? "Nie udało się przygotować podglądu." });
      setMessage({});
      setPreview({ ...preview!, targetRef, rows: result.rows });
      setPicked(defaultPicked(result.rows));
    });

  const save = () =>
    start(async () => {
      const result = await saveBookingImport(tripId, preview!.draft, preview!.targetRef, [...picked]);
      if (result.error) return setMessage({ error: result.error });
      let note = result.ok ?? "Zapisano.";
      if (file !== null && toVault && result.bookingId) {
        if (file.size > MAX_DOCUMENT_BYTES) note += ` Pliku nie dodano do sejfu: ma ${formatBytes(file.size)}, limit to ${formatBytes(MAX_DOCUMENT_BYTES)}.`;
        else if (!DOCUMENT_MIME.includes(file.type)) note += " Pliku nie dodano do sejfu: sejf nie przyjmuje tego formatu.";
        else {
          const problem = await uploadToVault(tripId, file, {
            file_name: file.name,
            booking_id: result.bookingId,
            item_id: null,
            visibility: ownerOnly ? "owner" : "all",
            visible_to: [],
            offline: true,
            code_payload: code?.payload ?? null,
            code_format: code?.format ?? null,
          });
          note += problem === null ? ` Plik jest w sejfie${code ? ` (z: ${codeLabel(code.format)})` : ""}.` : ` Pliku nie dodano do sejfu: ${problem}`;
        }
      }
      reset();
      setOpen(false);
      setMessage({ ok: note });
      router.refresh();
    });

  const newBooking = preview?.targetRef === null;
  const canSave = preview !== null && (newBooking || picked.size > 0);

  return (
    <div className="flex flex-col gap-3 panel p-3 text-sm">
      <p className="font-medium">Import rezerwacji z potwierdzenia</p>
      {preview === null ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Plik: PDF z potwierdzeniem, bilet albo zrzut ekranu
            <input type="file" accept={ACCEPT.join(",")} disabled={pending} onChange={(event) => choose(event.target.files?.[0] ?? null)} className="text-sm" />
          </label>
          {file === null && (
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              albo wklej treść maila z potwierdzeniem
              <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} disabled={pending} placeholder="Zaznacz i skopiuj treść maila, bez danych karty." className="field p-2 text-sm" />
            </label>
          )}
          {file !== null && code && <p className="text-xs msg-ok">W pliku jest {codeLabel(code.format)} — trafi do sejfu razem z plikiem.</p>}
          <p className="text-xs text-zinc-500">AI (Gemini) przygotuje szkic, a Ty wybierzesz, co zapisać. Dane karty i hasła nie są odczytywane.</p>
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
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Zapisz do
            <select value={preview.targetRef ?? ""} disabled={pending} onChange={(event) => retarget(event.target.value === "" ? null : event.target.value)} className="field px-2 py-1 text-sm">
              <option value="">Nowa rezerwacja</option>
              {preview.targets.map((target) => (
                <option key={target.ref} value={target.ref}>
                  {target.label}
                </option>
              ))}
            </select>
          </label>
          {preview.rows.length === 0 ? (
            <p className="text-zinc-500">Dokument nie wnosi nic nowego do tej rezerwacji.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {preview.rows.map((row) => (
                <li key={row.key}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={row.required === true || picked.has(row.key)}
                      disabled={row.required === true || pending}
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
          )}
          {file !== null && (
            <div className="flex flex-col gap-1 text-xs text-zinc-500">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={toVault} disabled={pending} onChange={(event) => setToVault(event.target.checked)} />
                Dodaj „{file.name}” do sejfu przy tej rezerwacji{code ? ` (z: ${codeLabel(code.format)})` : ""}
              </label>
              {toVault && owner && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ownerOnly} disabled={pending} onChange={(event) => setOwnerOnly(event.target.checked)} />
                  widoczny tylko dla organizatora
                </label>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={pending || !canSave} onClick={save} className="btn-primary btn-sm">
              {pending ? "Zapisuję…" : newBooking ? "Dodaj rezerwację" : "Zapisz zaznaczone"}
            </button>
            <button type="button" disabled={pending} onClick={() => (reset(), setMessage({}))} className="btn-secondary btn-sm">
              Anuluj
            </button>
          </div>
        </>
      )}
      {message.error && <p className="text-xs msg-error">{message.error}</p>}
    </div>
  );
}
