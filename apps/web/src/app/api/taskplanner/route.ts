import type { Database } from "@expeditionplan/db";
import { createClient } from "@supabase/supabase-js";

import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Webhook Task Plannera (plugin Webhook TP, `docs/INTEGRACJA_TP.md`): zamknięcie albo ponowne otwarcie zadania
 * wysłanego z EP. Podpis sprawdza i stan zmienia RPC `taskplanner_webhook` (sekret w Vault bazy), więc tu jest
 * tylko klucz publiczny. Kody wg reguł ponowień TP: 204 przyjęte, 400 bez ponowień, 401 wyłącza połączenie w TP,
 * 5xx ponawia.
 */

const MAX_BODY = 256_000;

const CODES: Record<string, number> = {
  applied: 204,
  unchanged: 204,
  unknown: 204,
  stale: 400,
  bad_request: 400,
  bad_signature: 401,
  not_configured: 503,
};

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > MAX_BODY) return Response.json({ error: "Za duża treść." }, { status: 413 });
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("taskplanner_webhook", {
    p_body: body,
    p_timestamp: request.headers.get("x-taskplanner-timestamp") ?? "",
    p_signature: request.headers.get("x-taskplanner-signature") ?? "",
  });
  if (error) return Response.json({ error: "Błąd bazy Expedition Plan." }, { status: 500 });
  const status = CODES[data] ?? 500;
  return status === 204 ? new Response(null, { status }) : Response.json({ error: data }, { status });
}
