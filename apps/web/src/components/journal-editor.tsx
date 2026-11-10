"use client";

import { instantToZoned, PHOTO_TIME_BYTES, photoTakenAt, zonedToInstant } from "@expeditionplan/core";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Dziennik na webie: nowy wpis (tekst i zdjęcia). Zapis prosto z przeglądarki, jak na telefonie: plik do
 * prywatnego bucketu `journal` pod `<trip>/<wpis>/zdjecie.<ext>`, potem wiersz `journal_entries` (autor
 * z `auth.uid()`). O prawach decyduje RLS: wpis dodaje każdy uczestnik, zmienia i usuwa autor albo organizator
 * i edytor (`components/journal-entry.tsx`). Kilka zdjęć naraz = kolejne wpisy, tekst trafia do pierwszego; dzień
 * i godzinę każdego zdjęcia bierze z EXIF (`photoTakenAt`), gdy aparat je zapisał. Z `itemId` (karta punktu planu) wpis
 * jest przy tym punkcie i jego dniu, a bez godziny ze zdjęcia dostaje planowaną godzinę punktu.
 */

const BUCKET = "journal";
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 15 * 1024 * 1024;
/** Dłuższy bok po zmniejszeniu — duże zdjęcia z aparatu idą jako JPEG, jak z telefonu. */
const MAX_SIDE = 2560;

export type JournalDay = { id: string; label: string; date: string; tz: string };

