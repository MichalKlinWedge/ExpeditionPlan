"use server";

import { capitalized, plannerKey, plannerTask, plural } from "@expeditionplan/core";
import { dbErrorMessage, refIndex, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { headers } from "next/headers";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { PlannerError, plannerConfig, putPlannerTask } from "@/lib/taskplanner";
import { pullTrip } from "@/lib/trip-snapshot";

/**
 * Wysyła zadania wyjazdu do Task Plannera (`PUT /tasks/{key}`, `docs/INTEGRACJA_TP.md`) i zapisuje wysłane w
 * `task_exports`. Ponowna wysyłka aktualizuje zadanie w TP; pola zmienione tam przez użytkownika TP zostawia.
 */
export async function sendTasksToPlanner(tripId: string, refs: string[]): Promise<FormState> {
  const { supabase, email } = await requireUser(`/trips/${tripId}/tasks`);
  const setup = plannerConfig(email);
  if ("off" in setup) return { error: setup.off ?? "Wysyłka do Task Plannera nie jest dostępna dla tego konta." };
  const membership = await supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle();
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Zadania do Task Plannera wysyła organizator albo edytor." };

  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { doc } = stateFromPayload(pulled.payload);
  const ids = refIndex(pulled.payload.tables);
  const wanted = new Set(refs);
  const tasks = doc.tasks.filter((task) => wanted.has(task.ref) && ids[task.ref] !== undefined);
  if (tasks.length === 0) return { error: "Zaznacz co najmniej jedno zadanie." };

  // Akcje serwera przyjmują tylko żądania z tego samego adresu co strona.
  const origin = (await headers()).get("origin") ?? "";
  const tripUrl = `${origin}/trips/${tripId}/tasks`;
  let created = 0;
  let updated = 0;
  let kept = 0;
  let gone = 0;
  const failed: string[] = [];
  for (const task of tasks) {
    try {
      const result = await putPlannerTask(setup.config, plannerKey(tripId, task.ref), plannerTask(doc, task, { tripId, tripUrl, taskUrl: `${tripUrl}#zadanie-${task.ref}` }));
      const { error } = await supabase.from("task_exports").upsert({
        task_id: ids[task.ref]!,
        trip_id: tripId,
        tp_task_id: result.id,
        tp_url: result.url,
        tp_status: result.status,
        tp_deleted: result.deleted,
        sent_at: new Date().toISOString(),
      });
      if (error) {
        failed.push(`„${task.title}”: wysłane, ale nie zapisane w EP (${dbErrorMessage(error)})`);
        continue;
      }
      if (result.created) created += 1;
      else updated += 1;
      if (result.kept.length > 0) kept += 1;
    } catch (e) {
      if (e instanceof PlannerError && (e.status === 401 || e.status === 403)) return { error: e.message };
      // 410: usunięte w TP na stałe — TP nie zakłada go od nowa; EP tylko to odnotowuje.
      if (e instanceof PlannerError && e.status === 410) {
        await supabase.from("task_exports").update({ tp_deleted: true }).eq("task_id", ids[task.ref]!);
        gone += 1;
        continue;
      }
      failed.push(`„${task.title}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  refresh();
  const done = [
    created > 0 ? `nowe w Task Plannerze: ${created}` : undefined,
    updated > 0 ? `zaktualizowane: ${updated}` : undefined,
    kept > 0 ? `${plural(kept, ["zadanie ma", "zadania mają", "zadań ma"])} w TP własne zmiany, których nie nadpisano` : undefined,
    gone > 0 ? `${plural(gone, ["zadanie usunięto", "zadania usunięto", "zadań usunięto"])} w TP na stałe — pominięte` : undefined,
  ].filter(Boolean);
  if (failed.length > 0) return { error: [done.length > 0 ? `${capitalized(done.join(", "))}.` : "", `Nie wysłano: ${failed.join("; ")}.`].filter(Boolean).join(" ") };
  return { ok: `${capitalized(done.join(", "))}.` };
}
