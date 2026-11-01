import { refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { groundTrip, routeTrip } from "@/app/actions";
import { PlanActionButton } from "@/components/plan-action-button";
import { PlanView } from "@/components/plan-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Plan dzień po dniu. Dane idą tą samą drogą co na telefon: `pull_changes` → `stateFromPayload`
 * (dokument + zdarzenia z trasy), a harmonogram liczy silnik w przeglądarce.
 */
// „Uzupełnij współrzędne” i „Przelicz przejazdy” (akcje serwera na tej stronie) trwają do ok. 2 min.
export const maxDuration = 300;

export default function PlanPage(props: PageProps<"/trips/[id]/plan">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Plan params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/plan`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  if (data === null) notFound();
  let state: ReturnType<typeof stateFromPayload>;
  try {
    state = stateFromPayload(data as Parameters<typeof stateFromPayload>[0]);
  } catch (e) {
    return <p className="text-sm text-red-600">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const canEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="text-sm text-zinc-500 underline">
          ← {state.doc.trip.title}
        </Link>
        <h1 className="text-2xl font-semibold">Plan dzień po dniu</h1>
      </div>
      {canEdit && (
        <div className="flex flex-col gap-2">
          <PlanActionButton run={groundTrip.bind(null, id)} label="Uzupełnij współrzędne miejsc" note="Miejsca: © OpenStreetMap, Geoapify" />
          <PlanActionButton run={routeTrip.bind(null, id)} label="Przelicz przejazdy (trasy z mapy)" note="Trasy: © openrouteservice.org, dane © OpenStreetMap" />
        </div>
      )}
      <PlanView
        // Nowa wersja danych z serwera = nowy stan widoku (patrz `useRefreshOnReturn`).
        key={(data as { version: number }).version}
        state={state}
        tripId={id}
        ids={refIndex((data as { tables: Parameters<typeof refIndex>[0] }).tables)}
        canEdit={canEdit}
      />
    </>
  );
}
