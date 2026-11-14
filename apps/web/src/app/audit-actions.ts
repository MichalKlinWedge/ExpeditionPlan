"use server";

import { carriesFromRows, instantToZoned, plural, StoredAudit, tripReadiness } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { auditTrip, openFindings } from "@expeditionplan/planner";
import { dbErrorMessage, refIndex, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { loadForPatch } from "@/lib/patch-save";

/**
 * „Sprawdź wyjazd” na stronie dostrajania: kontrola całego wyjazdu z AI (`planner/src/audit.ts`), zapis w `ai_runs`
 * (stage `audit`, `StoredAudit`). Nowa kontrola zastępuje poprzednią; uwagi można odrzucać pojedynczo. Plan się nie zmienia.
 */

const DENIED = "Sprawdzać wyjazd z AI może organizator albo edytor.";

export async function runTripAudit(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const note = String(form.get("note") ?? "").slice(0, 500);
  const loaded = await loadForPatch(tripId, `/trips/${tripId}/tune`, DENIED);
  if ("error" in loaded) return { error: loaded.error };
  if (loaded.doc.days.length === 0) return { error: "Plan nie ma jeszcze dni." };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Serwer nie ma klucza GEMINI_API_KEY." };

  // Braki z „Gotowości do wyjazdu” (te same dane co na stronie wyjazdu): model ma je jako pewne fakty.
  const { doc, payload } = loaded;
  const today = instantToZoned(Date.now(), doc.trip.primaryTz).date;
  const ids = refIndex(payload.tables);
  const refById = new Map(Object.entries(ids).map(([ref, id]) => [id, ref]));
  const vault = new Set((payload.tables.documents ?? []).filter((row) => row.deleted_at === null && typeof row.booking_id === "string").map((row) => refById.get(row.booking_id as string) ?? ""));
  const codeIssues = tripReadiness(doc, today, vault, carriesFromRows(payload.tables.packing_carriers ?? [], ids));

  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let stored: StoredAudit;
  try {
    stored = await auditTrip(doc, loaded.locked, { codeIssues, today, note }, {
      client: gemini.client,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie sprawdziło wyjazdu: ${e instanceof Error ? e.message : String(e)}` };
  }
  await loaded.supabase.from("ai_runs").update({ status: "rejected" }).eq("trip_id", tripId).eq("stage", "audit").eq("status", "ok");
  const { error } = await loaded.supabase.from("ai_runs").insert({
    id: uuidv7(),
    trip_id: tripId,
    stage: "audit",
    provider: "GEMINI",
    model: gemini.model,
    input: { note, today } as Json,
    output: stored as unknown as Json,
    status: "ok",
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    duration_ms: Date.now() - started,
  });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  const count = stored.audit.findings.length;
  return { ok: count === 0 ? "AI nie znalazło problemów." : `Znaleziono: ${plural(count, ["uwaga", "uwagi", "uwag"])}.` };
}

/** Odrzucenie uwagi (nie dotyczy albo już załatwione) — znika z listy tej kontroli. */
export async function dismissAuditFinding(tripId: string, runId: string, findingId: string): Promise<FormState> {
  const loaded = await loadForPatch(tripId, `/trips/${tripId}/tune`, DENIED);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run } = await loaded.supabase.from("ai_runs").select("output, status").eq("id", runId).eq("trip_id", tripId).eq("stage", "audit").maybeSingle();
  if (run?.status !== "ok") return { error: "Ta kontrola jest już nieaktualna — odśwież stronę." };
  const stored = StoredAudit.safeParse(run.output);
  if (!stored.success) return { error: "Kontrola jest uszkodzona — sprawdź wyjazd od nowa." };
  if (!stored.data.audit.findings.some((each) => each.id === findingId)) return { error: "Nie ma takiej uwagi." };
  const next: StoredAudit = { ...stored.data, dismissed: [...new Set([...stored.data.dismissed, findingId])] };
  const { error } = await loaded.supabase.from("ai_runs").update({ output: next as unknown as Json }).eq("id", runId).eq("trip_id", tripId);
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: openFindings(next).length === 0 ? "Wszystkie uwagi przejrzane." : "Odrzucono uwagę." };
}
