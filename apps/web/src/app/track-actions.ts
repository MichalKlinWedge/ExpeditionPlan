"use server";

import { DocTrack, formatMinutes, type ItemRouteFields, localToday, setItemRoute, setTrackEnds, setTrackPois, trackEndsNote, trackLine, type TrackPoi, TripDocument } from "@expeditionplan/core";
import { fetchTrackPois, OVERPASS_URL } from "@expeditionplan/planner";
import { type ElementWrite, refIndex, saveElements, savePlanEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { pullTrip, validationError } from "@/lib/trip-snapshot";

/**
 * Ślad GPX punktu (Etap 7). Plik czyta i upraszcza przeglądarka (`trackFromGpx` z core) — na serwer
 * idzie tylko linia (najwyżej 1500 punktów) i statystyki, bez limitu rozmiaru akcji. Ślad to element
 * `tracks` (nowy albo ten z `activity.trackRef`); punkt dostaje odwołanie, a dystans, czas i podejście
 * z pliku zastępują dotychczasowe. O prawie do zapisu decyduje RLS (organizator, edytor).
 */

type Doc = TripDocument;

const Upload = z.object({
  name: z.string().trim().max(120).nullable(),
  geojson: DocTrack.shape.geojson.unwrap().refine((line) => line.coordinates.length <= 2000, "Za dużo punktów śladu."),
  stats: z.object({
    distanceKm: z.number().nonnegative(),
    ascentM: z.number().int().nonnegative().nullable(),
    descentM: z.number().int().nonnegative().nullable(),
    durationMin: z.number().int().nonnegative(),
  }),
});
export type TrackUpload = z.input<typeof Upload>;

async function commit(tripId: string, itemRef: string, build: (doc: Doc, item: Doc["items"][number]) => { doc: Doc; writes: ElementWrite[]; ok: string } | string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const result = build(doc, item);
  if (typeof result === "string") return { error: result };
  const checked = TripDocument.safeParse(result.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  try {
    await saveElements(supabase, tripId, checked.data, result.writes, refIndex(payload.tables));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: result.ok };
}

/**
 * Trasa punktu (`setItemRoute`). Ślad idzie przez `saveElements`, a punkt przez `savePlanEdit` — ręczna
 * edycja daje `user_locked`, więc „Przelicz przejazdy” jej nie nadpisze.
 */
async function writeRoute(tripId: string, itemRef: string, fields: ItemRouteFields, ok: (before: Doc["items"][number], ends: string) => string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const { payload } = pulled;
  const doc = stateFromPayload(payload).doc;
  // Plik GPX sam ustawia brakujący start i koniec przejścia.
  const ends = fields.geojson === undefined ? null : setTrackEnds(doc, itemRef, { fromId: uuidv7(), toId: uuidv7() }, { name: fields.name ?? null, coordinates: fields.geojson.coordinates });
  const edit = setItemRoute(ends?.doc ?? doc, itemRef, `id-${uuidv7()}`, fields);
  if (edit === null) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    return { error: validationError(checked.error) };
  }
  const track = checked.data.tracks.find((each) => each.ref === edit.track.ref)!;
  const item = checked.data.items.find((each) => each.ref === itemRef)!;
  try {
    const places: ElementWrite[] = (ends?.places ?? []).map(({ place, created }) => ({ collection: "places", element: place, op: created ? "insert" : "update" }));
    const ids = await saveElements(supabase, tripId, checked.data, [...places, { collection: "tracks", element: track, op: edit.trackCreated ? "insert" : "update" }], refIndex(payload.tables));
    await savePlanEdit(supabase, tripId, { doc: checked.data, changed: [item] }, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: ok(doc.items.find((each) => each.ref === itemRef)!, ends === null ? "" : trackEndsNote(ends)) };
}

/** Plik GPX: linia i liczby z pliku zapisują się od razu, a komunikat podaje poprzedni czas punktu. */
export async function saveTrack(tripId: string, itemRef: string, upload: TrackUpload): Promise<FormState> {
  const parsed = Upload.safeParse(upload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawny ślad." };
  const { name, geojson, stats } = parsed.data;
  const { distanceKm, durationMin, ascentM, descentM } = stats;
  return writeRoute(tripId, itemRef, { geojson, name, distanceKm, durationMin, ...(ascentM !== null ? { ascentM } : {}), ...(descentM !== null ? { descentM } : {}) }, (before, ends) => {
    const was = before.durationMin ?? before.leg?.durationMin;
    const numbers = `${distanceKm.toLocaleString("pl-PL")} km${ascentM !== null ? `, ↑ ${ascentM} m` : ""}, ok. ${formatMinutes(durationMin)}`;
    const previous = was !== undefined && was !== durationMin ? ` (było ${formatMinutes(was)})` : "";
    const flat = ascentM === null ? " Plik nie ma wysokości, więc czas nie uwzględnia podejść." : "";
    return `Zapisano ślad: ${numbers}${previous}${before.dayRef !== undefined ? " — plan dnia przeliczony" : ""}.${flat}${ends === "" ? "" : ` ${ends}`}`;
  });
}

const RouteFields = z.object({
  // Tylko http(s): link trafia do `href` i do przeglądarki telefonu.
  url: z.url().regex(/^https?:\/\//i, "Link musi zaczynać się od https://.").max(500).nullable().optional(),
  distanceKm: z.number().nonnegative().max(5000).optional(),
  durationMin: z.number().int().nonnegative().max(14_400).optional(),
  ascentM: z.number().int().nonnegative().max(30_000).optional(),
});

/** Trasa z zewnętrznej mapy: link i liczby wpisane z mapy. */
export async function saveItemRoute(tripId: string, itemRef: string, fields: z.input<typeof RouteFields>): Promise<FormState> {
  const parsed = RouteFields.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawne dane trasy." };
  const { url, distanceKm, durationMin, ascentM } = parsed.data;
  return writeRoute(
    tripId,
    itemRef,
    {
      ...(url !== undefined ? { url } : {}),
      ...(distanceKm !== undefined ? { distanceKm } : {}),
      ...(durationMin !== undefined ? { durationMin } : {}),
      ...(ascentM !== undefined ? { ascentM } : {}),
    },
    () => {
      if (durationMin !== undefined) return `Zapisano trasę. Czas punktu: ${formatMinutes(durationMin)} — plan dnia przeliczony.`;
      // Regulamin Mapy.com nie pozwala zapisywać wyników ich API, więc sam link liczb nie zmienia.
      if (url && distanceKm === undefined) return "Zapisano link. Długość i czas nie przeliczają się z linku: przepisz je z mapy albo wgraj GPX.";
      return "Zapisano trasę.";
    },
  );
}

/**
 * Woda, schroniska i zejścia awaryjne wzdłuż śladu z OpenStreetMap (Overpass, serwer FOSSGIS) — na
 * kliknięcie, jedno zapytanie. Warunki serwera wymagają e-maila operatora na stronie (`CONTACT_EMAIL`,
 * „Pomoc”), więc bez niego nie pytamy. Wynik zostaje w śladzie, więc telefon ma go offline.
 */
export async function findTrackPois(tripId: string, itemRef: string): Promise<FormState> {
  if (!process.env.CONTACT_EMAIL) return { error: "Nie pobrano: serwer nie ma ustawionego CONTACT_EMAIL (warunek serwera OpenStreetMap Overpass)." };
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const pulled = await pullTrip(supabase, tripId);
  if (pulled.error !== undefined) return { error: pulled.error };
  const doc = stateFromPayload(pulled.payload).doc;
  const item = doc.items.find((each) => each.ref === itemRef);
  const current = doc.tracks.find((track) => track.ref === item?.activity?.trackRef);
  const line = current === undefined ? undefined : trackLine(current);
  if (current === undefined || line === undefined) return { error: "Ten punkt nie ma śladu GPX." };
  let found: TrackPoi[];
  try {
    found = await fetchTrackPois(line, { url: process.env.OVERPASS_URL || OVERPASS_URL });
  } catch (e) {
    return { error: `Nie pobrano z OpenStreetMap: ${e instanceof Error ? e.message : String(e)}` };
  }
  return commit(tripId, itemRef, (fresh) => {
    const set = setTrackPois(fresh, current.ref, found, localToday());
    if (set === null) return "Ślad zmienił się w międzyczasie — odśwież stronę.";
    const count = (kind: TrackPoi["kind"]) => found.filter((poi) => poi.kind === kind).length;
    const summary = found.length === 0 ? "Sprawdzone." : `Przy śladzie: woda ${count("water")}, schronienia ${count("shelter")}, zejścia ${count("exit")}.`;
    return { doc: set.doc, writes: [{ collection: "tracks", element: set.track, op: "update" }], ok: summary };
  });
}

/** Usuwa samą linię śladu; opis trasy (nazwa, trudność, oznakowanie) zostaje w planie. */
export async function removeTrackLine(tripId: string, itemRef: string): Promise<FormState> {
  return commit(tripId, itemRef, (doc, item) => {
    const current = doc.tracks.find((track) => track.ref === item.activity?.trackRef);
    if (current?.geojson === undefined) return "Ten punkt nie ma śladu.";
    const track = { ...current, geojson: undefined };
    return { doc: { ...doc, tracks: doc.tracks.map((each) => (each.ref === track.ref ? track : each)) }, writes: [{ collection: "tracks", element: track, op: "update" }], ok: "Usunięto ślad." };
  });
}
