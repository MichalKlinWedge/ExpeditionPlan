import { loadTaskAlerts } from "@/lib/task-alerts";
import { createClient } from "@/lib/supabase/server";

import { TaskAlertsMenu } from "./task-alerts";

/** Licznik zadań w belce: dane z bazy (RLS — tylko moje wyjazdy); bez logowania nic. Renderowany w <Suspense>. */
export async function TaskAlerts() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const trips = await loadTaskAlerts(supabase);
  return trips.length === 0 ? null : <TaskAlertsMenu trips={trips} />;
}
