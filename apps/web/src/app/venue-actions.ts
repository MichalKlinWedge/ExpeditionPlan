"use server";

import { applyVenueDraft, editVenuePoint, editVenuePrice, removeVenue, removeVenueRating, TripDocument, VENUE_FIELD, VENUE_POINT_LIMIT, VenueDraft, type VenueDraftRow, venueDraftRows, venuePoints, VenuePrice } from "@expeditionplan/core";
import { readVenueText, VENUE_TEXT_LIMIT } from "@expeditionplan/planner";
import { refIndex, saveElements, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";
import { fetchVenueSiteText, VenueSiteError } from "@/lib/venue-site";

/**
 * Lokal na stronie „Posiłki”: dane z tekstu, który wkleił użytkownik, albo ze strony samego lokalu, pobranej na jego kliknięcie
 * (`lib/venue-site.ts`). Serwisów z ocenami nie czytamy (`core/venue-info.ts`). O prawie do zapisu decyduje RLS (organizator, edytor).
 */

export type VenueReadState = FormState & { draft?: VenueDraft; rows?: VenueDraftRow[] };

const FIELDS = z.array(z.string().regex(VENUE_FIELD)).max(30);
const GONE = "Tego już nie ma albo taki punkt już jest — odśwież stronę.";

async function loadTrip(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/meals`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  return { supabase, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables) };
}

/** Czyta wklejony tekst i zwraca szkic do podglądu; nic jeszcze nie zapisuje. */
export async function readVenue(tripId: string, placeRef: string, text: string): Promise<VenueReadState> {
  const pasted = text.trim();
  if (pasted === "") return { error: "Wklej tekst ze strony knajpy." };
  if (pasted.length > VENUE_TEXT_LIMIT) return { error: `Tekst jest za długi: wklej najwyżej ${VENUE_TEXT_LIMIT.toLocaleString("pl-PL")} znaków, bez komentarzy gości.` };
  return draftFrom(tripId, placeRef, () => pasted, "pasted");
}

/** Pobiera stronę lokalu i jej menu, a potem działa jak wklejony tekst: szkic do podglądu, bez zapisu. */
export async function readVenueSite(tripId: string, placeRef: string): Promise<VenueReadState> {
  return draftFrom(
    tripId,
    placeRef,
    async (website) => {
      if (website === undefined) throw new VenueSiteError("Ta knajpa nie ma zapisanej strony.");
      return fetchVenueSiteText(website);
    },
    "site",
  );
}

async function draftFrom(tripId: string, placeRef: string, source: (website: string | undefined) => string | Promise<string>, kind: "pasted" | "site"): Promise<VenueReadState> {
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const loaded = await loadTrip(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const place = loaded.doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  try {
    const text = await source(place.website);
    const draft = await readVenueText(gemini.client, place.name, text, { known: venuePoints(place.venue), source: kind, timeoutMs: 60_000 });
    if (draft === null) return { error: kind === "site" ? "Na tej stronie nie ma danych knajpy." : "W tym tekście nie ma danych knajpy." };
    const rows = venueDraftRows(place, draft);
    if (rows.length === 0) return { ok: kind === "site" ? "Na stronie nie ma nic nowego względem tego, co już jest zapisane." : "W tekście nie ma nic nowego względem tego, co już jest zapisane." };
    return { draft, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function save(tripId: string, edit: ReturnType<typeof removeVenue>, loaded: Exclude<Awaited<ReturnType<typeof loadTrip>>, { error: string }>, ok: string): Promise<FormState> {
  if (edit === null) return { error: GONE };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
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
  if (!draft.success || !picked.success) return { error: "Niepoprawne dane knajpy." };
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
  return save(tripId, removeVenue(loaded.doc, placeRef), loaded, "Usunięto dane knajpy.");
}
