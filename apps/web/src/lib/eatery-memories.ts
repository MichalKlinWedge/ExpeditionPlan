import type { PlaceMemoryRow } from "@expeditionplan/core";
import type { Database } from "@expeditionplan/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nasze oceny „warto / nie warto” lokali o tych kluczach nazw (`plainName` = SQL `place_key`) do wyników
 * „Knajpy w pobliżu”. RLS pokazuje moje wpisy i te z miejsc moich wyjazdów (`can_see_place_memory`).
 */
export async function memoriesFor(supabase: SupabaseClient<Database>, keys: string[]): Promise<PlaceMemoryRow[]> {
  const { data, error } = await supabase.from("place_memories").select("id, user_id, author_name, name, lat, lng, verdict, note, updated_at").in("name_key", keys.slice(0, 200));
  if (error) throw new Error(error.message);
  return data ?? [];
}
