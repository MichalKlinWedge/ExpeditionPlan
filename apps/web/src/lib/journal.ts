import type { PullPayload } from "@expeditionplan/sync";

import type { createClient } from "@/lib/supabase/server";

/**
 * Wpisy dziennika z `pull_changes` dla strony „Dziennik” i karty punktu planu: bez usuniętych, po czasie, z autorem
 * i podpisanym adresem zdjęcia z prywatnego bucketu `journal` (godzina ważności; brak adresu = plik jeszcze idzie z telefonu).
 */

export type JournalCard = { id: string; dayId: string | null; itemId: string | null; body: string; photoPath: string | null; url: string | null; takenAt: string; author: string; mine: boolean };

type Row = { id: string; day_id: string | null; item_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by: string | null; deleted_at: string | null };
type TravelerRow = { name: string; user_id: string | null; deleted_at: string | null };

export async function journalCards(supabase: Awaited<ReturnType<typeof createClient>>, payload: PullPayload, userId: string, keep: (row: { day_id: string | null; item_id: string | null }) => boolean = () => true): Promise<JournalCard[]> {
  const tables = payload.tables as unknown as Record<string, unknown[] | undefined>;
  const rows = ((tables.journal_entries ?? []) as Row[]).filter((row) => row.deleted_at === null && keep(row)).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const travelers = ((tables.travelers ?? []) as TravelerRow[]).filter((row) => row.deleted_at === null);
  const author = (row: Row) => (row.created_by === null ? "uczestnik" : row.created_by === userId ? "ja" : (travelers.find((each) => each.user_id === row.created_by)?.name ?? "uczestnik"));
  const paths = rows.flatMap((row) => (row.photo_path ? [row.photo_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("journal").createSignedUrls(paths, 3600);
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) urls.set(each.path, each.signedUrl);
  }
  return rows.map((row) => ({
    id: row.id,
    dayId: row.day_id,
    itemId: row.item_id,
    body: row.body,
    photoPath: row.photo_path,
    url: row.photo_path === null ? null : (urls.get(row.photo_path) ?? null),
    takenAt: row.taken_at,
    author: author(row),
    mine: row.created_by === userId,
  }));
}
