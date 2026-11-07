import { dbErrorMessage, type PullPayload } from "@expeditionplan/sync";
import type { ZodError } from "zod";

import type { requireUser } from "@/lib/auth";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** Migawka wyjazdu do akcji serwera: `pull_changes` z polskim komunikatem błędu. */
export async function pullTrip(supabase: Supabase, tripId: string): Promise<{ payload: PullPayload; error?: undefined } | { error: string; payload?: undefined }> {
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: dbErrorMessage(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  return { payload: data as PullPayload };
}

/** Dokument po zmianie nie przeszedł schematu: pierwszy błąd z miejscem w dokumencie. */
export function validationError(error: ZodError): string {
  const issue = error.issues[0]!;
  return `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}`;
}
