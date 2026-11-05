import { type GuideRow, placeGuide, placeList, similarPlaces, type TripDocument } from "@expeditionplan/core";
import { refIndex, stateFromPayload } from "@expeditionplan/sync";
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
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/places`);
  const [{ data, error }, membership] = await Promise.all([supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }), supabase.from("my_trips").select("role").eq("id", id).maybeSingle()]);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  const payload = data as Parameters<typeof stateFromPayload>[0];
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
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
        <h1 className="text-2xl font-semibold">Miejsca</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {canEdit ? "Miejsce jest wspólne dla punktów, które z niego korzystają: zmiana nazwy lub współrzędnych obowiązuje wszędzie." : "Miejsca, z których korzysta ten plan."}
        </p>
      </div>
      {places.length === 0 ? <p className="text-sm text-zinc-500">Ten plan nie ma jeszcze miejsc.</p> : <PlacesView tripId={id} places={places} canEdit={canEdit} hasRouted={doc.items.some((item) => item.leg?.routed === true)} />}
    </>
  );
}
