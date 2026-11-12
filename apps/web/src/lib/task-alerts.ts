import { isDraft, POSTPONED, type TaskDueContext, taskDates, type TripDocument } from "@expeditionplan/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daty otwartych zadań we wszystkich moich zaplanowanych wyjazdach (bez szkiców AI, odłożonych i minionych) do
 * licznika w belce: „zbliża się” i „po terminie”. Zamiast całych planów (`pull_changes` na każdej stronie) tylko
 * wiersze potrzebne do dat terminów (`taskDates`); dzisiejszą datę i liczniki liczy przeglądarka.
 */

export type TripTaskDates = { tripId: string; title: string; tasks: string[][] };

type Row = Record<string, unknown>;
const refOf = (row: Row) => (typeof row.ref === "string" ? row.ref : `id-${String(row.id)}`);

export async function loadTaskAlerts(supabase: SupabaseClient): Promise<TripTaskDates[]> {
  const { data: trips } = await supabase.from("my_trips").select("id, title, status, start_date, end_date");
  // Z dniem zapasu na strefy: wyjazd, który skończył się wczoraj, liczy się jeszcze dziś.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const planned = (trips ?? []).filter((trip) => !isDraft(trip) && trip.status !== POSTPONED && typeof trip.end_date === "string" && trip.end_date >= yesterday);
  if (planned.length === 0) return [];
  const ids = planned.map((trip) => trip.id as string);
  const { data: tasks } = await supabase.from("tasks").select("trip_id, status, due, deadline").in("trip_id", ids).eq("status", "open").is("deleted_at", null);
  if (!tasks || tasks.length === 0) return [];
  const kinds = new Set(tasks.map((task) => (task.due as { kind?: string } | null)?.kind));
  // Punkty i rezerwacje tylko wtedy, gdy jakieś zadanie ma termin względem nich.
  const [days, items, bookings] = await Promise.all([
    supabase.from("days").select("id, ref, trip_id, date").in("trip_id", ids).is("deleted_at", null),
    kinds.has("before_item") ? supabase.from("items").select("id, ref, trip_id, day_id").in("trip_id", ids).is("deleted_at", null) : Promise.resolve({ data: [] as Row[] }),
    kinds.has("before_booking") ? supabase.from("bookings").select("id, ref, trip_id, start_date").in("trip_id", ids).is("deleted_at", null) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const dayRef = new Map((days.data ?? []).map((row) => [String(row.id), refOf(row)]));
  const of = <T extends Row>(rows: T[] | null, tripId: string) => (rows ?? []).filter((row) => row.trip_id === tripId);

  return planned.flatMap((trip) => {
    const tripId = trip.id as string;
    const context: TaskDueContext = {
      trip: { startDate: trip.start_date as string, endDate: trip.end_date as string },
      days: of(days.data, tripId).map((row) => ({ ref: refOf(row), date: String(row.date) })),
      items: of(items.data as Row[], tripId).map((row) => ({ ref: refOf(row), dayRef: typeof row.day_id === "string" ? dayRef.get(row.day_id) : undefined })),
      bookings: of(bookings.data as Row[], tripId).map((row) => ({ ref: refOf(row), start: typeof row.start_date === "string" ? { date: row.start_date } : undefined })),
    };
    const dates = of(tasks, tripId)
      .map((row) => taskDates(context, { status: "open", due: (row.due ?? undefined) as TripDocument["tasks"][number]["due"], deadline: typeof row.deadline === "string" ? row.deadline : undefined }))
      .filter((each) => each.length > 0);
    return dates.length === 0 ? [] : [{ tripId, title: String(trip.title), tasks: dates }];
  });
}
