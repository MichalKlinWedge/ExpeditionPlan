import type { Metadata } from "next";
import type { TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { TaskList } from "@/components/logistics-editors";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
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
        <Tasks params={props.params} />
      </Suspense>
    </Shell>
  );
}

async function Tasks({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsEdit = await editMode();
  const { supabase, userId } = await requireUser(`/trips/${id}/tasks`);
  const [{ data, error }, membership] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: id, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", id).maybeSingle(),
  ]);
  if (error) return <p className="text-sm msg-error">{dbLoadError(error)}</p>;
  if (data === null) notFound();
  const payload = data as PullPayload;
  let doc: TripDocument;
  try {
    doc = stateFromPayload(payload).doc;
  } catch (e) {
    return <p className="text-sm msg-error">Plan w bazie nie przechodzi walidacji: {e instanceof Error ? e.message : String(e)}</p>;
  }
  const mayEdit = membership.data?.role === "owner" || membership.data?.role === "editor";
  const canEdit = mayEdit && wantsEdit;
  const checkable = mayEdit ? doc.tasks.map((task) => task.ref) : checkableTasks(doc, payload.tables.travelers ?? [], userId);

  return (
    <>
      <PageHeader back={{ href: `/trips/${id}`, label: doc.trip.title }} title="Zadania" actions={mayEdit && <EditToggle editing={canEdit} />} />

      <TaskList
        tripId={id}
        tasks={doc.tasks}
        columns={taskColumns(doc)}
        choices={planChoices(doc)}
        canEdit={canEdit}
        checkable={checkable}
        notes={
          <>
            {doc.tasks.length === 0 && <p className="text-sm text-zinc-500">Plan nie ma zadań.{mayEdit && !canEdit ? " Dodasz je po „Edytuj”." : ""}</p>}
            {!mayEdit && doc.tasks.length > 0 && <p className="text-xs text-zinc-500">Odhaczasz zadania przypisane do siebie — resztę widzisz bez zmiany.</p>}
          </>
        }
      />
    </>
  );
}
