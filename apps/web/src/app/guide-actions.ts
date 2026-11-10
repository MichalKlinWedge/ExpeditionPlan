"use server";

import { droppedGuidePhotos, editGuideText, GuideContent, GuideDraft, GuideImage, GUIDE_LICENSE, GUIDE_PHOTO_BUCKET, guidePhotoPath, type GuideRow, guideFor, guideText, isWikimediaImage, MAX_GUIDE_IMAGES, moveGuideImage, ownGuideImage, putGuideImage, removeGuideImage, type TripDocument, undescribedSights } from "@expeditionplan/core";
import type { Json } from "@expeditionplan/db";
import { articleImages, commonsImages, coreName, describeFromPage, describePlace, type GuideLibrary, wikiArticleOf } from "@expeditionplan/planner";
import { dbErrorMessage, refIndex, stableUuid, stateFromPayload } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { aiAccessError, plannerDeps } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { pullTrip } from "@/lib/trip-snapshot";
import { fetchPageText, VenueSiteError } from "@/lib/venue-site";

/**
 * Przewodnik po punkcie (M8, etap 1): artykuł z Wikipedii dla miejsca punktu, streszczenie przez
 * AI tylko z jego tekstu i zdjęcia z Commons, zapis w `audio_guides` (jeden na miejsce; punkt bez
 * miejsca — na punkt). Przygotowuje organizator albo edytor (RLS), AI tylko dla `AI_ALLOWED_EMAILS`.
 */

type Doc = TripDocument;
type Item = Doc["items"][number];
type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** Ile opisów najwyżej na jedno kliknięcie „hurtem” (każdy ok. 5–15 s, limit akcji 300 s). */
const BATCH = 12;

async function load(tripId: string) {
  const { supabase } = await requireUser(`/trips/${tripId}/plan`);
  const denied = await aiAccessError();
  if (denied) return { error: denied } as const;
  const setup = plannerDeps();
  if ("missing" in setup) return { error: `Serwer nie ma kluczy: ${setup.missing.join(", ")}.` } as const;
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error } as const;
  const { payload } = pulled;
  const guides = ((payload.tables as unknown as { audio_guides?: GuideRow[] }).audio_guides ?? []) as GuideRow[];
  return { supabase, client: setup.deps.client, doc: stateFromPayload(payload).doc, ids: refIndex(payload.tables), guides } as const;
}

