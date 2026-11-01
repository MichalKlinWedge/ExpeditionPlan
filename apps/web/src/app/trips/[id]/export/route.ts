import { stateFromPayload } from "@expeditionplan/sync";

import { createClient } from "@/lib/supabase/server";

/**
 * Plan wyjazdu jako plik JSON (`TripDocument`), np. żeby przenieść szkic z lokalnej bazy do
 * chmury („Importuj z pliku” na stronie nowego wyjazdu). Ta sama droga co plan: `pull_changes`
 * → dokument; RLS decyduje, czy wolno go czytać. Wydatki, zdarzenia dnia i odhaczenia pakowania
 * nie są częścią dokumentu — eksport to plan, nie przebieg wyjazdu.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Zaloguj się.", { status: 401 });
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: id, p_since: 0 });
  if (error) return new Response(error.message, { status: 500 });
  if (data === null) return new Response("Nie ma takiego wyjazdu.", { status: 404 });
  const { doc } = stateFromPayload(data as Parameters<typeof stateFromPayload>[0]);
  const name = doc.trip.title.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "wyjazd";
  return new Response(JSON.stringify(doc, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
