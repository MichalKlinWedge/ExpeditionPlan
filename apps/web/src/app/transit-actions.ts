"use server";

import { applyTransitDraft, applyTransitShape, isTransitItem, TRANSIT_FIELDS, TransitDraft, type TransitDraftRow, transitDraftRows, transitShapeRequest, TripDocument } from "@expeditionplan/core";
import { bboxAround, fetchOsmRoutes, OVERPASS_URL, readTransitText, TRANSIT_TEXT_LIMIT } from "@expeditionplan/planner";
import { refIndex, savePlanEdit, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Przejazd komunikacją na karcie punktu: linie, przesiadki, czas i odjazdy z tekstu, który wkleił
 * użytkownik (Google Maps, Jakdojade, strona przewoźnika). Niczego nie pobieramy (`core/transit-info.ts`).
 * O prawie do zapisu decyduje RLS (organizator, edytor).
 */

export type TransitReadState = FormState & { draft?: TransitDraft; rows?: TransitDraftRow[] };

const FIELDS = z.array(z.enum(TRANSIT_FIELDS));

/**
 * Linia przejazdu z OpenStreetMap (Overpass, serwer FOSSGIS). Jego warunki wymagają e-maila operatora
 * na stronie (`CONTACT_EMAIL`, pokazywany w „Pomocy”), więc bez niego nie pytamy. `null` = nie ma czego rysować.
 */
async function osmLine(doc: TripDocument, itemRef: string): Promise<{ doc: TripDocument; note: string } | { error: string } | null> {
  const item = doc.items.find((each) => each.ref === itemRef);
  const request = item === undefined ? null : transitShapeRequest(doc, item);
  if (request === null) return null;
  if (!process.env.CONTACT_EMAIL) return { error: "Linii z OpenStreetMap nie pobrano: serwer nie ma ustawionego CONTACT_EMAIL (warunek serwera Overpass)." };
  try {
    const routes = await fetchOsmRoutes(request.refs, bboxAround([request.start, request.end]), { url: process.env.OVERPASS_URL || OVERPASS_URL });
    const drawn = applyTransitShape(doc, itemRef, routes)!;
    if (drawn.shape === null) return { doc: drawn.doc, note: "OpenStreetMap nie ma tych linii albo przystanków, więc mapa łączy miejsca prostą." };
    const { matched, total } = drawn.shape;
    return { doc: drawn.doc, note: matched === total ? "Linia z OpenStreetMap jest na mapie dnia." : `Na mapie dnia jest linia z OpenStreetMap dla ${matched} z ${total} odcinków, resztę łączy prosta.` };
  } catch (e) {
    return { error: `Linii z OpenStreetMap nie pobrano: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function loadTrip(tripId: string, itemRef: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  return { supabase, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables) };
}

/** Czyta wklejony tekst i zwraca szkic do podglądu; nic jeszcze nie zapisuje. */
export async function readTransit(tripId: string, itemRef: string, text: string): Promise<TransitReadState> {
  const pasted = text.trim();
  if (pasted === "") return { error: "Wklej opis połączenia z wyszukiwarki albo ze strony przewoźnika." };
  if (pasted.length > TRANSIT_TEXT_LIMIT) return { error: `Tekst jest za długi: wklej najwyżej ${TRANSIT_TEXT_LIMIT.toLocaleString("pl-PL")} znaków, samo połączenie.` };
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  if (!isTransitItem(item)) return { error: "Ten punkt nie jest przejazdem komunikacją publiczną." };
  const name = (ref: string | undefined) => loaded.doc.places.find((each) => each.ref === ref)?.name;
  const from = name(item.leg?.fromPlaceRef);
  const to = name(item.leg?.toPlaceRef ?? item.placeRef);
  try {
    const draft = await readTransitText(gemini.client, pasted, { title: item.title, ...(from ? { from } : {}), ...(to ? { to } : {}) }, { timeoutMs: 60_000 });
    if (draft === null) return { error: "W tym tekście nie ma połączenia komunikacją." };
    const rows = transitDraftRows(item, draft);
    if (rows.length === 0) return { ok: "W tekście nie ma nic nowego względem planu." };
    return { draft, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Zapisuje pola zaznaczone w podglądzie. Punkt dostaje blokadę przed AI, jak każda ręczna zmiana. */
export async function saveTransit(tripId: string, itemRef: string, input: TransitDraft, fields: string[]): Promise<FormState> {
  const draft = TransitDraft.safeParse(input);
  const picked = FIELDS.safeParse(fields);
  if (!draft.success || !picked.success) return { error: "Niepoprawne dane przejazdu." };
  if (picked.data.length === 0) return { error: "Zaznacz, co zapisać." };
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const edit = applyTransitDraft(loaded.doc, itemRef, draft.data, picked.data);
  if (edit === null) return { error: "Tego punktu już nie ma albo nie jest przejazdem komunikacją — odśwież stronę." };
  // Nowe odcinki: od razu linia z OpenStreetMap; jej brak nie blokuje zapisu.
  const line = picked.data.includes("segments") ? await osmLine(edit.doc, itemRef) : null;
  const checked = TripDocument.safeParse(line !== null && "doc" in line ? line.doc : edit.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await savePlanEdit(loaded.supabase, tripId, { doc: checked.data, changed: [checked.data.items.find((each) => each.ref === itemRef)!] }, loaded.ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  if (line !== null && "error" in line) return { ok: "Zapisano przejazd.", error: line.error };
  return { ok: line === null ? "Zapisano przejazd." : `Zapisano przejazd. ${line.note}` };
}

/** Linia na mapie dnia dla zapisanych odcinków (np. z importu planu albo po zmianie „skąd” i „dokąd”). */
export async function drawTransit(tripId: string, itemRef: string): Promise<FormState> {
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const line = await osmLine(loaded.doc, itemRef);
  if (line === null) return { error: "Przejazd nie ma odcinków z numerem linii albo jego start i cel nie są na mapie." };
  if ("error" in line) return { error: line.error };
  const checked = TripDocument.safeParse(line.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await savePlanEdit(loaded.supabase, tripId, { doc: checked.data, changed: [checked.data.items.find((each) => each.ref === itemRef)!] }, loaded.ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: line.note };
}
