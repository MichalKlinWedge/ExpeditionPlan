"use server";

import { attachRoute, carRouteFromItem, detachRoute, DocTrack, editRoute, isGoogleShortLink, type LatLng, newRoute, parseCoordinates, formatMinutes, plainName, plural, removeRoute, routeKind, routeLine, routeLineFields, trackEndsNote, TripDocument } from "@expeditionplan/core";
import { googleLinkVias, resolveGoogleLink } from "@expeditionplan/planner";
import { type ElementWrite, refIndex, saveElements, savePlanEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { aiAccessError, routeLookup } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * „Trasy” wyjazdu (`core/route-library.ts`): podpinanie trasy do punktu, odpinanie, zapis przejazdu autem jako trasy,
 * nazwa i usunięcie nieużywanej. Trasy i miejsca idą przez `saveElements`, punkty przez `savePlanEdit` (ręczna zmiana
 * = `user_locked`, więc „Przelicz przejazdy” nie nadpisze podpiętego przebiegu). O prawie do zapisu decyduje RLS.
 */

type Doc = TripDocument;
type Change = { doc: Doc; writes?: ElementWrite[]; items?: string[]; ok: string };

async function commit(tripId: string, path: string, build: (doc: Doc) => Change | string): Promise<FormState> {
  const { supabase } = await requireUser(path);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const result = build(stateFromPayload(payload).doc);
  if (typeof result === "string") return { error: result };
  const checked = TripDocument.safeParse(result.doc);
  if (!checked.success) return { error: validationError(checked.error) };
  const fresh = (write: ElementWrite): ElementWrite => {
    const element = (checked.data[write.collection] as { ref: string }[]).find((each) => each.ref === write.element.ref);
    return element === undefined ? write : { ...write, element: element as ElementWrite["element"] };
  };
  try {
    const ids = await saveElements(supabase, tripId, checked.data, (result.writes ?? []).map(fresh), refIndex(payload.tables));
    const changed = checked.data.items.filter((item) => result.items?.includes(item.ref));
    if (changed.length > 0) await savePlanEdit(supabase, tripId, { doc: checked.data, changed }, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: result.ok };
}

const itemPath = (tripId: string, itemRef: string) => `/trips/${tripId}/item/${encodeURIComponent(itemRef)}`;

/** Podpina trasę z „Tras” do punktu; poprzednia zostaje w „Trasach”. */
export async function attachItemRoute(tripId: string, itemRef: string, trackRef: string): Promise<FormState> {
  return commit(tripId, itemPath(tripId, itemRef), (doc) => {
    const attached = attachRoute(doc, itemRef, trackRef, { fromId: uuidv7(), toId: uuidv7() });
    if (typeof attached === "string") return attached;
    const name = doc.tracks.find((track) => track.ref === trackRef)!.name;
    const places: ElementWrite[] = (attached.ends?.places ?? []).map(({ place, created }) => ({ collection: "places", element: place, op: created ? "insert" : "update" }));
    const ends = attached.ends === null ? "" : trackEndsNote(attached.ends);
    return { doc: attached.doc, writes: places, items: [itemRef], ok: `Podpięto trasę „${name}”${attached.item.dayRef !== undefined ? " — plan dnia przeliczony" : ""}.${ends === "" ? "" : ` ${ends}`}` };
  });
}

/** Odpina trasę od punktu; trasa zostaje w „Trasach”. */
export async function detachItemRoute(tripId: string, itemRef: string): Promise<FormState> {
  return commit(tripId, itemPath(tripId, itemRef), (doc) => {
    const detached = detachRoute(doc, itemRef);
    if (detached === null) return "Ten punkt nie ma podpiętej trasy.";
    return { doc: detached.doc, items: [itemRef], ok: "Odpięto trasę — zostaje w „Trasach”." };
  });
}

/** „Zapisz w Trasach”: przebieg przejazdu autem (linia, „Jedź przez”, link) jako trasa do ponownego użycia. */
export async function saveItemCarRoute(tripId: string, itemRef: string): Promise<FormState> {
  return commit(tripId, itemPath(tripId, itemRef), (doc) => {
    const saved = carRouteFromItem(doc, itemRef, `id-${uuidv7()}`);
    if (saved === null) return "Ten przejazd nie ma jeszcze przebiegu: przelicz trasę albo wpisz „Jedź przez” lub własny link.";
    return {
      doc: saved.doc,
      writes: [{ collection: "tracks", element: saved.track, op: saved.created ? "insert" : "update" }],
      items: [itemRef],
      ok: saved.created ? `Zapisano w „Trasach” jako „${saved.track.name}”.` : `Zaktualizowano trasę „${saved.track.name}”.`,
    };
  });
}

/** Przejazdy autem z planu do „Tras” naraz (sekcja „Przejazdy autem z planu”); już zapisane i bez przebiegu są pomijane. */
export async function saveCarRoutes(tripId: string, itemRefs: string[]): Promise<FormState> {
  const refs = z.array(z.string().max(80)).min(1).max(200).safeParse(itemRefs);
  if (!refs.success) return { error: "Nie wybrano przejazdów." };
  return commit(tripId, `/trips/${tripId}/routes`, (doc) => {
    let next = doc;
    const writes: ElementWrite[] = [];
    const items: string[] = [];
    for (const ref of refs.data) {
      if (next.items.find((item) => item.ref === ref)?.leg?.trackRef !== undefined) continue;
      const saved = carRouteFromItem(next, ref, `id-${uuidv7()}`);
      if (saved === null) continue;
      next = saved.doc;
      writes.push({ collection: "tracks", element: saved.track, op: saved.created ? "insert" : "update" });
      items.push(ref);
    }
    if (items.length === 0) return "Nie ma czego zapisać — odśwież stronę.";
    return { doc: next, writes, items, ok: `Zapisano w „Trasach”: ${plural(items.length, ["przejazd", "przejazdy", "przejazdów"])}.` };
  });
}

const Name = z.string().trim().min(1, "Trasa musi mieć nazwę.").max(120, "Nazwa jest za długa.");

export async function renameRoute(tripId: string, trackRef: string, name: string): Promise<FormState> {
  const parsed = Name.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawna nazwa." };
  return commit(tripId, `/trips/${tripId}/routes`, (doc) => {
    const track = doc.tracks.find((each) => each.ref === trackRef);
    if (track === undefined) return "Tej trasy już nie ma — odśwież stronę.";
    const next = { ...track, name: parsed.data };
    return { doc: { ...doc, tracks: doc.tracks.map((each) => (each.ref === trackRef ? next : each)) }, writes: [{ collection: "tracks", element: next, op: "update" }], ok: "Zapisano nazwę." };
  });
}

/** Usuwa nieużywaną trasę z „Tras”. */
export async function removeRouteAction(tripId: string, trackRef: string): Promise<FormState> {
  return commit(tripId, `/trips/${tripId}/routes`, (doc) => {
    const track = doc.tracks.find((each) => each.ref === trackRef);
    const next = removeRoute(doc, trackRef);
    if (typeof next === "string") return next;
    return { doc: next, writes: [{ collection: "tracks", element: track!, op: "remove" }], ok: `Usunięto trasę „${track!.name}”.` };
  });
}

const NewRoute = z.object({
  kind: z.enum(["foot", "car"]),
  name: Name,
  // Tylko http(s): link trafia do `href` i do przeglądarki telefonu.
  url: z.url().regex(/^https?:\/\//i, "Link musi zaczynać się od https://.").max(500).optional(),
  distanceKm: z.number().nonnegative().max(5000).optional(),
  durationMin: z.number().int().nonnegative().max(14_400).optional(),
  ascentM: z.number().int().nonnegative().max(30_000).optional(),
  descentM: z.number().int().nonnegative().max(30_000).optional(),
  geojson: DocTrack.shape.geojson.unwrap().refine((line) => line.coordinates.length <= 2000, "Za dużo punktów śladu.").optional(),
  fromRef: z.string().max(80).optional(),
  toRef: z.string().max(80).optional(),
});
export type NewRouteFields = z.input<typeof NewRoute>;

/** Trasa dodana ręcznie w „Trasach”: bez punktu planu, do podpięcia później. Plik GPX czyta przeglądarka (`trackFromGpx`). */
export async function addRoute(tripId: string, fields: NewRouteFields): Promise<FormState> {
  const parsed = NewRoute.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane trasy." };
  const ref = `id-${uuidv7()}`;
  const saved = await commit(tripId, `/trips/${tripId}/routes`, (doc) => {
    const created = newRoute(doc, ref, parsed.data);
    if (typeof created === "string") return created;
    return { doc: created.doc, writes: [{ collection: "tracks", element: created.track, op: "insert" }], ok: `Dodano trasę „${created.track.name}”.` };
  });
  return saved.ok ? withLine(saved, await drawCarRoute(tripId, ref, true)) : saved;
}

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const EditFields = z.object({
  name: Name.optional(),
  kind: z.enum(["foot", "car"]).optional(),
  url: z.url().regex(/^https?:\/\//i, "Link musi zaczynać się od https://.").max(500).nullable().optional(),
  distanceKm: z.number().nonnegative().max(5000).nullable().optional(),
  durationMin: z.number().int().nonnegative().max(14_400).nullable().optional(),
  ascentM: z.number().int().nonnegative().max(30_000).nullable().optional(),
  descentM: z.number().int().nonnegative().max(30_000).nullable().optional(),
  difficulty: text(120),
  waymarking: text(200),
  routeNotes: text(2000),
  geojson: DocTrack.shape.geojson.unwrap().refine((line) => line.coordinates.length <= 2000, "Za dużo punktów śladu.").nullable().optional(),
  fromRef: z.string().max(80).nullable().optional(),
  toRef: z.string().max(80).nullable().optional(),
});
export type RouteEditInput = z.input<typeof EditFields>;

/**
 * Edycja trasy na jej stronie (`editRoute`). Z `updateUsers` podpięte punkty dostają od nowa jej przebieg i liczby
 * (zapis punktów przez `savePlanEdit`, więc plan dnia się przelicza).
 */
export type NewEndPlace = { name: string; coords: string };

/** Współrzędne nowego końca: wklejone liczby, pełny link z mapy albo krótki link Google (jedno zapytanie HEAD, `resolveGoogleLink`). */
async function endPoint(coords: string): Promise<LatLng | null> {
  const text = coords.trim();
  const direct = parseCoordinates(text);
  if (direct !== null || !isGoogleShortLink(text)) return direct;
  const resolved = await resolveGoogleLink(text).catch(() => null);
  return resolved === null ? null : parseCoordinates(resolved);
}

/**
 * Edycja trasy na jej stronie (`editRoute`). Koniec może być nowym miejscem (nazwa + współrzędne albo link z mapy);
 * miejsce o tej samej nazwie w wyjeździe jest użyte zamiast nowego.
 */
export async function updateRoute(tripId: string, trackRef: string, fields: RouteEditInput, updateUsers: boolean, newPlaces: { from?: NewEndPlace; to?: NewEndPlace } = {}): Promise<FormState> {
  const parsed = EditFields.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane trasy." };
  const fresh: { end: "from" | "to"; name: string; point: LatLng }[] = [];
  for (const end of ["from", "to"] as const) {
    const typed = newPlaces[end];
    if (typed === undefined) continue;
    const name = typed.name.trim();
    const label = end === "from" ? "„Skąd”" : "„Dokąd”";
    if (name === "" || name.length > 200) return { error: `${label}: wpisz nazwę nowego miejsca (do 200 znaków).` };
    const point = await endPoint(typed.coords);
    if (point === null) return { error: `${label}: nie widzę współrzędnych. Wklej np. „49.2, 22.5” albo link z Google Maps lub OpenStreetMap.` };
    fresh.push({ end, name, point });
  }
  const saved = await commit(tripId, `/trips/${tripId}/routes/${encodeURIComponent(trackRef)}`, (doc) => {
    const added: ElementWrite[] = [];
    let base = doc;
    const ends: { fromRef?: string; toRef?: string } = {};
    for (const { end, name, point } of fresh) {
      const same = base.places.find((place) => plainName(place.name) === plainName(name) && place.lat !== undefined && place.lng !== undefined);
      const place = same ?? { ref: `id-${uuidv7()}`, name, lat: Math.round(point.lat * 1e5) / 1e5, lng: Math.round(point.lng * 1e5) / 1e5, provider: "user" as const, links: [] };
      if (same === undefined) {
        base = { ...base, places: [...base.places, place] };
        added.push({ collection: "places", element: place, op: "insert" });
      }
      ends[end === "from" ? "fromRef" : "toRef"] = place.ref;
    }
    const edited = editRoute(base, trackRef, { ...parsed.data, ...ends }, { updateUsers, ids: () => ({ fromId: uuidv7(), toId: uuidv7() }) });
    if (typeof edited === "string") return edited;
    const places: ElementWrite[] = [...added, ...edited.places.map(({ place, created }): ElementWrite => ({ collection: "places", element: place, op: created ? "insert" : "update" }))];
    const users = edited.items.length;
    return {
      doc: edited.doc,
      writes: [...places, { collection: "tracks", element: edited.track, op: "update" }],
      items: edited.items.map((item) => item.ref),
      ok: `Zapisano trasę.${users > 0 ? ` Zaktualizowano ${plural(users, ["podpięty punkt", "podpięte punkty", "podpiętych punktów"])} — plan dnia przeliczony.` : ""}`,
    };
  });
  return saved.ok ? withLine(saved, await drawCarRoute(tripId, trackRef, true)) : saved;
}

/** Komunikat zapisu z dopisanym wynikiem wyznaczenia przebiegu (błąd tego kroku nie unieważnia zapisu). */
function withLine(saved: FormState, drawn: FormState | null): FormState {
  if (drawn === null) return saved;
  return { ok: `${saved.ok} ${drawn.ok ?? `Przebiegu nie wyznaczono: ${drawn.error}`}` };
}

/**
 * Przebieg trasy autem po drogach (OpenRouteService) z jej końców, przez „Jedź przez” albo punkty pośrednie własnego
 * linku Google (jak „Przelicz trasę” przy przejeździe; z Google nic nie zapisujemy). Linia, km i czas trafiają do trasy
 * i do podpiętych przejazdów. `auto` (po zapisie): tylko trasa autem bez linii i z oboma końcami, bez komunikatu, gdy
 * nie ma czego liczyć.
 */
async function drawCarRoute(tripId: string, trackRef: string, auto: boolean): Promise<FormState | null> {
  const { supabase } = await requireUser(`/trips/${tripId}/routes/${encodeURIComponent(trackRef)}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return auto ? null : { error: pulled.error };
  const track = stateFromPayload(pulled.payload).doc.tracks.find((each) => each.ref === trackRef);
  if (track === undefined) return auto ? null : { error: "Tej trasy już nie ma — odśwież stronę." };
  if (routeKind(track) !== "car") return auto ? null : { error: "Przebieg po drogach liczy się tylko dla trasy autem; pieszą narysuje plik GPX." };
  if (auto && routeLine(track) !== undefined) return null;
  const from = track.route?.from;
  const to = track.route?.to;
  if (from === undefined || to === undefined) return auto ? null : { error: "Ustaw „Skąd” i „Dokąd” — od nich liczy się przebieg." };
  const denied = await aiAccessError();
  if (denied) return auto ? null : { error: denied };
  const lookup = routeLookup();
  if (lookup === null) return auto ? null : { error: "Serwer nie ma klucza OPENROUTESERVICE_API_KEY." };
  const own = track.route?.via ?? [];
  const link = own.length > 0 ? { vias: own, status: "own" as const } : await googleLinkVias(track.url);
  let result;
  try {
    result = await lookup(from, to, "driving-car", link.vias);
  } catch (e) {
    return { error: `usługa tras nie odpowiedziała (${e instanceof Error ? e.message : String(e)}), spróbuj za chwilę.` };
  }
  const fields = result === null ? null : routeLineFields(result);
  if (fields === null) return { error: "nie znaleziono drogi między końcami tej trasy." };
  const via = link.vias.length > 0 ? ` przez ${plural(link.vias.length, ["punkt", "punkty", "punktów"])} ${link.status === "own" ? "z „Jedź przez”" : "z Twojego linku"}` : "";
  const note = link.status === "none" ? " Twój link ma tylko start i cel, więc drogę wybrał OpenRouteService i może iść inaczej niż w Google." : "";
  return commit(tripId, `/trips/${tripId}/routes/${encodeURIComponent(trackRef)}`, (doc) => {
    const edited = editRoute(doc, trackRef, fields, { updateUsers: true, ids: () => ({ fromId: uuidv7(), toId: uuidv7() }) });
    if (typeof edited === "string") return edited;
    return {
      doc: edited.doc,
      writes: [...edited.places.map(({ place, created }): ElementWrite => ({ collection: "places", element: place, op: created ? "insert" : "update" })), { collection: "tracks", element: edited.track, op: "update" }],
      items: edited.items.map((item) => item.ref),
      ok: `Wyznaczono przebieg po drogach${via}: ${fields.distanceKm!.toLocaleString("pl-PL")} km, ${formatMinutes(fields.durationMin!)}.${note}`,
    };
  });
}

/** „Wyznacz przebieg” na stronie trasy autem. */
export async function drawRouteLine(tripId: string, trackRef: string): Promise<FormState> {
  const drawn = (await drawCarRoute(tripId, trackRef, false)) ?? { error: "nie ma czego wyznaczyć." };
  return drawn.error === undefined ? drawn : { error: `Nie wyznaczono przebiegu: ${drawn.error}` };
}
