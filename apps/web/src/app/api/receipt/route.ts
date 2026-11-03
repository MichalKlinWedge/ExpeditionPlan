import type { Database } from "@expeditionplan/db";
import { readReceipt } from "@expeditionplan/planner";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { aiAccessFor, geminiClient } from "@/lib/ai";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Paragon ze zdjęcia dla telefonu: `POST` z `Authorization: Bearer <token sesji>` i JSON-em
 * `{ tripId, currencies, image: { mimeType, data } }` (base64). Klucz Gemini zostaje na serwerze.
 * Wolno uczestnikowi wyjazdu (RLS na `trips`) z dostępem do AI (`AI_ALLOWED_EMAILS`).
 * Odpowiedź: `{ draft }` (`ReceiptDraft` albo `null`, gdy na zdjęciu nie ma paragonu) albo `{ error }`.
 */

/** Limit ciała funkcji na Vercelu to 4,5 MB — obraz w base64 musi się w nim zmieścić. */
const MAX_BASE64 = 4_000_000;

const Body = z.object({
  tripId: z.uuid(),
  currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(10),
  image: z.object({ mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().min(1).max(MAX_BASE64) }),
});

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token === undefined) return fail("Zaloguj się.", 401);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail("Za duże albo niepoprawne zdjęcie.", 400);

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims } = await supabase.auth.getClaims(token);
  if (!claims?.claims) return fail("Sesja wygasła — zaloguj się ponownie.", 401);
  const denied = aiAccessFor(String(claims.claims.email ?? ""));
  if (denied !== null) return fail(denied, 403);
  const { data: trip } = await supabase.from("trips").select("id").eq("id", body.data.tripId).maybeSingle();
  if (trip === null) return fail("Nie ma takiego wyjazdu.", 404);

  const ai = geminiClient();
  if (ai === null) return fail("Brak klucza Gemini na serwerze.", 503);
  try {
    const draft = await readReceipt(ai.client, body.data.image, { currencies: body.data.currencies, timeoutMs: 45_000 });
    return Response.json({ draft });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
}
