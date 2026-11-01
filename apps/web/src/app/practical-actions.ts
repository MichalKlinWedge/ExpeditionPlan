"use server";

import { PracticalInfo, TripBrief, TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { mergePractical, type PracticalDraft, type PracticalPick, practicalInfo } from "@expeditionplan/planner";
import { type Collection, COLLECTIONS, refIndex, rowForUpdate, SPECS, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Etap 5 AI na webie: szkic informacji praktycznych zapisany w `ai_runs` (stage `practical`)
 * i dodanie do planu tylko tego, co człowiek zaznaczy (SPECYFIKACJA §4: propozycja → akceptacja).
 */

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/practical`);
  const [pulled, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (pulled.error) return { error: message(pulled.error) } as const;
  if (pulled.data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Informacje praktyczne z AI przygotowuje organizator albo edytor." } as const;
  const payload = pulled.data as Parameters<typeof stateFromPayload>[0];
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  return { supabase, payload, doc: stateFromPayload(payload).doc, brief: brief.success ? brief.data : null } as const;
}

/** Nowy szkic etapu 5 (zastępuje poprzedni — strona pokazuje najnowszy). Trwa ok. 20–60 s. */
export async function draftPractical(tripId: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` };
  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let draft: PracticalDraft;
  try {
    draft = await practicalInfo(loaded.doc, loaded.brief, {
      client: setup.deps.client,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie przygotowało informacji: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { error } = await loaded.supabase.from("ai_runs").insert({
    id: uuidv7(),
    trip_id: tripId,
    stage: "practical",
    provider: "GEMINI",
    model: setup.model,
    input: {} as Json,
    output: draft as unknown as Json,
    status: "ok",
    tokens_in: usage.inputTokens,
    tokens_out: usage.outputTokens,
    duration_ms: Date.now() - started,
  });
  if (error) return { error: message(error) };
  refresh();
  const dead = draft.sources.filter((source) => !source.ok).length;
  return { ok: `Szkic gotowy${dead > 0 ? ` (odrzucone martwe źródła: ${dead})` : ""}. Zaznacz, co dodać do planu.` };
}

/** Zaznaczone elementy szkicu → nowe wiersze planu; szkic dostaje status `accepted`. */
export async function applyPractical(tripId: string, runId: string, pick: PracticalPick): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run, error: runError } = await loaded.supabase.from("ai_runs").select("output, status").eq("id", runId).eq("trip_id", tripId).maybeSingle();
  if (runError) return { error: message(runError) };
  if (run === null) return { error: "Nie ma takiego szkicu." };
  const info = PracticalInfo.safeParse((run.output as { info?: unknown } | null)?.info);
  if (!info.success) return { error: "Szkic jest uszkodzony — przygotuj nowy." };

  const { doc, created } = mergePractical(loaded.doc, info.data, pick, uuidv7, new Date().toISOString().slice(0, 10));
  if (created.length === 0) return { error: "Nic nie zaznaczono (albo wszystko już jest w planie)." };
  const checked = TripDocument.safeParse(doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };

  const ids = refIndex(loaded.payload.tables);
  for (const entry of created) ids[entry.element.ref!] = entry.element.ref!.slice(3);
  const owner = new Map<string, Collection>();
  for (const each of COLLECTIONS) for (const element of checked.data[each] as { ref?: string }[]) if (element.ref) owner.set(element.ref, each);
  const index = { idOf: (key: string) => ids[key]!, collectionOf: (key: string) => owner.get(key) };
  const db = loaded.supabase as unknown as SupabaseClient;
  let order = 0;
  for (const entry of created) {
    const row = { ...rowForUpdate(entry.collection, entry.element, index), id: index.idOf(entry.element.ref!), trip_id: tripId, sort_key: `z${Date.now().toString(36)}${String(order++).padStart(3, "0")}` };
    const { error } = await db.from(SPECS[entry.collection].table).insert(row);
    if (error) return { error: `Dodano ${order - 1} z ${created.length}, potem błąd: ${message(error)}` };
  }
  await loaded.supabase.from("ai_runs").update({ status: "accepted" }).eq("id", runId);
  refresh();
  const count = (collection: string) => created.filter((entry) => entry.collection === collection).length;
  return { ok: `Dodano: notatki ${count("notes")}, kontakty ${count("contacts")}, pakowanie ${count("packing")}, zadania ${count("tasks")}, źródła ${count("sources")}.` };
}
