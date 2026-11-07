"use server";

import { isRealDate, shiftTripDates, type TripShiftReview } from "@expeditionplan/core";
import { dbErrorMessage, type PullPayload, refIndex, rescheduleTrip, stateFromPayload } from "@expeditionplan/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";

import { requireUser } from "@/lib/auth";

/**
 * „Zmień termin” na stronie wyjazdu. Podgląd i zapis liczą to samo (`shiftTripDates`) ze świeżej
 * migawki, a zapis przekazuje wersję podglądu: jeśli plan zmienił się po drodze, użytkownik dostaje
 * nowy podgląd zamiast zatwierdzać zmiany, których nie widział. Uprawnienia sprawdza RPC.
 */

export type ReschedulePreview = {
  version: number;
  startDate: string;
  endDate: string;
  offsetDays: number;
  moved: { days: number; bookings: number; tasks: number; decisions: number; travelers: number };
  review: TripShiftReview;
  /** Wydatki, wpisy dziennika i zdarzenia z trasy: fakty przy swoich datach. */
  realEvents: number;
};

export type RescheduleResult = { error?: string; preview?: ReschedulePreview; ok?: boolean };

const STALE = "Plan zmienił się w międzyczasie — sprawdź podgląd jeszcze raz.";

async function snapshot(supabase: SupabaseClient, tripId: string, startDate: string) {
  const { data, error } = await supabase.rpc("pull_changes", { p_trip: tripId, p_since: 0 });
  if (error) throw new Error(dbErrorMessage(error));
  if (data === null) throw new Error("Nie ma takiego wyjazdu.");
  const payload = data as PullPayload;
  const shift = shiftTripDates(stateFromPayload(payload).doc, startDate);
  const alive = (table: string) => (payload.tables[table] ?? []).filter((row) => row.deleted_at === null).length;
  const preview: ReschedulePreview = {
    version: payload.version,
    startDate: shift.startDate,
    endDate: shift.endDate,
    offsetDays: shift.offsetDays,
    moved: { days: shift.moved.days.length, bookings: shift.moved.bookings.length, tasks: shift.moved.tasks.length, decisions: shift.moved.variantGroups.length, travelers: shift.moved.travelers.length },
    review: shift.review,
    realEvents: alive("expenses") + alive("journal_entries") + alive("schedule_events"),
  };
  return { payload, shift, preview };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : "Nie udało się policzyć zmiany terminu.");

export async function previewReschedule(tripId: string, startDate: string): Promise<RescheduleResult> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  if (!isRealDate(startDate)) return { error: "Podaj poprawną datę." };
  try {
    return { preview: (await snapshot(supabase, tripId, startDate)).preview };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function applyReschedule(tripId: string, startDate: string, version: number, restore: boolean): Promise<RescheduleResult> {
  const { supabase } = await requireUser(`/trips/${tripId}`);
  if (!isRealDate(startDate)) return { error: "Podaj poprawną datę." };
  try {
    const { payload, shift, preview } = await snapshot(supabase, tripId, startDate);
    if (payload.version !== version) return { error: STALE, preview };
    try {
      await rescheduleTrip(supabase, tripId, {
        version,
        shift,
        ids: refIndex(payload.tables),
        briefs: (payload.tables.trip_brief ?? []) as { id: string; brief?: unknown; deleted_at: string | null }[],
        restore,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "EP001") return { error: STALE, preview: (await snapshot(supabase, tripId, startDate)).preview };
      throw error;
    }
  } catch (error) {
    return { error: describe(error) };
  }
  refresh();
  return { ok: true };
}
