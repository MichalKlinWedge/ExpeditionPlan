import type { Database } from "@expeditionplan/db";
import { EateriesRequest, eateriesForMeal, findEateries, positionCenter } from "@expeditionplan/planner";
import { type PullPayload, stateFromPayload } from "@expeditionplan/sync";
import { createClient } from "@supabase/supabase-js";

import { aiAccessFor } from "@/lib/ai";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * „Knajpy w pobliżu” posiłku dla telefonu: `POST` z `Authorization: Bearer <token sesji>` i JSON-em
 * `EateriesRequest` (`{ tripId, itemRef, kinds, radiusM, diet?, position? }`). Klucz Geoapify zostaje
 * na serwerze. Wolno uczestnikowi wyjazdu (RLS) z dostępem do usług na kluczach (`AI_ALLOWED_EMAILS`).
 * `position` (zaokrąglona przez telefon, tylko po „Szukaj wokół mnie”) jest wyłącznie środkiem tego
 * zapytania — nie trafia do bazy ani do logów (SPECYFIKACJA §8). Odpowiedź: `EateryAnswer`.
 */

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined) return fail("Zaloguj się.", 401);
  const body = EateriesRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail("Niepoprawne zapytanie.", 400);
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  if (key === "") return fail("Serwer nie ma klucza GEOAPIFY_API_KEY.", 503);

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims } = await supabase.auth.getClaims(token);
  if (!claims?.claims) return fail("Sesja wygasła — zaloguj się ponownie.", 401);
  const denied = aiAccessFor(String(claims.claims.email ?? ""));
  if (denied !== null) return fail(denied, 403);

  const { tripId, itemRef, kinds, radiusM, diet, position } = body.data;
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error || data === null) return fail("Nie ma takiego wyjazdu.", 404);
  let doc;
  try {
    doc = stateFromPayload(data as PullPayload).doc;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
  const answer = await eateriesForMeal(doc, itemRef, { kinds, radiusM, ...(diet ? { diet } : {}), ...(position ? { center: positionCenter(position) } : {}) }, (search) =>
    findEateries(key, search),
  );
  return "error" in answer ? fail(answer.error, 422) : Response.json(answer);
}
