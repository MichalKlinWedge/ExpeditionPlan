"use server";

import { requireUser } from "@/lib/auth";
import { type ClimateSource, climateSource } from "@/lib/climate-place";
import { pullTrip } from "@/lib/trip-snapshot";

/** Miejsce do klimatu terminu wyjazdu (`lib/climate-place.ts`), dla okien otwieranych na kliknięcie. */
export async function tripClimatePlace(tripId: string): Promise<ClimateSource> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  const pulled = await pullTrip(supabase, tripId);
  return pulled.error !== undefined ? { place: null, query: null } : climateSource(pulled.payload);
}
