"use server";

import { type CandidateRemoval, LogisticsCandidates, plural, removeCandidate, removeComparison, TripBrief, TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { type LogisticsDraft, logisticsCandidates, mergeLogistics } from "@expeditionplan/planner";
import { dbErrorMessage, type ElementWrite, type PullPayload, refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Etap 4 AI na webie: szkic kandydatów (noclegi, auto, transfery…) w `ai_runs` (stage `logistics`),
 * dodanie wybranych grup do planu jako grup porównania i wybór jednej opcji („Wybieram”).
 * Bez rezerwacji (W1) — kandydat ma tylko linki wyszukiwania.
 */

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const [pulled, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (pulled.error) return { error: dbErrorMessage(pulled.error) } as const;
  if (pulled.data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Kandydatów przygotowuje i wybiera organizator albo edytor." } as const;
  const payload = pulled.data as PullPayload;
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
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: `Szkic gotowy: ${plural(draft.info.groups.length, ["decyzja", "decyzje", "decyzji"])} do porównania. Zaznacz, które dodać do planu.` };
}

/** Zaznaczone grupy szkicu → grupy porównania w planie (grupa, warianty, kandydaci — w tej kolejności, bo klucze obce). */
export async function applyCandidates(tripId: string, runId: string, groupIndexes: number[]): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run, error: runError } = await loaded.supabase.from("ai_runs").select("output").eq("id", runId).eq("trip_id", tripId).maybeSingle();
  if (runError) return { error: dbErrorMessage(runError) };
  const info = LogisticsCandidates.safeParse((run?.output as { info?: unknown } | null)?.info);
  if (!info.success) return { error: "Szkic jest uszkodzony — przygotuj nowy." };

  const { doc, created } = mergeLogistics(loaded.doc, info.data, groupIndexes, uuidv7);
  if (created.length === 0) return { error: "Nic nie zaznaczono." };
  const checked = TripDocument.safeParse(doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };

  const writes = created.map((entry) => ({ collection: entry.collection, element: entry.element as ElementWrite["element"], op: "insert" as const }));
  try {
    await saveElements(loaded.supabase, tripId, checked.data, writes, refIndex(loaded.payload.tables));
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
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
  const writes: ElementWrite[] = [
    { collection: "variantGroups", element: nextGroup, op: "update" },
    ...nextBookings.map((each) => ({ collection: "bookings" as const, element: each as ElementWrite["element"], op: "update" as const })),
  ];
  try {
    await saveElements(supabase, tripId, checked.data, writes, refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: `Wybrano. Kandydat ma status „do rezerwacji” — zarezerwuj go i zmień status w rezerwacjach.` };
}

/**
 * Usunięcie propozycji z porównania (`removeCandidate`): jej wariant i rezerwacje-kandydaci z odwołaniami; gdy zostaje
 * jedna propozycja, porównanie się kończy i ona zostaje zwykłą rezerwacją. Dokumenty z sejfu tracą powiązanie z usuniętą
 * rezerwacją (jak przy usuwaniu anulowanej), zostają w „Inne dokumenty”.
 */
export async function removeComparisonCandidate(tripId: string, groupRef: string, variantRef: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc } = loaded;
  const label = doc.variants.find((each) => each.ref === variantRef)?.label ?? "propozycję";
  const result = removeCandidate(doc, groupRef, variantRef);
  if ("error" in result) return { error: result.error };
  const saved = await saveRemoval(tripId, loaded, result);
  if ("error" in saved) return saved;
  const checked = saved.doc;
  refresh();
  if (!result.ended) return { ok: `Usunięto „${label}”.` };
  const left = checked.bookings.find((booking) => doc.bookings.some((before) => before.ref === booking.ref && before.variantGroupRef === groupRef));
  return { ok: `Usunięto „${label}”. Została jedna propozycja — porównanie zakończone${left ? `, „${left.title}” jest zwykłą rezerwacją` : ""}.` };
}

/** Zapis usunięcia z porównania: dokumenty z sejfu tracą powiązanie z usuniętymi rezerwacjami, potem zmiany i usunięcia. */
async function saveRemoval(tripId: string, loaded: { supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]; payload: PullPayload }, result: CandidateRemoval): Promise<{ doc: TripDocument } | { error: string }> {
  const { supabase, payload } = loaded;
  const checked = TripDocument.safeParse(result.doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };
  let ids = refIndex(payload.tables);
  for (const ref of result.removedBookingRefs) {
    const id = ids[ref];
    if (id === undefined) continue;
    const unlinked = await supabase.from("documents").update({ booking_id: null }).eq("trip_id", tripId).eq("booking_id", id);
    if (unlinked.error) return { error: dbErrorMessage(unlinked.error) };
  }
  const writes = result.writes as ElementWrite[];
  const upserts = writes.filter((write) => write.op !== "remove");
  const removes = writes.filter((write) => write.op === "remove");
  try {
    if (upserts.length > 0) ids = await saveElements(supabase, tripId, checked.data, upserts, ids);
    if (removes.length > 0) await saveElements(supabase, tripId, checked.data, removes, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { doc: checked.data };
}

/** Usunięcie całego porównania (`removeComparison`): grupa, propozycje i ich rezerwacje-kandydaci. */
export async function removeComparisonGroup(tripId: string, groupRef: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const title = loaded.doc.variantGroups.find((each) => each.ref === groupRef)?.title ?? "porównanie";
  const result = removeComparison(loaded.doc, groupRef);
  if ("error" in result) return { error: result.error };
  const saved = await saveRemoval(tripId, loaded, result);
  if ("error" in saved) return saved;
  refresh();
  return { ok: `Usunięto porównanie „${title}” (${plural(result.removedBookingRefs.length, ["rezerwacja-kandydat", "rezerwacje-kandydaci", "rezerwacji-kandydatów"])}).` };
}