/** Wspólna biblioteka opisów. Błąd bazy to brak gotowego opisu, a brak prawa zapisu nie przeszkadza w opisie dla wyjazdu. */
function guideLibrary(supabase: Supabase): GuideLibrary {
  return {
    find: async ({ site, lang, title }) => {
      const { data } = await supabase.from("guide_library").select("content").eq("site", site).eq("lang", lang).eq("article_title", title).maybeSingle();
      const parsed = GuideContent.safeParse(data?.content);
      return parsed.success ? parsed.data : null;
    },
    save: async (content) => {
      await supabase.from("guide_library").upsert({
        site: content.article.site,
        lang: content.article.lang,
        article_title: content.article.title,
        content: content as unknown as NonNullable<Json>,
        updated_at: new Date().toISOString(),
      });
    },
  };
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
 * zapis tylko z `item_id`, więc nie zasłania opisu miejsca w innych punktach. `which` mówi, które to miejsce,
 * gdy wiele nosi tę nazwę: opis dalej należy do miejsca.
 */
async function describeOne(supabase: Supabase, client: Parameters<typeof describePlace>[1]["client"], tripId: string, doc: Doc, ids: Record<string, string>, item: Item, hint?: string, which?: string, fresh = false): Promise<{ ok: string } | { error: string }> {
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
        ...(hint ? { hint } : which ? { which } : {}),
      },
      { client, timeoutMs: 60_000, library: guideLibrary(supabase), fresh },
    );
  } catch (e) {
    return { error: `Nie udało się przygotować opisu „${name}”: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (content === null) {
    if (!hint && which) return notFoundWhich(name, which);
    return {
      error: hint
        ? `Nie znalazłem w Wikipedii ani Wikivoyage artykułu o „${hint}”. Spróbuj nazwać temat inaczej (np. nazwa drogi albo obiektu, „jazda autem w Maroku”).`
        : `Nie znalazłem w Wikipedii ani Wikivoyage artykułu, który na pewno dotyczy „${name}”. Opis bez źródła byłby zgadywaniem — pomijam. Możesz podpowiedzieć AI, o czym ma być opis, albo podać stronę o tym miejscu.`,
    };
  }
  return storeGuide(supabase, tripId, name, content, ids[item.ref], placeRef === undefined ? undefined : ids[placeRef], item.ref);
}

const notFoundWhich = (name: string, which: string) => ({ error: `Nie znalazłem w Wikipedii ani Wikivoyage artykułu o „${name}” (${which}). Spróbuj opisać to miejsce inaczej, np. gmina, powiat albo pełna nazwa, albo podaj stronę o nim.` });

/** Doprecyzowanie, z którym powstał obecny opis miejsca: odświeżenie nie może wrócić do imienniczki. */
function savedWhich(guides: GuideRow[], placeId: string | undefined): string | undefined {
  if (placeId === undefined) return undefined;
  const row = guides.find((each) => !each.deleted_at && each.place_id === placeId);
  return row === undefined ? undefined : GuideContent.safeParse(row.content).data?.hint;
}

const SOURCE_NAME = { wikipedia: "Wikipedia", wikivoyage: "Wikivoyage", web: "Strona" } as const;

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
    sources: [{ title: `${SOURCE_NAME[content.article.site]}: ${content.article.title}`, url: content.article.url }] as unknown as NonNullable<Json>,
    license: content.article.site === "web" ? null : GUIDE_LICENSE,
    status: "ready",
    deleted_at: null,
  });
  if (error) return { error: dbErrorMessage(error) };
  return { ok: `Opis gotowy (źródło: ${SOURCE_NAME[content.article.site]} „${content.article.title}” (${content.article.lang}), ${content.images.length} zdj.).` };
}

/** `hint` — wskazówka organizatora dla AI („opłaty i bramki na A7, czym płacić”); pusta = opis miejsca. */
export async function describeItem(tripId: string, itemRef: string, hint = ""): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const item = loaded.doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const clean = hint.trim().slice(0, 300);
  const placeRef = placeOf(loaded.doc, item).ref;
  const which = clean === "" && placeRef !== undefined ? savedWhich(loaded.guides, loaded.ids[placeRef]) : undefined;
  // Punkt z opisem to „Odśwież”: nowa wersja z AI, nie ta sama z biblioteki.
  const fresh = guideFor(loaded.guides, loaded.ids[item.ref], placeRef === undefined ? undefined : loaded.ids[placeRef]) !== null;
  const result = await describeOne(loaded.supabase, loaded.client, tripId, loaded.doc, loaded.ids, item, clean || undefined, which, fresh);
  // Opis miejsca bez wskazówki: własny opis punktu (dawniej ze wskazówką) by go zasłaniał — znika (miękko).
  const itemId = loaded.ids[item.ref];
  const own = loaded.guides.find((row) => !row.deleted_at && row.item_id === itemId && row.place_id === null);
  if ("ok" in result && clean === "" && own !== undefined && placeOf(loaded.doc, item).ref !== undefined) {
    const { error } = await loaded.supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", own.id).eq("trip_id", tripId);
    if (error) return { error: dbErrorMessage(error) };
  }
  if ("ok" in result) refresh();
  return result;
}

/**
 * Opis miejsca ze strony „Miejsca”: z punktu, który tam prowadzi, a miejsce bez punktów (baza, rezerwacja) opisuje samo siebie.
 * `which` — które dokładnie miejsce, gdy wiele nosi tę nazwę; puste = szukanie po nazwie i współrzędnych.
 */
export async function describePlaceGuide(tripId: string, placeRef: string, which = ""): Promise<FormState> {
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc, ids, supabase, client } = loaded;
  const place = doc.places.find((each) => each.ref === placeRef);
  if (place === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  const item = doc.items.find((each) => placeOf(doc, each).ref === placeRef && each.kind !== "lodging");
  const clean = which.trim().slice(0, 200);
  // Miejsce z własnym opisem to „Odśwież”: nowa wersja z AI, nie ta sama z biblioteki.
  const fresh = loaded.guides.some((row) => !row.deleted_at && row.place_id === ids[placeRef]);
  let result: FormState;
  if (item !== undefined) {
    result = await describeOne(supabase, client, tripId, doc, ids, item, undefined, clean || undefined, fresh);
  } else {
    try {
      const content = await describePlace({ name: place.name, kind: "visit", lat: place.lat, lng: place.lng, context: { itemTitle: place.name, trip: doc.trip.title }, ...(clean ? { which: clean } : {}) }, { client, timeoutMs: 60_000, library: guideLibrary(supabase), fresh });
      result = content === null
        ? clean
          ? notFoundWhich(place.name, clean)
          : { error: `Nie znalazłem w Wikipedii ani Wikivoyage artykułu, który na pewno dotyczy „${place.name}”. Opis bez źródła byłby zgadywaniem — pomijam. Możesz podać stronę o tym miejscu.` }
        : await storeGuide(supabase, tripId, place.name, content, undefined, ids[placeRef], placeRef);
    } catch (e) {
      result = { error: `Nie udało się przygotować opisu „${place.name}”: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if ("ok" in result) refresh();
  return result;
}

/**
 * Opis ze źródła wskazanego przez użytkownika, gdy automat nic nie znalazł: link do Wikipedii albo Wikivoyage, inna strona (pobrana na tych warunkach
 * co strona lokalu, `docs/USLUGI.md` §13) albo tekst wklejony z niej. Zapisujemy tylko streszczenie i link. Opis należy do miejsca, a bez miejsca do punktu.
 */
export async function describeFromSource(tripId: string, target: { itemRef?: string; placeRef?: string }, address: string, pasted = ""): Promise<FormState> {
  const url = address.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url) || !URL.canParse(url)) return { error: "Podaj pełny adres strony, od https://." };
  const loaded = await load(tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { doc, ids, supabase, client } = loaded;
  const item = target.itemRef === undefined ? undefined : doc.items.find((each) => each.ref === target.itemRef);
  const placeRef = target.placeRef ?? (item === undefined ? undefined : placeOf(doc, item).ref);
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  const name = place?.name ?? item?.title;
  if (name === undefined) return { error: "Tego miejsca już nie ma — odśwież stronę." };
  const typed = pasted.trim();
  let text = typed;
  if (typed === "" && wikiArticleOf(url) === null) {
    try {
      text = await fetchPageText(url);
    } catch (e) {
      return { error: e instanceof VenueSiteError ? e.message : "Nie udało się pobrać tej strony. Wklej tekst ręcznie." };
    }
  }
  let content;
  try {
    content = await describeFromPage({ name, kind: item?.kind ?? "visit", context: { itemTitle: item?.title ?? name, description: item?.description, trip: doc.trip.title } }, text === "" ? { url } : { url, text }, { client, timeoutMs: 60_000 });
  } catch (e) {
    return { error: `Nie udało się przygotować opisu „${name}”: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (content === null) return { error: "W tym źródle jest za mało tekstu, żeby zrobić z niego opis." };
  const itemId = item === undefined ? undefined : ids[item.ref];
  const result = await storeGuide(supabase, tripId, name, content, itemId, placeRef === undefined ? undefined : ids[placeRef], item?.ref ?? name);
  // Opis miejsca: dawny własny opis punktu (ze wskazówką) by go zasłaniał.
  const own = itemId === undefined || placeRef === undefined ? undefined : loaded.guides.find((row) => !row.deleted_at && row.item_id === itemId && row.place_id === null);
  if ("ok" in result && own !== undefined) {
    const { error } = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", own.id).eq("trip_id", tripId);
    if (error) return { error: dbErrorMessage(error) };
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
  const todo = undescribedSights(doc, loaded.guides, ids);
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

/** Ręczna poprawka tekstu opisu, tylko w tym wyjeździe: wspólna biblioteka opisów zostaje bez zmian. */
export async function saveGuideText(tripId: string, guideId: string, text: GuideDraft): Promise<FormState> {
  const parsed = GuideDraft.safeParse(text);
  if (!parsed.success) return { error: `Niepoprawny tekst opisu (${parsed.error.issues[0]?.path.join(".") ?? ""}).` };
  return changeGuide(tripId, guideId, (current) => editGuideText(current, parsed.data), "Zapisano poprawkę.");
}

async function readGuide(supabase: Supabase, tripId: string, guideId: string): Promise<{ content: GuideContent; title: string } | { error: string }> {
  const { data, error } = await supabase.from("audio_guides").select("content, title").eq("id", guideId).eq("trip_id", tripId).is("deleted_at", null).maybeSingle();
  if (error) return { error: dbErrorMessage(error) };
  const current = GuideContent.safeParse(data?.content);
  return current.success && data !== null ? { content: current.data, title: data.title } : { error: "Tego opisu już nie ma — odśwież stronę." };
}

/** Ręczna zmiana opisu w tym wyjeździe: wspólna biblioteka opisów zostaje bez zmian. */
async function changeGuide(tripId: string, guideId: string, change: (current: GuideContent) => GuideContent, ok: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/guides`);
  const current = await readGuide(supabase, tripId, guideId);
  if ("error" in current) return current;
  const content = change(current.content);
  const saved = await supabase
    .from("audio_guides")
    .update({ content: content as unknown as NonNullable<Json>, text: guideText(content) })
    .eq("id", guideId)
    .eq("trip_id", tripId)
    .select("id");
  if (saved.error) return { error: dbErrorMessage(saved.error) };
  if (saved.data.length === 0) return { error: "Brak uprawnień do tej zmiany." };
  // Własne zdjęcia, które wypadły z opisu, nie są już nigdzie potrzebne (każde ma własny plik).
  const dropped = droppedGuidePhotos(current.content, content);
  if (dropped.length > 0) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove(dropped);
  refresh();
  return { ok };
}

/**
 * Zdjęcia do wyboru: z artykułu opisu i z wyszukiwania w Commons po kolei, a `query` to własne hasło (tylko Commons).
 * Bez AI, a odpowiada tylko na opis, który użytkownik może odczytać.
 */
export async function findGuideImages(tripId: string, guideId: string, query = ""): Promise<{ images: GuideImage[] } | { error: string }> {
  const { supabase } = await requireUser(`/trips/${tripId}/guides`);
  const current = await readGuide(supabase, tripId, guideId);
  if ("error" in current) return current;
  const { article } = current.content;
  const asked = query.trim().slice(0, 100);
  const fromArticle = asked === "" && article.site !== "web" ? await articleImages(article.title, article.lang, 24, fetch, article.site).catch(() => null) : [];
  // Tytuł artykułu bywa dokładniejszy niż nazwa z planu, a strona wskazana ręcznie ma tylko adres.
  const fromCommons = await commonsImages(asked || coreName(article.site === "web" ? current.title : article.title)).catch(() => null);
  if (fromArticle === null && fromCommons === null) return { error: "Nie udało się pobrać zdjęć z Wikimedia. Spróbuj za chwilę." };
  const images = [...(fromArticle ?? []), ...(fromCommons ?? [])];
  return { images: images.filter((image, index) => images.findIndex((each) => each.url === image.url) === index) };
}

/** Wybrane zdjęcie: na miejsce `replaceUrl`, a bez niego jako kolejne. */
export async function pickGuideImage(tripId: string, guideId: string, image: GuideImage, replaceUrl?: string): Promise<FormState> {
  const parsed = GuideImage.safeParse(image);
  if (!parsed.success || !isWikimediaImage(parsed.data)) return { error: "To zdjęcie nie pochodzi z Wikimedia albo nie ma licencji." };
  return changeGuide(tripId, guideId, (current) => putGuideImage(current, parsed.data, replaceUrl), replaceUrl ? "Wymieniono zdjęcie." : `Dodano zdjęcie (najwyżej ${MAX_GUIDE_IMAGES}).`);
}

/**
 * Własne zdjęcie: przeglądarka wgrała już plik do `guide_photos/<wyjazd>/<id>.jpg` (RLS: organizator i edytor),
 * tu trafia do opisu na miejsce `replaceUrl` albo jako kolejne. Autor bez wpisu = osoba wgrywająca z listy uczestników.
 */
export async function addOwnGuideImage(tripId: string, guideId: string, fileId: string, fields: { title: string; author: string }, replaceUrl?: string): Promise<FormState> {
  const { supabase, userId } = await requireUser(`/trips/${tripId}/guides`);
  const path = guidePhotoPath(tripId, fileId);
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return { error: "Nieznany plik zdjęcia." };
  const current = await readGuide(supabase, tripId, guideId);
  const full = !("error" in current) && replaceUrl === undefined && current.content.images.length >= MAX_GUIDE_IMAGES;
  if ("error" in current || full) {
    await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove([path]);
    return "error" in current ? current : { error: `Opis ma już ${MAX_GUIDE_IMAGES} zdjęć: usuń albo wymień któreś.` };
  }
  let author = fields.author.trim();
  if (author === "") {
    const { data } = await supabase.from("travelers").select("name").eq("trip_id", tripId).eq("user_id", userId).is("deleted_at", null).limit(1).maybeSingle();
    author = data?.name ?? "";
  }
  const url = supabase.storage.from(GUIDE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  const image = ownGuideImage(url, fields.title, author);
  const result = await changeGuide(tripId, guideId, (current) => putGuideImage(current, image, replaceUrl), replaceUrl ? "Wymieniono zdjęcie na własne." : `Dodano własne zdjęcie (najwyżej ${MAX_GUIDE_IMAGES}).`);
  // Nie trafiło do opisu (błąd, brak praw albo limit zdjęć): plik nie zostaje bez opisu.
  if (result.error) await supabase.storage.from(GUIDE_PHOTO_BUCKET).remove([path]);
  return result;
}

export async function dropGuideImage(tripId: string, guideId: string, url: string): Promise<FormState> {
  return changeGuide(tripId, guideId, (current) => removeGuideImage(current, url), "Usunięto zdjęcie.");
}

/** Zmiana kolejności zdjęć opisu: o jedno miejsce albo na początek (pierwsze idzie do „Opisu wyprawy” i pokazu). */
export async function reorderGuideImage(tripId: string, guideId: string, url: string, by: -1 | 1 | "first"): Promise<FormState> {
  if (by !== -1 && by !== 1 && by !== "first") return { error: "Nieznany kierunek." };
  return changeGuide(tripId, guideId, (current) => moveGuideImage(current, url, by), "Zmieniono kolejność zdjęć.");
}

/** Usunięcie opisu (miękkie) — np. gdy artykuł okazał się o czymś innym. */
export async function removeGuide(tripId: string, guideId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const { data, error } = await supabase.from("audio_guides").update({ deleted_at: new Date().toISOString() }).eq("id", guideId).eq("trip_id", tripId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if ((data ?? []).length === 0) return { error: "Brak uprawnień do tej zmiany." };
  refresh();
  return { ok: "Usunięto opis." };
}
