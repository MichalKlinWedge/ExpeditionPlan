import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle, editMode } from "@/components/edit-toggle";
import { TaskList } from "@/components/logistics-editors";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { checkableTasks, planChoices, taskColumns } from "@/lib/tasks";

export const metadata: Metadata = { title: "Zadania — Expedition Planner" };

/**
 * Zadania wyjazdu (przed wyjazdem i w trakcie) — osobna strona, jak zakładka „Zadania” na telefonie.
 * W podglądzie odhacza organizator, edytor i widz przy zadaniach przypisanych do siebie (RLS);
 * dodawanie, edycja i usuwanie — po „Edytuj”.
 */

export default function TasksPage(props: PageProps<"/trips/[id]/tasks">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Tasks params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </Shell>
  );
}

async function Tasks({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const wantsEdit = await editMode(searchParams);
  const { supabase, userId } = await requireUser(`/trips/${id}/tasks`);
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
  const open = doc.tasks.filter((task) => task.status === "open");
  const closed = doc.tasks.length - open.length;
  const checkable = mayEdit ? doc.tasks.map((task) => task.ref) : checkableTasks(doc, payload.tables.travelers ?? [], userId);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Link href={`/trips/${id}`} className="back-link">
            ← {doc.trip.title}
          </Link>
          <h1 className="text-2xl font-semibold">Zadania</h1>
        </div>
        {mayEdit && <EditToggle href={`/trips/${id}/tasks`} editing={canEdit} />}
      </div>

      <section className="flex flex-col gap-3 card p-4">
        <h2 className="text-lg font-semibold">
          Do zrobienia: {open.length}
          {closed > 0 ? <span className="text-sm font-normal text-zinc-500"> (zamknięte: {closed})</span> : null}
        </h2>
        {doc.tasks.length === 0 && <p className="text-sm text-zinc-500">Plan nie ma zadań.{mayEdit ? " Dodasz je po „Edytuj”." : ""}</p>}
        {!mayEdit && doc.tasks.length > 0 && <p className="text-xs text-zinc-500">Odhaczasz zadania przypisane do siebie — resztę widzisz bez zmiany.</p>}
        <TaskList tripId={id} tasks={doc.tasks} columns={taskColumns(doc)} choices={planChoices(doc)} canEdit={canEdit} checkable={checkable} />
      </section>
    </>
  );
}
