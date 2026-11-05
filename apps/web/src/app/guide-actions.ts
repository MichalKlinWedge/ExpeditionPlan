"use server";

import { type GuideContent, GUIDE_LICENSE, type GuideRow, guideFor, guideText, type TripDocument } from "@expeditionplan/core";
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

/** Środek miejsc ze współrzędnymi wśród punktów z danego obszaru puli (`area`); brak — `undefined`. */
function areaCenter(doc: Doc, area: string | undefined): { lat: number; lng: number } | undefined {
  if (area === undefined) return undefined;
  const points = doc.items
    .filter((each) => each.area === area)
    .map((each) => doc.places.find((place) => place.ref === (each.leg?.toPlaceRef ?? each.placeRef)))
    .filter((place) => place?.lat !== undefined && place.lng !== undefined) as { lat: number; lng: number }[];
  if (points.length === 0) return undefined;
  return { lat: points.reduce((sum, each) => sum + each.lat, 0) / points.length, lng: points.reduce((sum, each) => sum + each.lng, 0) / points.length };
}

/**
 * Jeden opis: `null` = gotowy, inaczej powód (brak artykułu, błąd). Ze wskazówką (`hint`) opis
 * dotyczy punktu, nie miejsca („Autostradą A7” — opłaty na A7, nie parking na końcu): tytuł z punktu,
 * zapis tylko z `item_id`, więc nie zasłania opisu miejsca w innych punktach.
 */
async function describeOne(supabase: Supabase, client: Parameters<typeof describePlace>[1]["client"], tripId: string, doc: Doc, ids: Record<string, string>, item: Item, hint?: string): Promise<{ ok: string } | { error: string }> {
  const { ref: found, place } = placeOf(doc, item);
  const placeRef = hint ? undefined : found;
  const name = hint ? item.title : (place?.name ?? item.title);
  // Okolica dla miejsc bez współrzędnych: baza dnia (nocleg), a gdy jej brak (punkt z puli) — środek
  // miejsc innych punktów z tego samego obszaru puli („Essaouira”).
  const day = doc.days.find((each) => each.ref === item.dayRef);
  const base = day?.baseRef === undefined ? undefined : doc.places.find((each) => each.ref === day.baseRef);
  const near = base?.lat !== undefined && base.lng !== undefined ? { lat: base.lat, lng: base.lng } : areaCenter(doc, item.area);
  let content;
  try {
    content = await describePlace(
      {
        name,
        kind: item.kind,
        lat: place?.lat,
        lng: place?.lng,
        near,
        context: { itemTitle: item.title, description: item.description, area: base?.name ?? item.area, trip: doc.trip.title },
        ...(hint ? { hint } : {}),
      },
      { client, timeoutMs: 60_000 },
    );
  } catch (e) {
    return { error: `Nie udało się przygotować opisu „${name}”: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (content === null) {
    return {
      error: hint
        ? `Nie znalazłem w Wikipedii ani Wikivoyage artykułu o „${hint}”. Spróbuj nazwać temat inaczej (np. nazwa drogi albo obiektu, „jazda autem w Maroku”).`
        : `Nie znalazłem w Wikipedii ani Wikivoyage artykułu, który na pewno dotyczy „${name}”. Opis bez źródła byłby zgadywaniem — pomijam. Możesz podpowiedzieć AI, o czym ma być opis.`,
    };
  }
  return storeGuide(supabase, tripId, name, content, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef], item.ref);
}

/** Zapis opisu: jeden na miejsce, a bez miejsca na punkt. */
async function storeGuide(supabase: Supabase, tripId: string, name: string, content: GuideContent, itemId: string | undefined, placeId: string | undefined, fallbackKey: string): Promise<{ ok: string } | { error: string }> {
  const { error } = await supabase.from("audio_guides").upsert({
    id: stableUuid("guide", tripId, placeId ?? itemId ?? fallbackKey, "adult", "pl"),
    trip_id: tripId,
    item_id: itemId ?? null,
    place_id: placeId ?? null,
    lang: "pl",
    audience: "adult",
    title: name,
    text: guideText(content),
    content: content as unknown as NonNullable<Json>,
    sources: [{ title: `${content.article.site === "wikivoyage" ? "Wikivoyage" : "Wikipedia"}: ${content.article.title}`, url: content.article.url }] as unknown as NonNullable<Json>,
    license: GUIDE_LICENSE,
    status: "ready",
    deleted_at: null,
  });
  if (error) return { error: message(error) };
  return { ok: `Opis gotowy (z artykułu „${content.article.title}” — ${content.article.site === "wikivoyage" ? "Wikivoyage" : "Wikipedia"}, ${content.images.length} zdj.).` };
}

/** `hint` — wskazówka organizatora dla AI („opłaty i bramki na A7, czym płacić”); pusta = opis miejsca. */
export async function describeItem(tripId: string, itemRef: string, hint = ""): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const clean = hint.trim().slice(0, 300);
  const result = await describeOne(loaded.supabase, loaded.client, tripId, loaded.doc, loaded.ids, item, clean || undefined);
  // Opis miejsca bez wskazówki: własny opis punktu (dawniej ze wskazówką) by go zasłaniał — znika (miękko).
  const itemId = loaded.ids[item.ref];
  const own = loaded.guides.find((row) => !row.deleted_at && row.item_id === itemId && row.place_id === null);
  if ("ok" in result && clean === "" && own !== undefined && placeOf(loaded.doc, item).ref !== undefined) {
    await loaded.supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", own.id).eq("trip_id", tripId);
  }
  if ("ok" in result) refresh();
  return result;
}

/** Opis miejsca ze strony „Miejsca”: z punktu, który tam prowadzi, a miejsce bez punktów (baza, rezerwacja) opisuje samo siebie. */
export async function describePlaceGuide(tripId: string, placeRef: string): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc, ids, supabase, client } = loaded;
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  const item = doc.items.find((each) => placeOf(doc, each).ref === placeRef && each.kind !== "lodging");
  let result: FormState;
  if (item !== undefined) {
    result = await describeOne(supabase, client, tripId, doc, ids, item);
  } else {
    try {
      const content = await describePlace({ name: place.name, kind: "visit", lat: place.lat, lng: place.lng, context: { itemTitle: place.name, trip: doc.trip.title } }, { client, timeoutMs: 60_000 });
      result = content === null
        ? { error: `Nie znalazłem w Wikipedii ani Wikivoyage artykułu, który na pewno dotyczy „${place.name}”. Opis bez źródła byłby zgadywaniem — pomijam.` }
        : await storeGuide(supabase, tripId, place.name, content, undefined, ids[placeRef], placeRef);
    } catch (e) {
      result = { error: `Nie udało się przygotować opisu „${place.name}”: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
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
  return { ok: `Opisy: ${done} gotowe${missing.length > 0 ? `, bez pewnego artykułu: ${missing.join(", ")}` : ""}.${more}` };
}

/** Usunięcie opisu (miękkie) — np. gdy artykuł okazał się o czymś innym. */
export async function removeGuide(tripId: string, guideId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { error } = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", guideId).eq("trip_id", tripId);
  if (error) return { error: message(error) };
  refresh();
  return { ok: "Usunięto opis." };
}
