"use client";

import { instantToZoned, journalRedated, journalTimeAt } from "@expeditionplan/core";
import type { Database } from "@expeditionplan/db";
import { dbErrorMessage } from "@expeditionplan/sync";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconAction } from "@/components/icon-action";
import type { JournalDay } from "@/components/journal-editor";
import type { JournalCard } from "@/lib/journal";
import { createClient } from "@/lib/supabase/client";

/**
 * Jeden wpis dziennika: zdjęcie, tekst, godzina w strefie dnia, autor, przycisk do punktu planu. Z `canEdit` (autor,
 * a cudzy wpis organizator i edytor w trybie edycji; pilnuje RLS) także: ↑ / ↓ (`upAt` / `downAt` — nowy czas
 * z `journalMovedTime`, bo kolejność to `taken_at`), „edytuj” (tekst, dzień, godzina, „usuń zdjęcie”) i „usuń”.
 * Zdjęcie usunięte z wpisu i usunięty wpis zostawiają plik w buckecie (jak na telefonie), wpis — `deleted_at`.
 */

type EntryUpdate = Database["public"]["Tables"]["journal_entries"]["Update"];

type Props = {
  entry: JournalCard;
  tz: string;
  canEdit: boolean;
  item?: { href: string; title: string };
  /** Dni do przepięcia (wybór, gdy jest ich kilka) i do liczenia godziny; pusta lista = godziny nie zmienia. */
  days?: JournalDay[];
  upAt?: string | null;
  downAt?: string | null;
  /** Na karcie punktu: „odłącz od punktu” (wpis zostaje w dzienniku, bez punktu). */
  unlink?: boolean;
};

export function JournalEntry({ entry, tz, canEdit, item, days = [], upAt = null, downAt = null, unlink = false }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const time = instantToZoned(Date.parse(entry.takenAt), tz).time;

  const update = async (fields: EntryUpdate, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await createClient().from("journal_entries").update(fields).eq("id", entry.id).select("id");
    setBusy(false);
    if (updateError) {
      setError(dbErrorMessage(updateError, fallback));
      return false;
    }
    if ((data ?? []).length === 0) {
      setError("Ten wpis może zmienić tylko autor albo organizator.");
      return false;
    }
    router.refresh();
    return true;
  };

  const remove = () => {
    if (!window.confirm(`Usunąć wpis${entry.body ? ` „${entry.body.slice(0, 60)}${entry.body.length > 60 ? "…" : ""}”` : " ze zdjęciem"}?`)) return;
    void update({ deleted_at: new Date().toISOString() }, "Nie usunięto wpisu. Spróbuj jeszcze raz.");
  };

  const photo =
    entry.photoPath &&
    (entry.url !== null ? (
      // Podpisany URL z bucketu — zwykły <img>, bez optymalizacji Next (adres wygasa).
      // eslint-disable-next-line @next/next/no-img-element
      <img src={entry.url} alt={entry.body || "Zdjęcie z wyjazdu"} loading="lazy" className="max-h-[70vh] w-full object-cover" />
    ) : (
      <p className="px-4 pt-3 text-xs text-zinc-500">📷 Zdjęcie jeszcze się wysyła z telefonu.</p>
    ));

  if (editing)
    return (
      <article className="card flex flex-col gap-2 overflow-hidden">
        {photo}
        <EntryForm
          entry={entry}
          tz={tz}
          startTime={time}
          days={days}
          busy={busy}
          error={error}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
          onSave={async (fields) => {
            if (await update(fields, "Nie zapisano zmian. Spróbuj jeszcze raz.")) setEditing(false);
          }}
        />
      </article>
    );

  return (
    <article className="card flex flex-col gap-2 overflow-hidden">
      {photo}
      <div className="flex flex-col gap-1 px-4 pb-3 first:pt-3">
        {entry.body && <p className="whitespace-pre-line">{entry.body}</p>}
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-zinc-500">
          <span>
            {time} · {entry.author}
          </span>
          {item && (
            <Link href={item.href} className="btn-mini">
              📍 {item.title}
            </Link>
          )}
          {canEdit && (
            <>
              {upAt !== null && <IconAction kind="up" tip="Wyżej (wcześniej)" onClick={() => void update({ taken_at: upAt }, "Nie przesunięto wpisu.")} disabled={busy} />}
              {downAt !== null && <IconAction kind="down" tip="Niżej (później)" onClick={() => void update({ taken_at: downAt }, "Nie przesunięto wpisu.")} disabled={busy} />}
              <IconAction kind="edit" tip="Edytuj wpis" onClick={() => setEditing(true)} disabled={busy} />
              {unlink && (
                <button type="button" onClick={() => void update({ item_id: null }, "Nie odłączono wpisu.")} disabled={busy} title="Wpis zostaje w dzienniku, tylko bez tego punktu" className="btn-mini">
                  odłącz od punktu
                </button>
              )}
              <IconAction kind="remove" tip="Usuń wpis" onClick={remove} disabled={busy} />
            </>
          )}
          {error && <span className="msg-error">{error}</span>}
        </div>
      </div>
    </article>
  );
}

