import type { Metadata } from "next";
import { carriesFromRows, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { GearView } from "@/components/gear-view";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Sprzęt — Expedition Planner" };

/** Sprzęt: co zabrać, kto bierze rzeczy wspólne i ile kto niesie. „Biorę” bez trybu edycji; listę i przydział za innych poprawia się po „Edytuj”. */

export default function GearPage(props: PageProps<"/trips/[id]/gear">) {
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
  const { supabase, userId } = await requireUser(`/trips/${id}/gear`);
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
  const ids = refIndex(payload.tables);
  const refOf = new Map(Object.entries(ids).map(([ref, rowId]) => [rowId, ref]));

  const travelers = (payload.tables.travelers ?? []).filter((row) => row.deleted_at === null);
  const own = travelers.filter((row) => row.user_id === userId);
  const children = travelers.filter((row) => own.some((parent) => parent.id === row.guardian_id));
  const mine = [...own, ...children].flatMap((row) => refOf.get(row.id as string) ?? []);
  const packed = (payload.tables.packing_checks ?? []).filter((row) => row.deleted_at === null && row.packed === true).map((row) => `${refOf.get(row.packing_item_id as string)}|${refOf.get(row.traveler_id as string)}`);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Sprzęt</h1>
        </div>
        {mayEdit && <EditToggle editing={mayEdit && wantsEdit} />}
      </div>
      <GearView tripId={id} doc={doc} carries={carriesFromRows(payload.tables.packing_carriers ?? [], ids)} packed={packed} ids={ids} mine={mine} mayEdit={mayEdit} canEdit={mayEdit && wantsEdit} />
    </>
  );
}
