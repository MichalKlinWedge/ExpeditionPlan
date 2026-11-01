"use server";

import { LogisticsCandidates, TripBrief, TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { type LogisticsDraft, logisticsCandidates, mergeLogistics } from "@expeditionplan/planner";
import { type Collection, COLLECTIONS, refIndex, rowForUpdate, SPECS, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { plural } from "@/lib/plural";

/**
 * Etap 4 AI na webie: szkic kandydatów (noclegi, auto, transfery…) w `ai_runs` (stage `logistics`),
 * dodanie wybranych grup do planu jako grup porównania i wybór jednej opcji („Wybieram”).
 * Bez rezerwacji (W1) — kandydat ma tylko linki wyszukiwania.
 */

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const [pulled, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (pulled.error) return { error: message(pulled.error) } as const;
  if (pulled.data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Kandydatów przygotowuje i wybiera organizator albo edytor." } as const;
  const payload = pulled.data as Parameters<typeof stateFromPayload>[0];
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  return { supabase, payload, doc: stateFromPayload(payload).doc, brief: brief.success ? brief.data : null } as const;
}

/** Nowy szkic kandydatów (strona pokazuje najnowszy). Zwykle 15–60 s. */
export async function draftCandidates(tripId: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` };
  const usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let draft: LogisticsDraft;
  try {
    draft = await logisticsCandidates(loaded.doc, loaded.brief, {
      client: setup.deps.client,
      onUsage: (each) => {
        usage.inputTokens += each.inputTokens;
        usage.outputTokens += each.outputTokens;
      },
    });
  } catch (e) {
    return { error: `AI nie przygotowało kandydatów: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { error } = await loaded.supabase.from("ai_runs").insert({
    id: uuidv7(),
    trip_id: tripId,
    stage: "logistics",
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
  return { ok: `Szkic gotowy: ${plural(draft.info.groups.length, ["decyzja", "decyzje", "decyzji"])} do porównania. Zaznacz, które dodać do planu.` };
}

/** Zaznaczone grupy szkicu → grupy porównania w planie (grupa, warianty, kandydaci — w tej kolejności, bo klucze obce). */
export async function applyCandidates(tripId: string, runId: string, groupIndexes: number[]): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run, error: runError } = await loaded.supabase.from("ai_runs").select("output").eq("id", runId).eq("trip_id", tripId).maybeSingle();
  if (runError) return { error: message(runError) };
  const info = LogisticsCandidates.safeParse((run?.output as { info?: unknown } | null)?.info);
  if (!info.success) return { error: "Szkic jest uszkodzony — przygotuj nowy." };

  const { doc, created } = mergeLogistics(loaded.doc, info.data, groupIndexes, uuidv7);
  if (created.length === 0) return { error: "Nic nie zaznaczono." };
  const checked = TripDocument.safeParse(doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };

  const ids = refIndex(loaded.payload.tables);
  for (const entry of created) ids[entry.element.ref] = entry.element.ref.slice(3);
  const owner = new Map<string, Collection>();
  for (const each of COLLECTIONS) for (const element of checked.data[each] as { ref?: string }[]) if (element.ref) owner.set(element.ref, each);
  const index = { idOf: (key: string) => ids[key]!, collectionOf: (key: string) => owner.get(key) };
  const db = loaded.supabase as unknown as SupabaseClient;
  let order = 0;
  for (const entry of created) {
    const row = { ...rowForUpdate(entry.collection, entry.element, index), id: index.idOf(entry.element.ref), trip_id: tripId, sort_key: `z${Date.now().toString(36)}${String(order++).padStart(3, "0")}` };
    const { error } = await db.from(SPECS[entry.collection].table).insert(row);
    if (error) return { error: `Zapisano ${order - 1} z ${created.length}, potem błąd: ${message(error)}` };
  }
  await loaded.supabase.from("ai_runs").update({ status: "accepted" }).eq("id", runId);
  refresh();
  return { ok: `Dodano do porównania: ${plural(groupIndexes.length, ["decyzję", "decyzje", "decyzji"])}.` };
}

/**
 * „Wybieram”: grupa dostaje `chosenRef`, wybrany kandydat status „do rezerwacji”, a pozostali
 * wracają do „kandydat” (zmiana zdania jest możliwa). Rezerwację robi człowiek poza aplikacją.
 */
export async function chooseCandidate(tripId: string, groupRef: string, variantRef: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc, payload, supabase } = loaded;
  const group = doc.variantGroups.find((each) => each.ref === groupRef && each.scope === "booking");
  if (group === undefined) return { error: "Nie ma takiej grupy porównania." };
  const bookings = doc.bookings.filter((each) => each.variantGroupRef === groupRef);
  const nextGroup = { ...group, chosenRef: variantRef };
  const nextBookings = bookings.map((each) => ({ ...each, status: each.variantRef === variantRef ? ("to_book" as const) : each.status === "to_book" ? ("candidate" as const) : each.status }));
  const next = {
    ...doc,
    variantGroups: doc.variantGroups.map((each) => (each.ref === groupRef ? nextGroup : each)),
    bookings: doc.bookings.map((each) => nextBookings.find((other) => other.ref === each.ref) ?? each),
  };
  const checked = TripDocument.safeParse(next);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };
  const ids = refIndex(payload.tables);
  const owner = new Map<string, Collection>();
  for (const each of COLLECTIONS) for (const element of checked.data[each] as { ref?: string }[]) if (element.ref) owner.set(element.ref, each);
  const index = { idOf: (key: string) => ids[key]!, collectionOf: (key: string) => owner.get(key) };
  const db = supabase as unknown as SupabaseClient;
  const writes: [Collection, { ref: string } & Record<string, unknown>][] = [["variantGroups", nextGroup], ...nextBookings.map((each) => ["bookings", each] as [Collection, typeof each])];
  for (const [collection, element] of writes) {
    const { data, error } = await db.from(SPECS[collection].table).update(rowForUpdate(collection, element, index)).eq("id", index.idOf(element.ref)).select("id");
    if (error) return { error: message(error) };
    if ((data ?? []).length === 0) return { error: "Brak uprawnień do tej zmiany." };
  }
  refresh();
  return { ok: `Wybrano. Kandydat ma status „do rezerwacji” — zarezerwuj go i zmień status w rezerwacjach.` };
}