/** Zdjęcie do wysłania: duże albo nie-JPEG zmniejszone do JPEG; czego przeglądarka nie odczyta (HEIC), idzie bez zmian. */
async function prepared(file: File): Promise<File> {
  if (file.type === "image/jpeg" && file.size <= 3 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type !== "image/heic" && file.size <= 3 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob === null ? file : new File([blob], "zdjecie.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const extension = (file: File) => (file.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");

/** Dzień wpisu: dzisiejszy, jeśli wyjazd trwa, inaczej pierwszy (jak na telefonie). */
function todayId(days: JournalDay[]): string {
  const now = Date.now();
  return (days.find((day) => instantToZoned(now, day.tz).date === day.date) ?? days[0])?.id ?? "";
}

/** Data i godzina z EXIF zdjęcia (tylko JPEG); `null`, gdy aparat ich nie zapisał. */
async function exifTime(file: File): Promise<{ date: string; time: string } | null> {
  if (file.type !== "image/jpeg") return null;
  try {
    return photoTakenAt(new Uint8Array(await file.slice(0, PHOTO_TIME_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}

type Props = {
  tripId: string;
  days: JournalDay[];
  tz: string;
  /** Punkt planu (id wiersza) — wpis przy nim; dzień wtedy stały (`days` = dzień punktu albo pusty). */
  itemId?: string;
  /** Planowana godzina punktu — gdy zdjęcie nie ma własnej. */
  plannedTime?: string;
  label?: string;
};

export function JournalNew({ tripId, days, tz, itemId, plannedTime, label = "+ Nowy wpis" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [dayId, setDayId] = useState(() => todayId(days));
  const [time, setTime] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const day = days.find((each) => each.id === dayId);
  const zone = day?.tz ?? tz;

  const choose = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const wrong = picked.find((file) => !ACCEPT.includes(file.type));
    if (wrong) return setError(`„${wrong.name}” to nie zdjęcie JPG, PNG, WebP ani HEIC.`);
    const big = picked.find((file) => file.size > MAX_BYTES);
    if (big) return setError(`„${big.name}” ma ponad 15 MB.`);
    setError(null);
    setFiles(picked);
  };

  /**
   * Dzień i chwila wpisu. Wpisana godzina wygrywa. Potem EXIF: bez punktu planu zdjęcie z innego dnia wyjazdu
   * trafia do tamtego dnia; przy punkcie liczy się tylko z dnia punktu. Dalej: teraz (gdy to dziś), czas zapisu
   * pliku z tego dnia, planowana godzina punktu, południe.
   */
  const when = async (file: File | undefined): Promise<{ dayId: string | null; takenAt: string }> => {
    const now = Date.now();
    const at = (target: JournalDay, hm: string) => ({ dayId: target.id, takenAt: new Date(zonedToInstant(target.date, hm, target.tz)).toISOString() });
    if (day === undefined) return { dayId: null, takenAt: new Date(now).toISOString() };
    if (time !== "") return at(day, time);
    const exif = file === undefined ? null : await exifTime(file);
    if (exif !== null) {
      const target = itemId === undefined ? days.find((each) => each.date === exif.date) : day.date === exif.date ? day : undefined;
      if (target !== undefined) return at(target, exif.time);
    }
    if (instantToZoned(now, zone).date === day.date) return { dayId: day.id, takenAt: new Date(now).toISOString() };
    if (file !== undefined && instantToZoned(file.lastModified, zone).date === day.date) return { dayId: day.id, takenAt: new Date(file.lastModified).toISOString() };
    return at(day, plannedTime ?? "12:00");
  };

  const reset = () => {
    setOpen(false);
    setBody("");
    setTime("");
    setFiles([]);
    setError(null);
  };

  const save = async () => {
    if (body.trim() === "" && files.length === 0) return;
    setError(null);
    const supabase = createClient();
    const entries = files.length === 0 ? [undefined] : files;
    let saved = 0;
    for (const [index, original] of entries.entries()) {
      setBusy(entries.length > 1 ? `zapisuję ${index + 1} z ${entries.length}…` : "zapisuję…");
      const id = uuidv7();
      const moment = await when(original);
      let photoPath: string | null = null;
      if (original !== undefined) {
        const file = await prepared(original);
        photoPath = `${tripId}/${id}/zdjecie.${extension(file)}`;
        const upload = await supabase.storage.from(BUCKET).upload(photoPath, file, { contentType: file.type, upsert: false });
        if (upload.error) {
          setError(`${saved > 0 ? `Zapisano ${saved}, ` : ""}„${original.name}”: ${dbErrorMessage(upload.error, "nie wysłano zdjęcia. Spróbuj jeszcze raz.")}`);
          break;
        }
      }
      const { error: insertError } = await supabase.from("journal_entries").insert({
        id,
        trip_id: tripId,
        day_id: moment.dayId,
        item_id: itemId ?? null,
        body: index === 0 ? body.trim() : "",
        photo_path: photoPath,
        taken_at: moment.takenAt,
      });
      if (insertError) {
        if (photoPath !== null) await supabase.storage.from(BUCKET).remove([photoPath]);
        setError(dbErrorMessage(insertError, "Nie zapisano wpisu. Spróbuj jeszcze raz."));
        break;
      }
      saved += 1;
    }
    setBusy(null);
    if (saved === entries.length) reset();
    else if (saved > 0) setFiles(files.slice(saved));
    router.refresh();
  };

  if (!open)
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm">
          {label}
        </button>
      </div>
    );

  return (
    <section className="card flex flex-col gap-3 p-4">
      <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={4} placeholder="Co się wydarzyło?" autoFocus className="field w-full px-3 py-2" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {days.length > 1 && itemId === undefined && (
          <label className="flex items-center gap-2">
            Dzień
            <select value={dayId} onChange={(event) => setDayId(event.target.value)} className="field px-2 py-1">
              {days.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {day !== undefined && (
          <label className="flex items-center gap-2" title={`Puste: godzina zrobienia zdjęcia, gdy aparat ją zapisał, w trakcie wyjazdu teraz, inaczej ${plannedTime === undefined ? "południe" : `planowana godzina punktu (${plannedTime})`}`}>
            Godzina
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="field px-2 py-1" />
          </label>
        )}
        <label className={`btn-mini cursor-pointer ${busy ? "opacity-50" : ""}`}>
          {files.length === 0 ? "+ zdjęcia" : "zmień zdjęcia"}
          <input type="file" accept={ACCEPT.join(",")} multiple onChange={(event) => choose(event.target.files)} disabled={busy !== null} className="sr-only" />
        </label>
        {files.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 text-zinc-500">
            {files.length === 1 ? files[0]!.name : `${files.length} zdjęć — każde jako osobny wpis, tekst przy pierwszym${itemId === undefined ? ", dzień ze zdjęcia" : ""}`}
            <button type="button" onClick={() => setFiles([])} disabled={busy !== null} className="btn-mini">
              bez zdjęć
            </button>
          </span>
        )}
      </div>
      {error && <p className="text-sm msg-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy !== null || (body.trim() === "" && files.length === 0)} className="btn-primary btn-sm">
          {busy ?? "Zapisz wpis"}
        </button>
        <button type="button" onClick={reset} disabled={busy !== null} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </section>
  );
}
