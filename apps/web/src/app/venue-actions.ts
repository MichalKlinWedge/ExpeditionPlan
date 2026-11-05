"use server";

import { applyVenueDraft, editVenuePoint, editVenuePrice, removeVenue, removeVenueRating, TripDocument, VENUE_FIELD, VENUE_POINT_LIMIT, VenueDraft, type VenueDraftRow, venueDraftRows, venuePoints, VenuePrice } from "@expeditionplan/core";
import { readVenueText, VENUE_TEXT_LIMIT } from "@expeditionplan/planner";
import { refIndex, saveElements, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Lokal na stronie „Posiłki”: dane z tekstu, który wkleił użytkownik. Strony ani ocen nie pobieramy
 * (`core/venue-info.ts`). O prawie do zapisu decyduje RLS (organizator, edytor).
 */

export type VenueReadState = FormState & { draft?: VenueDraft; rows?: VenueDraftRow[] };

const FIELDS = z.array(z.string().regex(VENUE_FIELD)).max(30);
const GONE = "Tego już nie ma albo taki punkt już jest — odśwież stronę.";

async function loadTrip(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/meals`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  return { supabase, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables) };
}

/** Czyta wklejony tekst i zwraca szkic do podglądu; nic jeszcze nie zapisuje. */
export async function readVenue(tripId: string, placeRef: string, text: string): Promise<VenueReadState> {
  const pasted = text.trim();
  if (pasted === "") return { error: "Wklej tekst ze strony lokalu." };
  if (pasted.length > VENUE_TEXT_LIMIT) return { error: `Tekst jest za długi: wklej najwyżej ${VENUE_TEXT_LIMIT.toLocaleString("pl-PL")} znaków, bez komentarzy gości.` };
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const place = loaded.doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  try {
    const draft = await readVenueText(gemini.client, place.name, pasted, { known: venuePoints(place.venue), timeoutMs: 60_000 });
    if (draft === null) return { error: "W tym tekście nie ma danych lokalu." };
    const rows = venueDraftRows(place, draft);
    if (rows.length === 0) return { ok: "W tekście nie ma nic nowego względem tego, co już jest zapisane." };
    return { draft, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function save(tripId: string, edit: ReturnType<typeof removeVenue>, loaded: Exclude<Awaited<ReturnType<typeof loadTrip>>, { error: string }>, ok: string): Promise<FormState> {
  if (edit === null) return { error: GONE };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
  }
  try {
    await saveElements(loaded.supabase, tripId, checked.data, edit.writes, loaded.ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok };
}

/** Dopisuje wiersze zaznaczone w podglądzie. */
export async function saveVenue(tripId: string, placeRef: string, input: VenueDraft, fields: string[]): Promise<FormState> {
  const draft = VenueDraft.safeParse(input);
  const picked = FIELDS.safeParse(fields);
  if (!draft.success || !picked.success) return { error: "Niepoprawne dane lokalu." };
  if (picked.data.length === 0) return { error: "Zaznacz, co zapisać." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  return save(tripId, applyVenueDraft(loaded.doc, placeRef, draft.data, picked.data, new Date().toISOString().slice(0, 10)), loaded, "Dopisano zaznaczone.");
}

/** Punkt opisu: `old === null` dodaje nowy, `next === null` usuwa. */
export async function saveVenuePoint(tripId: string, placeRef: string, old: string | null, next: string | null): Promise<FormState> {
  if (next !== null && next.trim().length > VENUE_POINT_LIMIT) return { error: `Punkt może mieć najwyżej ${VENUE_POINT_LIMIT} znaków.` };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  return save(tripId, editVenuePoint(loaded.doc, placeRef, old, next), loaded, "Zapisano.");
}

/** Przykładowa cena: `oldName === null` dodaje nową, `next === null` usuwa. */
export async function saveVenuePrice(tripId: string, placeRef: string, oldName: string | null, next: VenuePrice | null): Promise<FormState> {
  const price = next === null ? null : VenuePrice.safeParse(next);
  if (price !== null && !price.success) return { error: "Niepoprawna cena." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  return save(tripId, editVenuePrice(loaded.doc, placeRef, oldName, price === null ? null : price.data), loaded, "Zapisano.");
}

/** Usuwa ocenę. */
export async function dropVenueRating(tripId: string, placeRef: string): Promise<FormState> {
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  return save(tripId, removeVenueRating(loaded.doc, placeRef), loaded, "Usunięto ocenę.");
}

/** Usuwa punkty, ceny i ocenę lokalu. */
export async function clearVenue(tripId: string, placeRef: string): Promise<FormState> {
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  return save(tripId, removeVenue(loaded.doc, placeRef), loaded, "Usunięto dane lokalu.");
}
