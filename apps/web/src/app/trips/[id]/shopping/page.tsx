import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle, editMode } from "@/components/edit-toggle";
import { Shopping } from "@/components/meals";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Lista zakupów — Expedition Planner" };

/** Wspólna lista zakupów wyjazdu (pozycje pakowania w kategorii „zakupy”); kupione odhacza się na telefonie. Dodawanie i edycja — po „Edytuj”. */

export default function ShoppingPage(props: PageProps<"/trips/[id]/shopping">) {
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
  const wantsEdit = await editMode(searchParams);
  const { supabase } = await requireUser(`/trips/${id}/shopping`);
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

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Lista zakupów</h1>
        </div>
        {mayEdit && <EditToggle href={`/trips/${id}/shopping`} editing={canEdit} />}
      </div>
      <section className="flex flex-col gap-3 card p-4">
        <Shopping tripId={id} doc={doc} tables={payload.tables as unknown as Parameters<typeof Shopping>[0]["tables"]} ids={refIndex(payload.tables)} canEdit={canEdit} />
      </section>
    </>
  );
}
