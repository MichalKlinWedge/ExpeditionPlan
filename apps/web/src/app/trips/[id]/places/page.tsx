import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { canRatePlace, type GuideRow, memoriesOf, memorySummary, type PlaceMemoryRow, placeGuide, placeList, placeVisitYears, similarPlaces, type TripDocument, type VisitedPlaceRow } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { NewPlace } from "@/components/new-place";
import { PlacesView } from "@/components/places-view";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { loadVisited } from "@/lib/places-across";

/**
 * Miejsca wyjazdu w jednym miejscu: co jest na mapie, skąd pochodzi i co z niego korzysta. Organizator
 * i edytor poprawiają tu także miejsca z już ustawionymi współrzędnymi, widz tylko ogląda.
 */

export const metadata: Metadata = { title: "Miejsca — Expedition Planner" };

export default function PlacesPage(props: PageProps<"/trips/[id]/places">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

async function View({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  // Wejście z listy wszystkich miejsc: to miejsce jest od razu wybrane.
  const query = await searchParams;
  const { miejsce, wroc } = query;
  const { supabase, userId } = await requireUser(`/trips/${id}/places`);
  // Pamięć miejsc (RLS: moje wpisy i te o miejscach z moich wyjazdów); jej błąd nie blokuje strony.
  const [{ data, error }, membership, memories, visited] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
    supabase.from("place_memories").select("id, user_id, author_name, name, lat, lng, verdict, note, updated_at").limit(5000),
    loadVisited(supabase).catch((): VisitedPlaceRow[] => []),
  ]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && (await editMode());
  const ids = refIndex(payload.tables);
  const similar = similarPlaces(doc);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const memoryRows: PlaceMemoryRow[] = memories.data ?? [];
  const places = placeList(doc).flatMap(({ place, usage, n }) => {
    const rowId = ids[place.ref];
    const at: [number, number] | undefined = place.lat !== undefined && place.lng !== undefined ? [place.lng, place.lat] : undefined;
    const where = { name: place.name, ...(at ? { at } : {}) };
    const memory = memorySummary(memoriesOf(where, memoryRows), userId);
    const visits = { canRate: canRatePlace(where, visited), years: placeVisitYears(where, visited) };
    return rowId === undefined ? [] : [{ id: rowId, ref: place.ref, name: place.name, address: place.address, lat: place.lat, lng: place.lng, provider: place.provider, searchName: place.searchName, usage, n, similar: similar[place.ref] ?? [], guide: placeGuide(doc.items, rows, ids, place.ref), memory, ...visits }];
  });

  const back = backLink(id, doc, wroc);

  return (
    <>
      <PageHeader
        back={{ href: back?.href ?? `/trips/${id}`, label: back?.label ?? doc.trip.title }}
        title="Miejsca"
        actions={mayEdit && <EditToggle editing={canEdit} />}
        intro={<>{mayEdit ? "Miejsce jest wspólne dla punktów, które z niego korzystają: zmiana nazwy lub współrzędnych obowiązuje wszędzie." : "Miejsca, z których korzysta ten plan."}</>}
      >
        <Link href="/places" className="btn-secondary btn-sm self-start">
          Miejsca ze wszystkich wyjazdów
        </Link>
      </PageHeader>
      {canEdit && <NewPlace tripId={id} />}
      {places.length === 0 ? <p className="text-sm text-zinc-500">Ten plan nie ma jeszcze miejsc.</p> : <PlacesView tripId={id} places={places} canEdit={canEdit} hasRouted={doc.items.some((item) => item.leg?.routed === true)} initial={typeof miejsce === "string" ? miejsce : null} />}
    </>
  );
}

/** Wejście z pinezki (`wroc`): powrót na tę stronę wyjazdu, np. do karty punktu. Inny adres jest pomijany. */
function backLink(tripId: string, doc: TripDocument, wroc: string | string[] | undefined): { href: string; label: string } | null {
  if (typeof wroc !== "string" || !wroc.startsWith(`/trips/${tripId}/`) || wroc.includes("//") || wroc.includes("\\")) return null;
  const path = wroc.split("?")[0]!;
  const item = /\/item\/([^/]+)$/.exec(path);
  if (item) {
    let ref = item[1]!;
    try {
      ref = decodeURIComponent(ref);
    } catch {}
    const title = doc.items.find((each) => each.ref === ref)?.title;
    return { href: wroc, label: title ?? "Punkt planu" };
  }
  if (path.endsWith("/plan")) return { href: wroc, label: "Plan dzień po dniu" };
  if (path.endsWith("/logistics")) return { href: wroc, label: "Rezerwacje i budżet" };
  if (path.endsWith("/people")) return { href: wroc, label: "Uczestnicy i dostęp" };
  return { href: wroc, label: "Wróć" };
}
