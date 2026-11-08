"use server";

import { PlanPatch, plural } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { applyPatch, type ChatTurn, type OpResult, tunePlan } from "@expeditionplan/planner";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { loadForPatch, savePatchedPlan } from "@/lib/patch-save";

/**
 * Etap 3 AI na webie: polecenie → łatka (ai_runs stage `tune`, rozmowa w ai_messages) → podgląd →
 * „Zastosuj” (łatka liczona od nowa na świeżym planie, nowe miejsca ugruntowane, zapis) albo
 * „Odrzuć”. Punkty zmienione ręcznie (`user_locked`) są nietykalne.
 */


const load = (tripId: string) => loadForPatch(tripId, `/trips/${tripId}/tune`, "Dostrajać plan może organizator albo edytor.");

/** Polecenie → łatka do podglądu (nic się nie zapisuje w planie). */
export async function proposePatch(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const command = String(form.get("command") ?? "").trim();
  if (command === "") return { error: "Napisz, co zmienić." };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` };
  const { data: past } = await loaded.supabase.from("ai_messages").select("role, content").eq("trip_id", tripId).order("created_at", { ascending: false }).limit(10);
  const history: ChatTurn[] = (past ?? []).reverse().flatMap((turn) => (turn.role === "user" || turn.role === "assistant" ? [{ role: turn.role, content: turn.content }] : []));

  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let patch: PlanPatch;
  try {
    patch = await tunePlan(loaded.doc, loaded.locked, history, command, {
      client: setup.deps.client,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie przygotowało zmian: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { results } = applyPatch(loaded.doc, patch, loaded.locked, uuidv7);
  // Poprzednie niezastosowane łatki tracą ważność — pokazujemy jedną, najnowszą.
  await loaded.supabase.from("ai_runs").update({ status: "rejected" }).eq("trip_id", tripId).eq("stage", "tune").eq("status", "ok");
  const runId = uuidv7();
  const { error } = await loaded.supabase.from("ai_runs").insert({
    id: runId,
    trip_id: tripId,
    stage: "tune",
    provider: "GEMINI",
    model: setup.model,
    input: { command } as Json,
    output: { patch, results } as unknown as Json,
    status: "ok",
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    duration_ms: Date.now() - started,
  });
  if (error) return { error: dbErrorMessage(error) };
  // Jawne czasy: oba wpisy w jednym zapytaniu dostałyby ten sam `created_at`, a rozmowa ma iść po kolei.
  const asked = new Date();
  await loaded.supabase.from("ai_messages").insert([
    { id: uuidv7(), trip_id: tripId, role: "user", content: command, ai_run_id: runId, created_at: asked.toISOString() },
    { id: uuidv7(), trip_id: tripId, role: "assistant", content: patch.message, ai_run_id: runId, created_at: new Date(asked.getTime() + 1).toISOString() },
  ]);
  refresh();
  return { ok: "Propozycja gotowa — sprawdź podgląd i zastosuj albo odrzuć." };
}

/** „Zastosuj”: łatka od nowa na świeżym planie (ktoś mógł go zmienić), nowe i przeszukiwane miejsca w Geoapify, zapis. */
export async function acceptPatch(tripId: string, runId: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run } = await loaded.supabase.from("ai_runs").select("output, status").eq("id", runId).eq("trip_id", tripId).maybeSingle();
  if (run?.status !== "ok") return { error: "Ta propozycja jest już nieaktualna." };
  const patch = PlanPatch.safeParse((run.output as { patch?: unknown } | null)?.patch);
  if (!patch.success) return { error: "Propozycja jest uszkodzona — poproś o nową." };

  const applied = applyPatch(loaded.doc, patch.data, loaded.locked, uuidv7);
  if (!applied.results.some((result) => result.ok)) return { error: "Żadnej zmiany nie da się już zastosować." };
  const saved = await savePatchedPlan(loaded.supabase, tripId, loaded, applied.doc);
  if ("error" in saved) return saved;
  await loaded.supabase.from("ai_runs").update({ status: "accepted" }).eq("id", runId);
  refresh();
  const skipped = applied.results.filter((result) => !result.ok).length;
  return { ok: `Zastosowano ${plural(applied.results.length - skipped, ["zmianę", "zmiany", "zmian"])}${skipped > 0 ? `, pominięto ${skipped}` : ""}.` };
}

export async function rejectPatch(tripId: string, runId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/tune`);
  const { error } = await supabase.from("ai_runs").update({ status: "rejected" }).eq("id", runId).eq("trip_id", tripId);
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: "Odrzucono." };
}

export type TuneResults = OpResult[];
