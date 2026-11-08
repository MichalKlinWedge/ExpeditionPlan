import "server-only";

import { guideFor, type GuideRow, ShowScript, showScenes } from "@expeditionplan/core";
import { type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";

import type { requireUser } from "@/lib/auth";

/**
 * Dane pokazu z lektorem z jednego `pull_changes`: sceny z planu (`showScenes`), zapisany scenariusz (`trip_shows`)
 * i opcjonalnie podpisane adresy zdjęć z dziennika. Wspólne dla strony pokazu i akcji (`app/show-actions.ts`).
 */

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type JournalRow = { day_id: string | null; body: string; photo_path: string | null; taken_at: string; deleted_at: string | null };

/** Dzisiejsza data w strefie wyjazdu: od niej zależy, czy lektor zapowiada, czy wspomina. */
export const todayIn = (tz: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());

export async function loadShow(supabase: Supabase, tripId: string, payload: PullPayload, options: { photos?: boolean } = {}) {
  const { doc, inputs } = stateFromPayload(payload);
  const ids = refIndex(payload.tables);
  const tables = payload.tables as unknown as { audio_guides?: GuideRow[]; journal_entries?: JournalRow[] };
  const rows = tables.audio_guides ?? [];
  const dayRef = new Map(Object.entries(ids).map(([ref, id]) => [id, ref]));
  const entries = (tables.journal_entries ?? []).filter((row) => row.deleted_at === null).sort((a, b) => a.taken_at.localeCompare(b.taken_at));

  const signed = new Map<string, string>();
  const paths = options.photos ? entries.flatMap((row) => (row.photo_path ? [row.photo_path] : [])) : [];
  if (paths.length > 0) {
    const { data } = await supabase.storage.from("journal").createSignedUrls(paths, 3600);
    for (const each of data ?? []) if (each.path && each.signedUrl && !each.error) signed.set(each.path, each.signedUrl);
  }

  const today = todayIn(doc.trip.primaryTz);
  const { scenes, credits } = showScenes(doc, {
    ...inputs,
    today,
    guideOf: (item) => {
      if (item.kind === "lodging") return null;
      const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
      return guideFor(rows, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]);
    },
    journal: entries.map((row) => {
      const day = row.day_id === null ? undefined : dayRef.get(row.day_id);
      const url = row.photo_path ? signed.get(row.photo_path) : undefined;
      return { body: row.body, ...(day !== undefined ? { dayRef: day } : {}), ...(url !== undefined ? { photoUrl: url } : {}) };
    }),
  });

  const { data: stored, error } = await supabase.from("trip_shows").select("content").eq("trip_id", tripId).maybeSingle();
  const parsed = ShowScript.safeParse(stored?.content ?? {});
  return { doc, today, scenes, credits, script: parsed.success ? parsed.data : ShowScript.parse({}), exists: stored !== null, loadError: error?.message };
}