type FormProps = {
  entry: JournalCard;
  tz: string;
  startTime: string;
  days: JournalDay[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (fields: EntryUpdate) => Promise<void>;
};

function EntryForm({ entry, tz, startTime, days, busy, error, onCancel, onSave }: FormProps) {
  const [body, setBody] = useState(entry.body);
  const [dayId, setDayId] = useState(entry.dayId ?? "");
  const [time, setTime] = useState(startTime);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const save = () => {
    const keepsPhoto = entry.photoPath !== null && !dropPhoto;
    if (body.trim() === "" && !keepsPhoto) return setInvalid("Wpis bez tekstu i zdjęcia — usuń cały wpis.");
    const day = days.find((each) => each.id === dayId);
    let takenAt = entry.takenAt;
    // Nowa godzina — w (nowym) dniu; sam nowy dzień — ta sama godzina z nową datą.
    if (day !== undefined && time !== startTime) {
      const at = journalTimeAt(day, time);
      if (at === null) return setInvalid("Godzina w formacie GG:MM.");
      takenAt = at;
    } else if (day !== undefined && dayId !== entry.dayId) takenAt = journalRedated(entry.takenAt, tz, day);
    setInvalid(null);
    void onSave({ body: body.trim(), day_id: dayId === "" ? null : dayId, taken_at: takenAt, ...(dropPhoto ? { photo_path: null } : {}) });
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-3 first:pt-3">
      <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={3} placeholder="Co się wydarzyło?" className="field w-full px-3 py-2" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(days.length > 1 || entry.dayId === null) && days.length > 0 && (
          <label className="flex items-center gap-2">
            Dzień
            <select value={dayId} onChange={(event) => setDayId(event.target.value)} className="field px-2 py-1">
              {entry.dayId === null && <option value="">bez dnia</option>}
              {days.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {dayId !== "" && (
          <label className="flex items-center gap-2">
            Godzina
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="field px-2 py-1" />
          </label>
        )}
        {entry.photoPath !== null &&
          (dropPhoto ? (
            <span className="flex items-center gap-1.5 text-zinc-500">
              zdjęcie zniknie z wpisu
              <button type="button" onClick={() => setDropPhoto(false)} className="btn-mini">
                cofnij
              </button>
            </span>
          ) : (
            <IconAction kind="remove" tip="Usuń zdjęcie z wpisu (plik zostaje)" onClick={() => setDropPhoto(true)} />
          ))}
      </div>
      {(invalid ?? error) && <p className="text-sm msg-error">{invalid ?? error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary btn-sm">
          {busy ? "zapisuję…" : "Zapisz"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary btn-sm">
          Anuluj
        </button>
      </div>
    </div>
  );
}
