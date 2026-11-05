"use server";

import { mergePlaces, removeUnusedPlace, TripDocument } from "@expeditionplan/core";
import { refIndex, saveElements, stableUuid, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/**
 * Strona „Miejsca”: nazwa, adres, scalanie duplikatów i usuwanie nieużywanych. Współrzędne zapisuje `pinPlace`, a szukanie
 * po nazwie `searchPlace` (`app/actions.ts`). O prawie do zapisu decyduje RLS (organizator, edytor).
 */

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);

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
  if (error) return { error: message(error) };
  if (data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: "Zapisano nazwę i adres." };
}

export async function removePlace(tripId: string, ref: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/places`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const edit = removeUnusedPlace(stateFromPayload(payload).doc, ref);
  if (edit === null) return { error: "Tego miejsca już nie ma albo coś z niego korzysta — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
  }
  try {
    await saveElements(supabase, tripId, checked.data, edit.writes, refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: "Usunięto." };
}

type GuideRow = { id: string; place_id: string | null; lang: string; audience: string; deleted_at: string | null } & Record<string, unknown>;

/**
 * Scala miejsca: `keepRef` zostaje, `dropRef` znika, a wszystko, co je wskazywało, przechodzi na `keepRef`.
 * Opis miejsca (`audio_guides`) nie należy do dokumentu: przechodzi, chyba że zostające miejsce ma już swój.
 * Nowy wiersz ma identyfikator wyliczany z miejsca, żeby późniejsze „Opisz” go nadpisało, a nie zdublowało.
 */
export async function mergePlace(tripId: string, keepRef: string, dropRef: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/places`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const edit = mergePlaces(stateFromPayload(payload).doc, keepRef, dropRef);
  if (edit === null) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
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
      if (moved.error) return { error: `Miejsca scalone, ale opis miejsca nie przeszedł: ${message(moved.error)}` };
    }
    const gone = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", row.id).eq("trip_id", tripId);
    if (gone.error) return { error: `Miejsca scalone, ale opis miejsca nie przeszedł: ${message(gone.error)}` };
  }
  refresh();
  return { ok: "Scalono." };
}
