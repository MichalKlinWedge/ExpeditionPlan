import type { Metadata } from "next";
import { type GuideRow, guideFor, placesOffMap, vaultDocument, type VaultDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { groundTrip, routeTrip } from "@/app/actions";
import { describeTrip } from "@/app/guide-actions";
import { EditToggle, editMode } from "@/components/edit-toggle";
import { PlacePinner } from "@/components/place-pinner";
import { PlanActionButton } from "@/components/plan-action-button";
import { PlanView } from "@/components/plan-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Plan dzień po dniu — Expedition Planner" };

/**
 * Plan dzień po dniu. Dane idą tą samą drogą co na telefon: `pull_changes` → `stateFromPayload`
 * (dokument + zdarzenia z trasy), a harmonogram liczy silnik w przeglądarce.
 */
// „Uzupełnij współrzędne” i „Przelicz przejazdy” (akcje serwera na tej stronie) trwają do ok. 2 min.
export const maxDuration = 300;

export default function PlanPage(props: PageProps<"/trips/[id]/plan">) {
  return (
    <Shell wide>
      <Suspense fallback={<Loading />}>
        <Plan params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

async function Plan({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
  const { day } = await searchParams;
  const { supabase } = await requireUser(`/trips/${id}/plan`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  let state: ReturnType<typeof stateFromPayload>;
  try {
    state = stateFromPayload(data as PullPayload);
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  // Domyślnie podgląd; edycja po „Edytuj” (`?edit=1`).
  const editing = canEdit && wantsEdit;
  const ids = refIndex((data as { tables: Parameters<typeof refIndex>[0] }).tables);
  // Punkty z gotowym przewodnikiem (własnym albo swojego miejsca) — znaczek 📖 w planie.
  const guides = (data as { tables: { audio_guides?: GuideRow[] } }).tables.audio_guides ?? [];
  const guided = state.doc.items.flatMap((item) => {
    const placeRef = item.leg?.toPlaceRef ?? item.placeRef;
    return guideFor(guides, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef]) === null ? [] : [item.ref];
  });
  // Dokumenty rezerwacji z sejfu do okna rezerwacji (RLS już odcięło te, których ktoś nie widzi).
  const bookingDocuments = ((data as PullPayload).tables.documents ?? []).map((row) => vaultDocument(row as Record<string, unknown>)).filter((each): each is VaultDocument => each !== null && each.bookingId !== null);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {state.doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Plan dzień po dniu</h1>
        </div>
        {/* Narzędzia edycji pod „Zakończ edycję”, przy prawej krawędzi — nie spychają planu w dół. */}
        <div className="ml-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-3">
            <Link href={`/trips/${id}/print`} className="btn-secondary btn-sm">
              Wydruk / PDF
            </Link>
            {canEdit && <EditToggle href={`/trips/${id}/plan`} editing={editing} />}
          </div>
          {editing && (
            <>
              <PlanActionButton end run={groundTrip.bind(null, id)} label="Uzupełnij współrzędne miejsc" note="Miejsca: © OpenStreetMap, Geoapify" />
              <PlanActionButton end run={routeTrip.bind(null, id)} label="Przelicz przejazdy (trasy z mapy)" note="Trasy: © openrouteservice.org, dane © OpenStreetMap" />
              <PlanActionButton end ai run={describeTrip.bind(null, id)} label="Przygotuj brakujące opisy" note="Z Wikipedii (CC BY-SA 4.0) i Wikimedia Commons; streszczenie AI" />
              <Link href={`/trips/${id}/places`} className="btn-secondary btn-sm">
                Wszystkie miejsca: nazwy i współrzędne →
              </Link>
            </>
          )}
        </div>
      </div>
      {editing && <PlacePinner tripId={id} places={placesOffMap(state.doc).flatMap((place) => (ids[place.ref] ? [{ ...place, id: ids[place.ref]! }] : []))} />}
      <PlanView
        // Nowa wersja danych z serwera = nowy stan widoku (patrz `useRefreshOnReturn`).
        key={(data as { version: number }).version}
        state={state}
        tripId={id}
        ids={ids}
        canEdit={editing}
        itemBase={`/trips/${id}/item/`}
        guided={guided}
        initialDay={typeof day === "string" ? day : undefined}
        bookingDocuments={bookingDocuments}
      />
    </>
  );
}
