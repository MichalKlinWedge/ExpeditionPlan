import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { Shopping } from "@/components/meals";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Lista zakupów — Expedition Planner" };

/** Wspólna lista zakupów wyjazdu (pozycje pakowania w kategorii „zakupy”); kupione odhacza się na telefonie. Dodawanie i edycja — po „Edytuj”. */

export default function ShoppingPage(props: PageProps<"/trips/[id]/shopping">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <View params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function View({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
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
      <PageHeader back={{ href: `/trips/${id}`, label: doc.trip.title }} title="Lista zakupów" actions={mayEdit && <EditToggle editing={canEdit} />} />
      <section className="flex flex-col gap-3 card p-4">
        <h2 className="card-title">Do kupienia</h2>
        <Shopping tripId={id} doc={doc} tables={payload.tables as unknown as Parameters<typeof Shopping>[0]["tables"]} ids={refIndex(payload.tables)} canEdit={canEdit} />
      </section>
    </>
  );
}
