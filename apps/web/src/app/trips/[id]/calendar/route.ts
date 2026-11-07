import { tripCalendar } from "@expeditionplan/core";
import { dbLoadError, type PullPayload, stateFromPayload } from "@expeditionplan/sync";

import { createClient } from "@/lib/supabase/server";

/**
 * Plan wyjazdu jako plik `.ics` do kalendarza (Google Calendar → Importuj, kalendarz telefonu).
 * Godziny z silnika harmonogramu z uwzględnieniem wyborów z terenu (warianty, pominięte punkty,
 * opóźnienia); każde wydarzenie ma link do karty punktu. Dostęp jak przy eksporcie JSON — RLS.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Zaloguj się.", { status: 401 });
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return new Response(dbLoadError(error), { status: 500 });
  if (data === null) return new Response("Nie ma takiego wyjazdu.", { status: 404 });
  const { doc, inputs } = stateFromPayload(data as PullPayload);
  const origin = new URL(request.url).origin;
  const ics = tripCalendar(doc, {
    tripId: id,
    itemUrl: `${origin}/trips/${id}/item/{ref}`,
    scenario: "optimistic",
    activeVariants: inputs.activeVariants,
    delays: inputs.delays,
    skipRefs: inputs.skipRefs,
    done: inputs.done,
  });
  const name = doc.trip.title.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "wyjazd";
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
