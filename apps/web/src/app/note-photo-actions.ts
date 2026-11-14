"use server";

import { addNotePhoto, GUIDE_PHOTO_BUCKET, guidePhotoPath, MAX_NOTE_PHOTOS, moveNotePhoto, notePhotoPath, removeNotePhoto, setNotePhotoCaption, TripDocument } from "@expeditionplan/core";
import { refIndex, savePlanEdit, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Zdjęcia przy uwagach punktu (`core/note-photos.ts`). Plik wgrywa przeglądarka do `guide_photos/<wyjazd>/<id>.jpg`
 * (polityki bucketu: organizator i edytor), tu trafia do punktu; usunięte zdjęcie kasuje też plik.
 * O prawie do zmiany punktu decyduje RLS.
 */

type Edit = { doc: TripDocument; item: TripDocument["items"][number] } | null;

async function changeItem(tripId: string, itemRef: string, change: (doc: TripDocument) => Edit, unchanged: string): Promise<FormState & { supabase?: Awaited<ReturnType<typeof requireUser>>["supabase"] }> {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  if (!doc.items.some((each) => each.ref === itemRef)) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const edit = change(doc);
  if (edit === null) return { error: unchanged };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  try {
    await savePlanEdit(supabase, tripId, { doc: checked.data, changed: [checked.data.items.find((each) => each.ref === itemRef)!] }, refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: "Zapisano.", supabase };
}

/** Plik już w bucketcie trafia na koniec zdjęć uwag; bez zapisu w punkcie plik jest kasowany. Autor bez wpisu = osoba wgrywająca. */
export async function addItemNotePhoto(tripId: string, itemRef: string, fileId: string, fields: { caption: string; author: string }): Promise<FormState> {
  const { supabase, userId } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return { error: "Nieznany plik zdjęcia." };
  const path = guidePhotoPath(tripId, fileId);
  let author = fields.author.trim().slice(0, 80);
  if (author === "") {
    const { data } = await supabase.from("travelers").select("name").eq("trip_id", tripId).eq("user_id", userId).is("deleted_at", null).limit(1).maybeSingle();
    author = data?.name ?? "";
  }
  const url = supabase.storage.from(GUIDE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  const result = await changeItem(tripId, itemRef, (doc) => addNotePhoto(doc, itemRef, { url, caption: fields.caption.slice(0, 200), author }), `Przy uwagach jest już ${MAX_NOTE_PHOTOS} zdjęć: usuń któreś.`);
  if (result.error) {
    await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove([path]);
    return { error: result.error };
  }
  refresh();
  return { ok: "Dodano zdjęcie." };
}

/** Usuwa zdjęcie z uwag i jego plik. */
export async function removeItemNotePhoto(tripId: string, itemRef: string, url: string): Promise<FormState> {
  const result = await changeItem(tripId, itemRef, (doc) => removeNotePhoto(doc, itemRef, url), "Tego zdjęcia już nie ma — odśwież stronę.");
  if (result.error) return { error: result.error };
  const path = notePhotoPath(url);
  if (path !== null && path.startsWith(`${tripId}/`)) await result.supabase!.storage.from(GUIDE_PHOTO_BUCKET).remove([path]);
  refresh();
  return { ok: "Usunięto zdjęcie." };
}

export async function captionItemNotePhoto(tripId: string, itemRef: string, url: string, caption: string): Promise<FormState> {
  const result = await changeItem(tripId, itemRef, (doc) => setNotePhotoCaption(doc, itemRef, url, caption.slice(0, 200)), "Podpis się nie zmienił.");
  if (result.error) return { error: result.error };
  refresh();
  return { ok: "Zapisano podpis." };
}

export async function moveItemNotePhoto(tripId: string, itemRef: string, url: string, by: -1 | 1): Promise<FormState> {
  if (by !== -1 && by !== 1) return { error: "Niepoprawny kierunek." };
  const result = await changeItem(tripId, itemRef, (doc) => moveNotePhoto(doc, itemRef, url, by), "Tego zdjęcia nie da się przesunąć.");
  if (result.error) return { error: result.error };
  refresh();
  return { ok: "Przesunięto zdjęcie." };
}
