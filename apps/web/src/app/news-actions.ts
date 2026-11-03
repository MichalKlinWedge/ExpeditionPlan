"use server";

import { markNewsSeen } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/** „Przejrzane” w „Co nowego”: od teraz nowe są tylko późniejsze zmiany (web i telefon). */
export async function markTripNewsSeen(tripId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  try {
    await markNewsSeen(supabase as unknown as SupabaseClient, tripId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return {};
}
