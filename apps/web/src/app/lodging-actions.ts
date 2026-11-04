"use server";

import { applyLodgingDraft, LodgingDraft, type LodgingDraftRow, lodgingDraftRows, setLodgingLink, TripDocument } from "@expeditionplan/core";
import { LODGING_TEXT_LIMIT, readLodgingText } from "@expeditionplan/planner";
import { type ElementWrite, refIndex, saveElements, savePlanEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, geminiClient } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Obiekt noclegu na karcie punktu: link do jego strony i dane z tekstu, który wkleił użytkownik.
 * Strony nie pobieramy (`core/lodging-info.ts`). O prawie do zapisu decyduje RLS (organizator, edytor).
 */

export type LodgingReadState = FormState & { draft?: LodgingDraft; rows?: LodgingDraftRow[] };

const FIELDS = z.array(z.enum(["description", "address", "checkInFrom", "checkOutUntil", "breakfast", "beds", "rooms", "amenities", "confirmationCode", "contact"]));

async function loadTrip(tripId: string, itemRef: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  return { supabase, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables) };
}

const problem = (error: z.ZodError) => {
  const issue = error.issues[0]!;
  return `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}`;
};

/** Czyta wklejony tekst i zwraca szkic do podglądu; nic jeszcze nie zapisuje. */
export async function readLodging(tripId: string, itemRef: string, text: string): Promise<LodgingReadState> {
  const pasted = text.trim();
  if (pasted === "") return { error: "Wklej tekst ze strony obiektu albo z potwierdzenia rezerwacji." };
  if (pasted.length > LODGING_TEXT_LIMIT) return { error: `Tekst jest za długi: wklej najwyżej ${LODGING_TEXT_LIMIT.toLocaleString("pl-PL")} znaków, bez komentarzy gości.` };
  const denied = await aiAccessError();
  if (denied !== null) return { error: denied };
  const gemini = geminiClient();
  if (gemini === null) return { error: "Brak klucza GEMINI_API_KEY." };
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  try {
    const draft = await readLodgingText(gemini.client, pasted, { timeoutMs: 60_000 });
    if (draft === null) return { error: "W tym tekście nie ma danych noclegu." };
    const rows = lodgingDraftRows(loaded.doc, item, draft);
    if (rows.length === 0) return { ok: "W tekście nie ma nic nowego względem planu." };
    return { draft, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Zapisuje pola zaznaczone w podglądzie. */
export async function saveLodging(tripId: string, itemRef: string, input: LodgingDraft, fields: string[]): Promise<FormState> {
  const draft = LodgingDraft.safeParse(input);
  const picked = FIELDS.safeParse(fields);
  if (!draft.success || !picked.success) return { error: "Niepoprawne dane noclegu." };
  if (picked.data.length === 0) return { error: "Zaznacz, co zapisać." };
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const edit = applyLodgingDraft(loaded.doc, itemRef, draft.data, picked.data, { bookingId: uuidv7(), contactId: uuidv7() });
  if (edit === null) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: problem(checked.error) };
  const item = checked.data.items.find((each) => each.ref === itemRef)!;
  try {
    const ids = await saveElements(loaded.supabase, tripId, checked.data, edit.writes as ElementWrite[], loaded.ids);
    await savePlanEdit(loaded.supabase, tripId, { doc: checked.data, changed: [item] }, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Zapisano dane obiektu." };
}

const LinkUrl = z.url().regex(/^https?:\/\//i, "Link musi zaczynać się od https://.").max(500);

/** Link do strony obiektu; pusty usuwa. */
export async function saveLodgingLink(tripId: string, itemRef: string, url: string): Promise<FormState> {
  const address = url.trim();
  const parsed = address === "" ? null : LinkUrl.safeParse(address);
  if (parsed !== null && !parsed.success) return { error: "Link musi zaczynać się od https://." };
  const loaded = await loadTrip(tripId, itemRef);
  if ("error" in loaded) return { error: loaded.error };
  const edit = setLodgingLink(loaded.doc, itemRef, parsed === null ? null : parsed.data);
  if (edit === null) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: problem(checked.error) };
  try {
    await savePlanEdit(loaded.supabase, tripId, { doc: checked.data, changed: [checked.data.items.find((each) => each.ref === itemRef)!] }, loaded.ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: parsed === null ? "Usunięto link." : "Zapisano link." };
}
