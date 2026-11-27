import type { Metadata } from "next";
import { type PlannerTaskStatus, suggestedForPlanner, type TripDocument } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EditToggle } from "@/components/edit-toggle";
import { editMode } from "@/lib/edit-mode";
import { TaskList } from "@/components/logistics-editors";
import { Loading, Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { checkableTasks, myTravelerRefs, planChoices, taskColumns } from "@/lib/tasks";
import { type PlannerRow, TaskPlannerSend } from "@/components/taskplanner-send";
import { plannerConfig } from "@/lib/taskplanner";

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
  const { supabase, userId, email } = await requireUser(`/trips/${id}/tasks`);
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
  const planner = mayEdit && doc.tasks.length > 0 ? plannerConfig(email) : { off: null };
  let plannerRows: PlannerRow[] = [];
  if ("config" in planner) {
    const exports = await supabase.from("task_exports").select("task_id, tp_url, tp_status, tp_deleted, sent_at").eq("trip_id", id);
    const ids = refIndex(payload.tables);
    const byId = new Map((exports.data ?? []).map((row) => [row.task_id, row]));
    plannerRows = doc.tasks.map((task) => {
      const row = ids[task.ref] === undefined ? undefined : byId.get(ids[task.ref]!);
      return {
        ref: task.ref,
        title: task.title,
        status: task.status,
        ...(row && { export: { tpUrl: row.tp_url, tpStatus: row.tp_status as PlannerTaskStatus | null, tpDeleted: row.tp_deleted, sentAt: row.sent_at } }),
      };
    });
  }

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

      {"config" in planner && <TaskPlannerSend tripId={id} rows={plannerRows} suggested={suggestedForPlanner(doc, myTravelerRefs(payload.tables.travelers ?? [], userId))} />}
      {"off" in planner && planner.off !== null && <p className="text-xs msg-error">{planner.off}</p>}
    </>
  );
}
