"use server";

import { type GuideRow, mergePlaces, removeUnusedPlace, TripDocument } from "@expeditionplan/core";
import { dbErrorMessage, refIndex, saveElements, stableUuid, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Strona „Miejsca”: nazwa, adres, scalanie duplikatów i usuwanie nieużywanych. Współrzędne zapisuje `pinPlace`, a szukanie
 * po nazwie `searchPlace` (`app/actions.ts`). O prawie do zapisu decyduje RLS (organizator, edytor).
 */

const Details = z.object({
  name: z.string().trim().min(1, "Miejsce musi mieć nazwę.").max(200, "Nazwa jest za długa."),
  address: z.string().trim().max(300, "Adres jest za długi."),
});

export async function savePlaceDetails(tripId: string, placeId: string, fields: z.input<typeof Details>): Promise<FormState> {
  const parsed = Details.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane miejsca." };
  const { supabase } = await requireUser(`/trips/${tripId}/places`);
  const { data, error } = await supabase
    .from("places")
    .update({ name: parsed.data.name, address: parsed.data.address === "" ? null : parsed.data.address })
    .eq("id", placeId)
    .eq("trip_id", tripId)
    .select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: "Zapisano nazwę i adres." };
}

export async function removePlace(tripId: string, ref: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/places`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const edit = removeUnusedPlace(stateFromPayload(payload).doc, ref);
  if (edit === null) return { error: "Tego miejsca już nie ma albo coś z niego korzysta — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  try {
    await saveElements(supabase, tripId, checked.data, edit.writes, refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // Opis należy do miejsca: bez tego zostałby przy usuniętym miejscu, poza listą.
  const placeId = refIndex(payload.tables)[ref];
  if (placeId !== undefined) {
    const gone = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("trip_id", tripId).eq("place_id", placeId).is("deleted_at", null);
    if (gone.error) return { error: `Miejsce usunięte, ale jego opis nie: ${dbErrorMessage(gone.error)}` };
  }
  refresh();
  return { ok: "Usunięto." };
}

/**
 * Scala miejsca: `keepRef` zostaje, `dropRef` znika, a wszystko, co je wskazywało, przechodzi na `keepRef`.
 * Opis miejsca (`audio_guides`) nie należy do dokumentu: przechodzi, chyba że zostające miejsce ma już swój.
 * Nowy wiersz ma identyfikator wyliczany z miejsca, żeby późniejsze „Opisz” go nadpisało, a nie zdublowało.
 */
export async function mergePlace(tripId: string, keepRef: string, dropRef: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/places`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const edit = mergePlaces(stateFromPayload(payload).doc, keepRef, dropRef);
  if (edit === null) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  const ids = refIndex(payload.tables);
  const [keepId, dropId] = [ids[keepRef], ids[dropRef]];
  if (keepId === undefined || dropId === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  try {
    await saveElements(supabase, tripId, checked.data, edit.writes, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const guides = (((payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? []) as GuideRow[]).filter((row) => row.deleted_at === null);
  for (const row of guides.filter((each) => each.place_id === dropId)) {
    if (!guides.some((each) => each.place_id === keepId && each.lang === row.lang && each.audience === row.audience)) {
      const copy: Record<string, unknown> = { ...row, id: stableUuid("guide", tripId, keepId, row.audience, row.lang), place_id: keepId, deleted_at: null };
      delete copy.row_version;
      const moved = await supabase.from("audio_guides").upsert(copy as never);
      if (moved.error) return { error: `Miejsca scalone, ale opis miejsca nie przeszedł: ${dbErrorMessage(moved.error)}` };
    }
    const gone = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", row.id).eq("trip_id", tripId);
    if (gone.error) return { error: `Miejsca scalone, ale opis miejsca nie przeszedł: ${dbErrorMessage(gone.error)}` };
  }
  refresh();
  return { ok: "Scalono." };
}
