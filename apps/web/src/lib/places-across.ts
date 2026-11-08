import { isDraft, type PlaceMemoryRow, placesAcrossTrips, type SharedPlace, type VisitedPlaceRow } from "@expeditionplan/core";
import { dbLoadError } from "@expeditionplan/sync";

import type { createClient } from "./supabase/server";

/**
 * Miejsca ze wszystkich moich wyjazdów (bez szkiców AI) razem z pamięcią miejsc (`place_memories`, RLS: moje
 * wpisy i te o miejscach z moich wyjazdów) i wizytami (`my_visited_places`: punkty planu, które już minęły).
 * Wspólne dla strony „Wszystkie miejsca” i „Zaplanuj z AI”.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Tyle wierszy naraz oddaje baza (`max_rows`), więc listy czytamy stronami. */
const PAGE = 1000;

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE - 1);
    if (error !== null) throw new Error(dbLoadError(error));
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

export async function loadPlacesAcross(supabase: Supabase): Promise<{ places: SharedPlace[]; memories: PlaceMemoryRow[]; visited: VisitedPlaceRow[] }> {
  const { data: mine, error } = await supabase.from("my_trips").select("id, title, start_date").order("start_date", { ascending: false });
  if (error) throw new Error(dbLoadError(error));
  const trips = mine.filter((trip) => !isDraft(trip)).map((trip) => ({ id: trip.id!, title: trip.title! }));
  const ids = trips.map((trip) => trip.id);

  const [places, items, guides, memories, visited] = await Promise.all([
    allRows((from, to) => supabase.from("places").select("id, trip_id, ref, name, address, lat, lng").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
    allRows((from, to) => supabase.from("items").select("id, trip_id, kind, place_id, leg").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
    allRows((from, to) => supabase.from("audio_guides").select("id, place_id, item_id, audience").in("trip_id", ids).is("deleted_at", null).order("id").range(from, to)),
    allRows((from, to) => supabase.from("place_memories").select("id, user_id, author_name, name, lat, lng, verdict, note, updated_at").order("id").range(from, to)),
    loadVisited(supabase),
  ]);
  return { places: placesAcrossTrips({ trips, places, items, guides }), memories, visited };
}

/** Moje odwiedzone miejsca (RPC `my_visited_places`): od nich zależy, co można ocenić, i lata wizyt. */
export async function loadVisited(supabase: Supabase): Promise<VisitedPlaceRow[]> {
  return allRows((from, to) => supabase.rpc("my_visited_places").order("place_id").range(from, to));
}
