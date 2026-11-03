"use server";

import { DocTrack, TripDocument } from "@expeditionplan/core";
import { type ElementWrite, refIndex, saveElements, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/**
 * Ślad GPX punktu (Etap 7). Plik czyta i upraszcza przeglądarka (`trackFromGpx` z core) — na serwer
 * idzie tylko linia (najwyżej 1500 punktów) i statystyki, bez limitu rozmiaru akcji. Ślad to element
 * `tracks` (nowy albo ten z `activity.trackRef`); punkt dostaje odwołanie i — gdy ich nie miał —
 * dystans i podejście. O prawie do zapisu decyduje RLS (organizator, edytor).
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

export async function saveTrack(tripId: string, itemRef: string, upload: TrackUpload): Promise<FormState> {
  const parsed = Upload.safeParse(upload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Niepoprawny ślad." };
  const { name, geojson, stats } = parsed.data;
  return commit(tripId, itemRef, (doc, item) => {
    const current = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((track) => track.ref === item.activity!.trackRef);
    const track = {
      ...(current ?? { ref: `id-${uuidv7()}`, name: name || item.title }),
      geojson,
      distanceKm: stats.distanceKm,
      ...(stats.ascentM !== null ? { ascentM: stats.ascentM } : {}),
      ...(stats.descentM !== null ? { descentM: stats.descentM } : {}),
      durationMin: stats.durationMin,
    };
    const activity = {
      ...item.activity,
      trackRef: track.ref,
      distanceKm: item.activity?.distanceKm ?? stats.distanceKm,
      ...(item.activity?.ascentM === undefined && stats.ascentM !== null ? { ascentM: stats.ascentM } : {}),
      ...(item.activity?.descentM === undefined && stats.descentM !== null ? { descentM: stats.descentM } : {}),
    };
    const nextItem = { ...item, activity };
    const writes: ElementWrite[] = [{ collection: "tracks", element: track, op: current === undefined ? "insert" : "update" }];
    if (current === undefined || JSON.stringify(item.activity) !== JSON.stringify(activity)) writes.push({ collection: "items", element: nextItem, op: "update" });
    return {
      doc: {
        ...doc,
        tracks: current === undefined ? [...doc.tracks, track] : doc.tracks.map((each) => (each.ref === track.ref ? track : each)),
        items: doc.items.map((each) => (each.ref === item.ref ? nextItem : each)),
      },
      writes,
      ok: `Zapisano ślad: ${stats.distanceKm.toLocaleString("pl-PL")} km${stats.ascentM !== null ? `, ↑ ${stats.ascentM} m` : ""}.`,
    };
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
