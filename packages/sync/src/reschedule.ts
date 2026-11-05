import { shiftBriefDates, type TripShift } from '@expeditionplan/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import { RemoteError } from './remote.ts';

/**
 * Zapis zmiany terminu (`shiftTripDates` w core) przez RPC `reschedule_trip`: jedna transakcja na
 * wszystkie tabele. `version` to `sync_version` migawki, z której policzono `shift` — jeśli plan
 * zmienił się po drodze, baza odrzuca zapis (kod EP001), bo nowych elementów nie ma w zmianach.
 */
export type RescheduleInput = {
  version: number;
  shift: TripShift;
  /** ref → id z migawki (`refIndex`). */
  ids: Record<string, string>;
  /** Wiersze `trip_brief` z migawki: brief jest poza `TripDocument`. */
  briefs?: { id: string; brief?: unknown; deleted_at?: string | null }[];
  /** Powrót z „Odłożonych” razem z nowym terminem. */
  restore?: boolean;
};

export function rescheduleChanges({ shift, ids, briefs = [] }: Omit<RescheduleInput, 'version' | 'restore'>) {
  const { doc, moved } = shift;
  const pick = <T extends { ref?: string }>(elements: T[], refs: string[]) => {
    const wanted = new Set(refs);
    return elements.filter((element) => element.ref !== undefined && wanted.has(element.ref));
  };
  return {
    days: pick(doc.days, moved.days).map((day) => ({ id: ids[day.ref]!, date: day.date })),
    bookings: pick(doc.bookings, moved.bookings).map((booking) => ({
      id: ids[booking.ref]!,
      start_date: booking.start?.date ?? null,
      end_date: booking.end?.date ?? null,
      free_cancellation_until: booking.freeCancellationUntil ?? null,
    })),
    tasks: pick(doc.tasks, moved.tasks).map((task) => ({ id: ids[task.ref]!, due: task.due ?? null })),
    variant_groups: pick(doc.variantGroups, moved.variantGroups).map((group) => ({ id: ids[group.ref]!, decide_by: group.decideBy ?? null })),
    travelers: pick(doc.travelers, moved.travelers).map((traveler) => ({ id: ids[traveler.ref]!, from_date: traveler.fromDate ?? null, to_date: traveler.toDate ?? null })),
    trip_brief: briefs
      .filter((row) => (row.deleted_at ?? null) === null)
      .flatMap((row) => {
        const brief = shiftBriefDates(row.brief, shift.offsetDays);
        return brief === null ? [] : [{ id: row.id, brief }];
      }),
  };
}

export async function rescheduleTrip(client: SupabaseClient, tripId: string, input: RescheduleInput): Promise<void> {
  const { error } = await client.rpc('reschedule_trip', {
    p_trip: tripId,
    p_version: input.version,
    p_start: input.shift.startDate,
    p_end: input.shift.endDate,
    p_changes: rescheduleChanges(input),
    p_restore: input.restore ?? false,
  });
  if (error) throw new RemoteError(error.code === '42501' ? 'Brak uprawnień do zmiany terminu.' : error.message, error.code);
}
