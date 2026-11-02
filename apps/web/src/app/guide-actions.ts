"use server";

import { GUIDE_LICENSE, type GuideRow, guideFor, guideText, type TripDocument } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { describePlace } from "@expeditionplan/planner";
import { refIndex, stableUuid, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

/**
 * Przewodnik po punkcie (M8, etap 1): artykuł z Wikipedii dla miejsca punktu, streszczenie przez
 * AI tylko z jego tekstu i zdjęcia z Commons, zapis w `audio_guides` (jeden na miejsce; punkt bez
 * miejsca — na punkt). Przygotowuje organizator albo edytor (RLS), AI tylko dla `AI_ALLOWED_EMAILS`.
 */

type Doc = TripDocument;
type Item = Doc["items"][number];
type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);

/** Rodzaje punktów, dla których opis ma sens przy opisach hurtem. */
const SIGHTS = new Set(["visit", "activity"]);
/** Ile opisów najwyżej na jedno kliknięcie „hurtem” (każdy ok. 5–15 s, limit akcji 300 s). */
const BATCH = 12;

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const denied = await aiAccessError();
  if (denied) return { error: denied } as const;
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` } as const;
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) } as const;
  if (data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const guides = ((payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? []) as GuideRow[];
  return { supabase, client: setup.deps.client, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables), guides } as const;
}

const placeOf = (doc: Doc, item: Item) => {
  const ref = item.leg?.toPlaceRef ?? item.placeRef;
  return { ref, place: ref === undefined ? undefined : doc.places.find((each) => each.ref === ref) };
};

/** Jeden opis: `null` = gotowy, inaczej powód (brak artykułu, błąd). */
async function describeOne(supabase: Supabase, client: Parameters<typeof describePlace>[1]["client"], tripId: string, doc: Doc, ids: Record<string, string>, item: Item): Promise<{ ok: string } | { error: string }> {
  const { ref: placeRef, place } = placeOf(doc, item);
  const name = place?.name ?? item.title;
  let content;
  try {
    content = await describePlace({ name, kind: item.kind, lat: place?.lat, lng: place?.lng }, { client, timeoutMs: 60_000 });
  } catch (e) {
    return { error: `Nie udało się przygotować opisu „${name}”: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (content === null) return { error: `Nie znalazłem w Wikipedii artykułu, który na pewno dotyczy „${name}”. Opis bez źródła byłby zgadywaniem — pomijam.` };
  const itemId = ids[item.ref];
  const placeId = placeRef === undefined ? undefined : ids[placeRef];
  const { error } = await supabase.from("audio_guides").upsert({
    id: stableUuid("guide", tripId, placeId ?? itemId ?? item.ref, "adult", "pl"),
    trip_id: tripId,
    item_id: itemId ?? null,
    place_id: placeId ?? null,
    lang: "pl",
    audience: "adult",
    title: name,
    text: guideText(content),
    content: content as unknown as NonNullable<Json>,
    sources: [{ title: `Wikipedia: ${content.article.title}`, url: content.article.url }] as unknown as NonNullable<Json>,
    license: GUIDE_LICENSE,
    status: "ready",
    deleted_at: null,
  });
  if (error) return { error: message(error) };
  return { ok: `Opis gotowy (z artykułu „${content.article.title}”, ${content.images.length} zdj.).` };
}

export async function describeItem(tripId: string, itemRef: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const result = await describeOne(loaded.supabase, loaded.client, tripId, loaded.doc, loaded.ids, item);
  if ("ok" in result) refresh();
  return result;
}

/**
 * Opisy hurtem: zwiedzanie i aktywności z dniem, które nie mają jeszcze opisu (miejsce opisane
 * raz wystarcza dla wszystkich punktów w nim). Po kolei — Wikipedia nie lubi serii równoległych.
 */
export async function describeTrip(tripId: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc, ids } = loaded;
  const seen = new Set<string>();
  const todo = doc.items.filter((item) => {
    if (!SIGHTS.has(item.kind) || item.dayRef === undefined || item.planStatus !== "scheduled") return false;
    const { ref } = placeOf(doc, item);
    const key = ref ?? item.ref;
    if (seen.has(key)) return false;
    seen.add(key);
    return guideFor(loaded.guides, ids[item.ref], ref === undefined ? undefined : ids[ref]) === null;
  });
  if (todo.length === 0) return { ok: "Wszystkie atrakcje mają już opisy." };
  let done = 0;
  const missing: string[] = [];
  for (const item of todo.slice(0, BATCH)) {
    const result = await describeOne(loaded.supabase, loaded.client, tripId, doc, ids, item);
    if ("ok" in result) done++;
    else missing.push(placeOf(doc, item).place?.name ?? item.title);
  }
  refresh();
  const more = todo.length > BATCH ? ` Zostało jeszcze ${todo.length - BATCH} — kliknij ponownie.` : "";
  return { ok: `Opisy: ${done} gotowe${missing.length > 0 ? `, bez artykułu w Wikipedii: ${missing.join(", ")}` : ""}.${more}` };
}

/** Usunięcie opisu (miękkie) — np. gdy artykuł okazał się o czymś innym. */
export async function removeGuide(tripId: string, guideId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { error } = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", guideId).eq("trip_id", tripId);
  if (error) return { error: message(error) };
  refresh();
  return { ok: "Usunięto opis." };
}
