import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { MealsView } from "@/components/meals-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Posiłki — Expedition Planner" };

/** Posiłki dzień po dniu, a obok mapa i dane przypiętej knajpy (`?knajpa=<ref>` wybiera ją od razu, z karty punktu): ile osób (dorośli i dzieci), które gotujecie sami i ile porcji. Dodawanie, zmiana, usuwanie i „gotujemy sami” — po „Edytuj”. */

export default function MealsPage(props: PageProps<"/trips/[id]/meals">) {
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
  const wantsEdit = await editMode();
  const eatery = (await searchParams).knajpa;
  const { supabase } = await requireUser(`/trips/${id}/meals`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
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
  const canEdit = mayEdit && wantsEdit;
  const ids = refIndex(payload.tables);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Posiłki</h1>
        </div>
        {mayEdit && <EditToggle editing={canEdit} />}
      </div>
      <MealsView tripId={id} doc={doc} ids={ids} mayEdit={mayEdit} editing={canEdit} initialPlace={typeof eatery === "string" ? eatery : undefined} />
    </>
  );
}
