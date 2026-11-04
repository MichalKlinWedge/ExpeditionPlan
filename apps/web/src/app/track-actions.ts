"use server";

import { DocTrack, type ItemRouteFields, setItemRoute, TripDocument } from "@expeditionplan/core";
import { type ElementWrite, refIndex, saveElements, savePlanEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

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

const message = (error: { message: string; code?: string }) => (error.code === "42501" ? "Brak uprawnień do tej zmiany." : error.message);
const minutesLabel = (value: number) => `${Math.floor(value / 60)} h ${value % 60} min`;

async function commit(tripId: string, itemRef: string, build: (doc: Doc, item: Doc["items"][number]) => { doc: Doc; writes: ElementWrite[]; ok: string } | string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const doc = stateFromPayload(payload).doc;
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const result = build(doc, item);
  if (typeof result === "string") return { error: result };
  const checked = TripDocument.safeParse(result.doc);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
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
async function writeRoute(tripId: string, itemRef: string, fields: ItemRouteFields, ok: (before: Doc["items"][number]) => string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/item/${itemRef}`);
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) return { error: message(error) };
  if (data === null) return { error: "Nie ma takiego wyjazdu." };
  const payload = data as Parameters<typeof stateFromPayload>[0];
  const doc = stateFromPayload(payload).doc;
  const edit = setItemRoute(doc, itemRef, `id-${uuidv7()}`, fields);
  if (edit === null) return { error: "Tego punktu już nie ma — odśwież stronę." };
  const checked = TripDocument.safeParse(edit.doc);
  if (!checked.success) {
    const issue = checked.error.issues[0]!;
    return { error: `Nie zapisano: ${issue.message}${issue.path.length > 0 ? ` (${issue.path.join(".")})` : ""}` };
  }
  const track = checked.data.tracks.find((each) => each.ref === edit.track.ref)!;
  const item = checked.data.items.find((each) => each.ref === itemRef)!;
  try {
    const ids = await saveElements(supabase, tripId, checked.data, [{ collection: "tracks", element: track, op: edit.trackCreated ? "insert" : "update" }], refIndex(payload.tables));
    await savePlanEdit(supabase, tripId, { doc: checked.data, changed: [item] }, ids);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return { ok: ok(doc.items.find((each) => each.ref === itemRef)!) };
}

/** Plik GPX: linia i liczby z pliku zapisują się od razu, a komunikat podaje poprzedni czas punktu. */
export async function saveTrack(tripId: string, itemRef: string, upload: TrackUpload): Promise<FormState> {
  const parsed = Upload.safeParse(upload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawny ślad." };
  const { name, geojson, stats } = parsed.data;
  const { distanceKm, durationMin, ascentM, descentM } = stats;
  return writeRoute(tripId, itemRef, { geojson, name, distanceKm, durationMin, ...(ascentM !== null ? { ascentM } : {}), ...(descentM !== null ? { descentM } : {}) }, (before) => {
    const was = before.durationMin ?? before.leg?.durationMin;
    const numbers = `${distanceKm.toLocaleString("pl-PL")} km${ascentM !== null ? `, ↑ ${ascentM} m` : ""}, ok. ${minutesLabel(durationMin)}`;
    const previous = was !== undefined && was !== durationMin ? ` (było ${minutesLabel(was)})` : "";
    const flat = ascentM === null ? " Plik nie ma wysokości, więc czas nie uwzględnia podejść." : "";
    return `Zapisano ślad: ${numbers}${previous}${before.dayRef !== undefined ? " — plan dnia przeliczony" : ""}.${flat}`;
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
    () => (durationMin !== undefined ? `Zapisano trasę. Czas punktu: ${minutesLabel(durationMin)} — plan dnia przeliczony.` : "Zapisano trasę."),
  );
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
