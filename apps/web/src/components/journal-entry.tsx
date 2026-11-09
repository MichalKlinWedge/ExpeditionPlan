import { instantToZoned } from "@expeditionplan/core";
import Link from "next/link";

import { JournalRemove } from "@/components/journal-editor";
import type { JournalCard } from "@/lib/journal";

/**
 * Jeden wpis dziennika: zdjęcie, tekst, godzina w strefie dnia, autor i — gdy wpis jest przy punkcie planu — przycisk
 * do karty punktu. „usuń” dostaje autor, a cudzy wpis organizator i edytor w trybie edycji (pilnuje RLS).
 */
export function JournalEntry({ entry, tz, canRemove, item }: { entry: JournalCard; tz: string; canRemove: boolean; item?: { href: string; title: string } }) {
  return (
    <article className="card flex flex-col gap-2 overflow-hidden">
      {entry.photoPath &&
        (entry.url !== null ? (
          // Podpisany URL z bucketu — zwykły <img>, bez optymalizacji Next (adres wygasa).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.url} alt={entry.body || "Zdjęcie z wyjazdu"} loading="lazy" className="max-h-[70vh] w-full object-cover" />
        ) : (
          <p className="px-4 pt-3 text-xs text-zinc-500">📷 Zdjęcie jeszcze się wysyła z telefonu.</p>
        ))}
      <div className="flex flex-col gap-1 px-4 pb-3 first:pt-3">
        {entry.body && <p className="whitespace-pre-line">{entry.body}</p>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
          <span>
            {instantToZoned(Date.parse(entry.takenAt), tz).time} · {entry.author}
          </span>
          {item && (
            <Link href={item.href} className="btn-mini">
              📍 {item.title}
            </Link>
          )}
          {canRemove && <JournalRemove entryId={entry.id} label={entry.body} />}
        </div>
      </div>
    </article>
  );
}
