import { BriefFile } from "@expeditionplan/core";

import { createClient } from "@/lib/supabase/server";

/**
 * Brief wyjazdu jako plik (`BriefFile`) do planowania na własnym komputerze:
 * `npm run plan-ai -- --brief plik.json`, wynik wraca przez „Importuj z pliku”. RLS decyduje, czy wolno go czytać.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Zaloguj się.", { status: 401 });
  const [trip, brief] = await Promise.all([
    supabase.from("my_trips").select("title, primary_tz").eq("id", id).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", id).maybeSingle(),
  ]);
  if (trip.error || brief.error) return new Response((trip.error ?? brief.error)!.message, { status: 500 });
  if (trip.data === null) return new Response("Nie ma takiego wyjazdu.", { status: 404 });
  if (brief.data === null) return new Response("Najpierw uzupełnij brief wyjazdu.", { status: 404 });
  const file = BriefFile.safeParse({ title: trip.data.title, primaryTz: trip.data.primary_tz ?? undefined, brief: brief.data.brief });
  if (!file.success) return new Response(`Brief nie przechodzi walidacji: ${file.error.issues[0]?.message ?? ""}`, { status: 422 });
  const name = file.data.title.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "wyjazd";
  return new Response(JSON.stringify(file.data, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="brief-${name}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
