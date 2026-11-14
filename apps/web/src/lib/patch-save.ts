import "server-only";

import { TripBrief, TripDocument } from "@expeditionplan/core";
import { changedBookings, changedPlaces, geoapifyLookup, groundPlaces, patchDiff, withCoordinates } from "@expeditionplan/planner";
import { dbErrorMessage, lockedRefs, type PullPayload, refIndex, saveElements, saveMergeEdit, stateFromPayload } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth";
import { countriesFor } from "@/lib/countries";

/** Plan do łatki AI: świeży dokument, punkty zmienione ręcznie i brief; tylko organizator albo edytor. */
export async function loadForPatch(tripId: string, path: string, denied: string) {
  const { supabase } = await requireUser(path);
  const [pulled, membership, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("role").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (pulled.error) return { error: dbErrorMessage(pulled.error) } as const;
  if (pulled.data === null) return { error: "Nie ma takiego wyjazdu." } as const;
  if (membership.data?.role !== "owner" && membership.data?.role !== "editor") return { error: denied } as const;
  const payload = pulled.data as PullPayload;
  const brief = TripBrief.safeParse(briefRow.data?.brief);
  return { supabase, payload, doc: stateFromPayload(payload).doc, locked: lockedRefs(payload.tables), brief: brief.success ? brief.data : null } as const;
}

/**
 * Zapis planu po łatce AI (dostrajanie, przegląd planu): miejsca nowe i te z nową nazwą do
 * wyszukania (`set_place`) idą do Geoapify, potem różnica przez `saveMergeEdit`, a zmienione
 * miejsca osobno (`saveElements`). Błąd usługi miejsc nie blokuje zapisu — zostaje nazwa do
 * wyszukania, a „Uzupełnij współrzędne” albo ręczne przypięcie dokończą.
 */
export async function savePatchedPlan(
  supabase: SupabaseClient,
  tripId: string,
  loaded: { payload: PullPayload; doc: TripDocument; brief: TripBrief | null },
  patched: TripDocument,
): Promise<{ error: string } | { regrounded: number; notFound: string[] }> {
  let doc = patched;
  const before = new Map(loaded.doc.places.map((place) => [place.ref, place]));
  const toGround = doc.places.filter((place) => {
    const was = before.get(place.ref);
    return was === undefined || (place.provider !== "user" && was.searchName !== place.searchName);
  });
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  const countries = countriesFor(loaded.brief, doc.trip.primaryTz);
  let regrounded = 0;
  // Miejsca planu z nową nazwą do wyszukania, których wyszukiwarka nie znalazła — do komunikatu.
  let notFound = toGround.filter((place) => before.has(place.ref)).map((place) => place.name);
  if (toGround.length > 0 && key !== "" && countries.length > 0) {
    try {
      const anchors = doc.places.flatMap((place) => (place.lat !== undefined && place.lng !== undefined && !toGround.includes(place) ? [{ lat: place.lat, lng: place.lng }] : []));
      const found = await groundPlaces(
        toGround.map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}) })),
        { countries, kind: loaded.brief?.location.kind ?? "region", lookup: geoapifyLookup(key), anchors },
      );
      doc = {
        ...doc,
        places: doc.places.map((place) => {
          const hit = found.find((result) => result.ref === place.ref);
          if (hit?.status !== "found") return place;
          if (before.has(place.ref)) {
            regrounded++;
            notFound = notFound.filter((name) => name !== place.name);
          }
          return withCoordinates(place, hit.hit, { openingHours: true });
        }),
      };
    } catch {
      // bez współrzędnych — zostaje nazwa do wyszukania
    }
  }
  const checked = TripDocument.safeParse(doc);
  if (!checked.success) return { error: `Nie zapisano: ${checked.error.issues[0]?.message ?? ""}` };
  try {
    const ids = await saveMergeEdit(supabase, tripId, patchDiff(loaded.doc, checked.data), refIndex(loaded.payload.tables));
    const places = changedPlaces(loaded.doc, checked.data);
    if (places.length > 0) await saveElements(supabase, tripId, checked.data, places.map((element) => ({ collection: "places" as const, element, op: "update" as const })), ids);
    const bookings = changedBookings(loaded.doc, checked.data);
    if (bookings.length > 0) await saveElements(supabase, tripId, checked.data, bookings.map((element) => ({ collection: "bookings" as const, element, op: "update" as const })), ids);
  } catch (e) {
    return { error: `Nie zapisano: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { regrounded, notFound };
}
