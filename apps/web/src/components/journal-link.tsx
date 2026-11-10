"use client";

import { instantToZoned } from "@expeditionplan/core";
import { dbErrorMessage } from "@expeditionplan/sync";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { JournalCard } from "@/lib/journal";
import { createClient } from "@/lib/supabase/client";

/**
 * Połączenie wpisów dziennika, dodanych wcześniej (np. z telefonu, bez punktu), z punktem planu: ustawia
 * `journal_entries.item_id`. Kandydaci to wpisy z dnia punktu i bez dnia; wpis przy innym punkcie można przepiąć
 * (widać, przy którym jest). Łączy autor wpisu, a cudzy wpis organizator i edytor w trybie edycji (pilnuje RLS).
 */

export type LinkCandidate = JournalCard & { canEdit: boolean; linkedTo?: string };

export function JournalLink({ itemId, tz, candidates }: { itemId: string; tz: string; candidates: LinkCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  const link = async (entry: LinkCandidate) => {
    if (entry.linkedTo && !window.confirm(`Ten wpis jest przy punkcie „${entry.linkedTo}”. Przepiąć go tutaj?`)) return;
    setBusy(entry.id);
    setError(null);
    const { data, error: updateError } = await createClient().from("journal_entries").update({ item_id: itemId }).eq("id", entry.id).select("id");
    setBusy(null);
    if (updateError) return setError(dbErrorMessage(updateError, "Nie połączono wpisu. Spróbuj jeszcze raz."));
    if ((data ?? []).length === 0) return setError("Ten wpis może połączyć tylko autor albo organizator.");
    router.refresh();
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary btn-sm w-fit">
        Połącz z wpisem z dziennika ({candidates.length})
      </button>
    );

  return (
    <section className="card flex flex-col gap-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Wpisy z dziennika z tego dnia</h3>
        <button type="button" onClick={() => setOpen(false)} className="btn-mini">
          zamknij
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {candidates.map((entry) => (
          <li key={entry.id} className="flex gap-2 panel p-2">
            {entry.url ? (
              // Podpisany URL z bucketu — zwykły <img> (adres wygasa).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={entry.url} alt={entry.body || "Zdjęcie z wyjazdu"} loading="lazy" className="size-20 shrink-0 rounded object-cover" />
            ) : (
              <span className="flex size-20 shrink-0 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">{entry.photoPath ? "📷 wysyła się" : "bez zdjęcia"}</span>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-zinc-500">
                {instantToZoned(Date.parse(entry.takenAt), tz).time} · {entry.author}
                {entry.dayId === null ? " · bez dnia" : ""}
              </span>
              {entry.body && <p className="line-clamp-2">{entry.body}</p>}
              {entry.linkedTo && <span className="text-xs text-zinc-500">przy: {entry.linkedTo}</span>}
              <button
                type="button"
                onClick={() => void link(entry)}
                disabled={busy !== null || !entry.canEdit}
                title={entry.canEdit ? undefined : "Cudzy wpis łączy organizator albo edytor w trybie edycji"}
                className="btn-mini w-fit"
              >
                {busy === entry.id ? "łączę…" : entry.linkedTo ? "przepnij tutaj" : "połącz"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="msg-error">{error}</p>}
    </section>
  );
}
