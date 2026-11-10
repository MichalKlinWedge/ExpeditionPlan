import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { type GuideRow, tripGuides, undescribedSights, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { describeTrip } from "@/app/guide-actions";
import { GuideList } from "@/components/guide-list";
import { PlanActionButton } from "@/components/plan-action-button";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

/**
 * Wszystkie opisy miejsc wyjazdu w jednym miejscu: każdy można przejrzeć, a organizator i edytor przygotować
 * od nowa, poprawić ręcznie albo usunąć. Niżej atrakcje bez opisu.
 */

export const metadata: Metadata = { title: "Opisy miejsc — Expedition Planner" };

export default function GuidesPage(props: PageProps<"/trips/[id]/guides">) {
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
  // `?opis=<id>` (np. z „Miejsc”) rozwija ten opis od razu, a kotwica `#opis-<id>` przewija do niego.
  const asked = (await searchParams).opis;
  const openId = typeof asked === "string" ? asked : undefined;
  const { supabase } = await requireUser(`/trips/${id}/guides`);
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
  const canEdit = mayEdit && (await editMode());
  const ids = refIndex(payload.tables);
  const rows = (payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? [];
  const guides = tripGuides(doc, rows, ids);
  const missing = undescribedSights(doc, rows, ids).map((item) => ({ ref: item.ref, title: item.title }));

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/trips/${id}`} className="back-link">
          ← {doc.trip.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">Opisy miejsc</h1>
          {mayEdit && <EditToggle editing={canEdit} />}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Opisy z Wikipedii, Wikivoyage i wskazanych stron przy punktach planu: {guides.length}.{canEdit ? " Każdy możesz przygotować od nowa, poprawić ręcznie albo usunąć." : ""}
        </p>
      </div>
      {canEdit && missing.length > 0 && <PlanActionButton ai run={describeTrip.bind(null, id)} label={`Przygotuj brakujące opisy (${missing.length})`} note="Z Wikipedii (CC BY-SA 4.0) i Wikimedia Commons; streszczenie AI" />}
      <GuideList tripId={id} guides={guides} missing={missing} canEdit={canEdit} openId={openId} />
    </>
  );
}
