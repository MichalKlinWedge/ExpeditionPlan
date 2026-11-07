"use server";

import { type Eatery, eaterySummary, type EateryKind, mealSearchCenter, mealSlot, metersBetween, type OpenAtMeal, openAtMeal, type SearchCenter, TripBrief, type TripDocument } from "@expeditionplan/core";
import { type EateryDiet, findEateries, geoapifyLookup } from "@expeditionplan/planner";
import { type PullPayload, stateFromPayload } from "@expeditionplan/sync";

import { aiAccessError } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { countriesFor } from "@/lib/countries";

/**
 * „Knajpy w pobliżu” posiłku (strona Posiłki): Geoapify Places wokół miejsca posiłku albo
 * najbliższego punktu dnia (`mealSearchCenter`), albo wokół wpisanej okolicy. Tylko wyszukiwanie —
 * wybrane knajpy zapisuje przeglądarka (`saveElements`, o prawie decyduje RLS).
 */

export type EateryResult = Eatery & { distanceM: number; open: OpenAtMeal; summary: string };
export type EateryAnswer = { error: string } | { center: SearchCenter; results: EateryResult[] };

const KINDS = new Set<EateryKind>(["restaurant", "fast_food", "cafe", "pub", "hut"]);
const DIETS = new Set<EateryDiet>(["vegetarian", "vegan", "gluten_free", "halal"]);
const OPEN_FIRST = { open: 0, partly: 1, unknown: 2, closed: 3 } as const;

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
  if (!doc.items.some((item) => item.ref === itemRef)) return { error: "Tego posiłku już nie ma — odśwież stronę." };

  let center = mealSearchCenter(doc, itemRef);
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
  if (center === null) return { error: "Posiłek nie ma miejsca, a punkty dnia nie mają współrzędnych — wpisz okolicę (np. ulicę albo zabytek)." };

  const kinds = options.kinds.filter((kind) => KINDS.has(kind));
  const radiusM = Math.min(Math.max(Math.round(options.radiusM) || 1000, 200), 5000);
  let found: Eatery[];
  try {
    found = await findEateries(key, { lat: center.lat, lng: center.lng, radiusM, kinds, ...(options.diet && DIETS.has(options.diet) ? { diet: options.diet } : {}) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const slot = mealSlot(doc, itemRef);
  const results = found
    .map((eatery) => {
      const open = openAtMeal(eatery.openingHours, slot);
      return { ...eatery, distanceM: metersBetween(center, eatery), open, summary: eaterySummary(eatery, center, open) };
    })
    .sort((a, b) => OPEN_FIRST[a.open.state] - OPEN_FIRST[b.open.state] || a.distanceM - b.distanceM);
  return { center, results };
}
