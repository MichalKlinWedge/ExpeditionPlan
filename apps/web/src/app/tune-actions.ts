"use server";

import { PlanPatch, TripBrief, TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { applyPatch, type ChatTurn, geoapifyLookup, groundPlaces, type OpResult, patchDiff, tunePlan, withCoordinates } from "@expeditionplan/planner";
import { refIndex, saveMergeEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { countriesFor } from "@/lib/countries";

/**
 * Etap 3 AI na webie: polecenie → łatka (ai_runs stage `tune`, rozmowa w ai_messages) → podgląd →
 * „Zastosuj” (łatka liczona od nowa na świeżym planie, nowe miejsca ugruntowane, zapis) albo
 * „Odrzuć”. Punkty zmienione ręcznie (`user_locked`) są nietykalne.
 */

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);
type Row = { id: string; ref: string | null; user_locked?: boolean; deleted_at: string | null };

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/tune`);
  const [pulled, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (pulled.error) return { error: message(pulled.error) } as const;
  if (pulled.data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: "Dostrajać plan może organizator albo edytor." } as const;
  const payload = pulled.data as Parameters<typeof stateFromPayload>[0];
  const rows = (payload.tables.items ?? []) as unknown as Row[];
  const locked = new Set(rows.filter((row) => row.user_locked && row.deleted_at === null).map((row) => row.ref ?? `id-${row.id}`));
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  return { supabase, payload, doc: stateFromPayload(payload).doc, locked, brief: brief.success ? brief.data : null } as const;
}

/** Polecenie → łatka do podglądu (nic się nie zapisuje w planie). */
export async function proposePatch(tripId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const command = String(form.get("command") ?? "").trim();
  if (command === "") return { error: "Napisz, co zmienić." };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
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
  if (error) return { error: message(error) };
  await loaded.supabase.from("ai_messages").insert([
    { id: uuidv7(), trip_id: tripId, role: "user", content: command, ai_run_id: runId },
    { id: uuidv7(), trip_id: tripId, role: "assistant", content: patch.message, ai_run_id: runId },
  ]);
  refresh();
  return { ok: "Propozycja gotowa — sprawdź podgląd i zastosuj albo odrzuć." };
}

/** „Zastosuj”: łatka od nowa na świeżym planie (ktoś mógł go zmienić), nowe miejsca w Geoapify, zapis. */
export async function acceptPatch(tripId: string, runId: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { data: run } = await loaded.supabase.from("ai_runs").select("output, status").eq("id", runId).eq("trip_id", tripId).maybeSingle();
  if (run?.status !== "ok") return { error: "Ta propozycja jest już nieaktualna." };
  const patch = PlanPatch.safeParse((run.output as { patch?: unknown } | null)?.patch);
  if (!patch.success) return { error: "Propozycja jest uszkodzona — poproś o nową." };

  const applied = applyPatch(loaded.doc, patch.data, loaded.locked, uuidv7);
  if (!applied.results.some((result) => result.ok)) return { error: "Żadnej zmiany nie da się już zastosować." };
  let doc = applied.doc;
  // Ugruntowanie nowych miejsc (współrzędne) — błąd usługi nie blokuje zapisu.
  const newPlaces = doc.places.filter((place) => !loaded.doc.places.some((old) => old.ref === place.ref));
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  const countries = countriesFor(loaded.brief, doc.trip.primaryTz);
  if (newPlaces.length > 0 && key !== "" && countries.length > 0) {
    try {
      const anchors = doc.places.flatMap((place) => (place.lat !== undefined && place.lng !== undefined ? [{ lat: place.lat, lng: place.lng }] : []));
      const found = await groundPlaces(
        newPlaces.map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}) })),
        { countries, kind: loaded.brief?.location.kind ?? "region", lookup: geoapifyLookup(key), anchors },
      );
      doc = {
        ...doc,
        places: doc.places.map((place) => {
          const hit = found.find((result) => result.ref === place.ref);
          return hit?.status === "found" ? withCoordinates(place, hit.hit, { openingHours: true }) : place;
        }),
      };
    } catch {
      // bez współrzędnych — „Uzupełnij współrzędne” albo przypięcie ręczne dokończą
    }
  }
  const checked = TripDocument.safeParse(doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };
  try {
    await saveMergeEdit(loaded.supabase, tripId, patchDiff(loaded.doc, checked.data), refIndex(loaded.payload.tables));
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
  }
  await loaded.supabase.from("ai_runs").update({ status: "accepted" }).eq("id", runId);
  refresh();
  const skipped = applied.results.filter((result) => !result.ok).length;
  return { ok: `Zastosowano ${applied.results.length - skipped} zmian${skipped > 0 ? `, pominięto ${skipped}` : ""}.` };
}

export async function rejectPatch(tripId: string, runId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/tune`);
  const { error } = await supabase.from("ai_runs").update({ status: "rejected" }).eq("id", runId).eq("trip_id", tripId);
  if (error) return { error: message(error) };
  refresh();
  return { ok: "Odrzucono." };
}

export type TuneResults = OpResult[];
