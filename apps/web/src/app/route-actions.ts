"use server";

import { attachRoute, carRouteFromItem, detachRoute, DocTrack, newRoute, removeRoute, trackEndsNote, TripDocument } from "@expeditionplan/core";
import { type ElementWrite, refIndex, saveElements, savePlanEdit, stateFromPayload, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/app/actions";
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
  return commit(tripId, `/trips/${tripId}/routes`, (doc) => {
    const created = newRoute(doc, `id-${uuidv7()}`, parsed.data);
    if (typeof created === "string") return created;
    return { doc: created.doc, writes: [{ collection: "tracks", element: created.track, op: "insert" }], ok: `Dodano trasę „${created.track.name}”.` };
  });
}
