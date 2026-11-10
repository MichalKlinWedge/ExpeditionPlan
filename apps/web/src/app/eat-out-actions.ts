"use server";

import { type EateryAnswer, type EateryKind, type SearchCenter, TripBrief, type TripDocument } from "@expeditionplan/core";
import { type EateryDiet, eateriesForMeal, findEateries, geoapifyLookup, wikivoyageListings } from "@expeditionplan/planner";
import { type PullPayload, stateFromPayload } from "@expeditionplan/sync";

import { aiAccessError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { countriesFor } from "@/lib/countries";
import { memoriesFor } from "@/lib/eatery-memories";

/**
 * „Knajpy w pobliżu” posiłku (strona Posiłki): Geoapify Places wokół miejsca posiłku, drogi między
 * punktami dnia albo wpisanej okolicy, z poleceniami Wikivoyage i naszymi ocenami (`eateriesForMeal`).
 * Tylko wyszukiwanie — wybrane knajpy zapisuje przeglądarka (`saveElements`, o prawie decyduje RLS).
 */

export async function findRestaurants(
  tripId: string,
  itemRef: string,
  options: { kinds: EateryKind[]; radiusM: number; diet?: EateryDiet; near?: string },
): Promise<EateryAnswer> {
  const key = process.env.GEOAPIFY_API_KEY ?? "";
  if (key === "") return { error: "Serwer nie ma klucza GEOAPIFY_API_KEY." };
  const { supabase } = await requireUser(`/trips/${tripId}/meals`);
  const denied = await aiAccessError();
  if (denied) return { error: denied };
  const [{ data, error }, trip, briefRow] = await Promise.all([
    supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 }),
    supabase.from("my_trips").select("primary_tz").eq("id", tripId).maybeSingle(),
    supabase.from("trip_brief").select("brief").eq("trip_id", tripId).maybeSingle(),
  ]);
  if (error || data === null) return { error: error?.message ?? "Nie ma takiego wyjazdu." };
  let doc: TripDocument;
  try {
    doc = stateFromPayload(data as PullPayload).doc;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  let center: SearchCenter | undefined;
  const near = options.near?.trim().slice(0, 200) ?? "";
  if (near !== "") {
    const brief = TripBrief.safeParse(briefRow.data?.brief);
    const countries = countriesFor(brief.success ? brief.data : null, trip.data?.primary_tz ?? "");
    if (countries.length === 0) return { error: "Nie wiem, w jakim kraju szukać — podaj kraj w briefie wyjazdu." };
    try {
      const hit = await geoapifyLookup(key)(near, countries);
      if (hit === null) return { error: `Nie znaleziono „${near}”.` };
      center = { lat: hit.lat, lng: hit.lng, near: hit.displayName || near };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return eateriesForMeal(doc, itemRef, { kinds: options.kinds, radiusM: options.radiusM, ...(options.diet ? { diet: options.diet } : {}), ...(center ? { center } : {}) }, {
    search: (search) => findEateries(key, search),
    tips: (area) => wikivoyageListings(area),
    memories: (keys) => memoriesFor(supabase, keys),
  });
}
