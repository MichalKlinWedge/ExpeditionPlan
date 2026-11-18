import type { Metadata } from "next";
import { guideFor, type GuideRow, type TripDocument, tripMap } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { TripMapView } from "@/components/trip-map-view";
import { requireUser } from "@/lib/auth";
import { tripDates } from "@/lib/labels";
import { chosenVariantsFromCookie } from "@/lib/plan-variants-server";

export const metadata: Metadata = { title: "Mapa wyjazdu — Expedition Planner" };

/**
 * Mapa wyjazdu: wszystkie punkty i trasy całego wyjazdu na jednej mapie (`core/trip-map.ts`), z dojazdem i powrotem
 * do wyłączenia, a po wyjeździe także ze zdjęciami z dziennika. Kliknięcie punktu, trasy albo zdjęcia otwiera okno
 * z opisem miejsca, zdjęciami i planem (`components/trip-map-view.tsx`). Warianty jak w widoku planu (ciasteczko),
 * bez punktów pominiętych w terenie.
 */
export default function TripMapPage(props: PageProps<"/trips/[id]/map">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <TripMapSection params={props.params} />
      </Suspense>
    </Shell>
  );
}

type JournalRow = { id: string; day_id: string | null; item_id: string | null; body: string; photo_path: string | null; taken_at: string; created_by: string | null; deleted_at: string | null };
type TravelerRow = { name: string; user_id: string | null; deleted_at: string | null };

async function TripMapSection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, userId } = await requireUser(`/trips/${id}/map`);
  const [{ data, error }, chosen] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), chosenVariantsFromCookie(id)]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  let inputs: ReturnType<typeof stateFromPayload>["inputs"];
  try {
    ({ doc, inputs } = stateFromPayload(payload));
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const tables = payload.tables as unknown as Record<string, unknown[] | undefined>;
  const guides = (tables.audio_guides ?? []) as GuideRow[];
  const travelers = ((tables.travelers ?? []) as TravelerRow[]).filter((row) => row.deleted_at === null);
  const entries = ((tables.journal_entries ?? []) as JournalRow[]).filter((row) => row.deleted_at === null && row.photo_path !== null).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  const urls = new Map<string, string>();
  if (entries.length > 0) {
    const { data: signed } = await supabase.storage.from("journal").createSignedUrls(
      entries.map((row) => row.photo_path!),
      3600,
    );
    for (const each of signed ?? []) if (each.path && each.signedUrl && !each.error) urls.set(each.path, each.signedUrl);
  }
  const ids = refIndex(payload.tables);
  const refOf = new Map(Object.entries(ids).map(([ref, rowId]) => [rowId, ref]));
  const author = (row: JournalRow) => travelers.find((each) => each.user_id === row.created_by)?.name ?? (row.created_by === userId ? "ja" : "uczestnik");
  // Jak w widoku planu: wybory z terenu, na nich wybrane w planie (ciasteczko).
  const activeVariants = { ...inputs.activeVariants, ...chosen };
  const result = tripMap(doc, {
    activeVariants,
    pulled: inputs.pulled,
    skipRefs: inputs.skipRefs,
    guideOf: (placeRef, item) => guideFor(guides, item === undefined ? undefined : ids[item.ref], ids[placeRef]),
    journal: entries.flatMap((row) => {
      const photoUrl = urls.get(row.photo_path!);
      if (photoUrl === undefined) return [];
      const dayRef = row.day_id === null ? undefined : refOf.get(row.day_id);
      const itemRef = row.item_id === null ? undefined : refOf.get(row.item_id);
      return [
        {
          id: row.id,
          body: row.body,
          takenAt: Date.parse(row.taken_at),
          photoUrl,
          author: author(row),
          ...(dayRef !== undefined ? { dayRef } : {}),
          ...(itemRef !== undefined ? { itemRef } : {}),
        },
      ];
    }),
  });

  return (
    <>
      <PageHeader
        back={{ href: `/trips/${id}`, label: doc.trip.title }}
        title="Mapa wyjazdu"
        intro={`${tripDates(doc.trip.startDate, doc.trip.endDate)} · wszystkie punkty i trasy wyjazdu na jednej mapie. Warianty jak w widoku planu.`}
      />
      {doc.days.length === 0 ? <p className="text-sm text-zinc-500">Plan nie ma jeszcze dni.</p> : <TripMapView tripId={id} data={result} />}
    </>
  );
}
