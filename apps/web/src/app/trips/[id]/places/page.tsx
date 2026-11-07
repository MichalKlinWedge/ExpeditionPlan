import { EditToggle } from "@/components/edit-toggle";
import { type GuideRow, placeGuide, placeList, similarPlaces, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PlacesView } from "@/components/places-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Miejsca wyjazdu w jednym miejscu: co jest na mapie, skąd pochodzi i co z niego korzysta. Organizator
 * i edytor poprawiają tu także miejsca z już ustawionymi współrzędnymi, widz tylko ogląda.
 */

export const metadata: Metadata = { title: "Miejsca — Expedition Planner" };

export default function PlacesPage(props: PageProps<"/trips/[id]/places">) {
  return (
    <Shell wide>
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
  const { miejsce } = query;
  const { supabase } = await requireUser(`/trips/${id}/places`);
  const [{ data, error }, membership] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), supabase.from("my_trips").select("role").eq("id", id).maybeSingle()]);
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && query.edit === "1";
  const ids = refIndex(payload.tables);
  const similar = similarPlaces(doc);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const places = placeList(doc).flatMap(({ place, usage, n }) => {
    const rowId = ids[place.ref];
    return rowId === undefined ? [] : [{ id: rowId, ref: place.ref, name: place.name, address: place.address, lat: place.lat, lng: place.lng, provider: place.provider, searchName: place.searchName, usage, n, similar: similar[place.ref] ?? [], guide: placeGuide(doc.items, rows, ids, place.ref) }];
  });

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">Miejsca</h1>
          {mayEdit && <EditToggle href={`/trips/${id}/places`} editing={canEdit} />}
        </div>
        <Link href="/places" className="self-start text-xs text-zinc-500 underline hover:text-sea">
          Miejsca ze wszystkich wyjazdów
        </Link>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {mayEdit ? "Miejsce jest wspólne dla punktów, które z niego korzystają: zmiana nazwy lub współrzędnych obowiązuje wszędzie." : "Miejsca, z których korzysta ten plan."}
        </p>
      </div>
      {places.length === 0 ? <p className="text-sm text-zinc-500">Ten plan nie ma jeszcze miejsc.</p> : <PlacesView tripId={id} places={places} canEdit={canEdit} hasRouted={doc.items.some((item) => item.leg?.routed === true)} initial={typeof miejsce === "string" ? miejsce : null} />}
    </>
  );
}
