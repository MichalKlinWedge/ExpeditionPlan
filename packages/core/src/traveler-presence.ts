/**
 * Zakres dat uczestnika, który nie jedzie na cały wyjazd. Puste pole albo data równa początkowi
 * lub końcowi wyjazdu nie jest zapisywana: brak dat znaczy „cały wyjazd”.
 */
export type TravelerDates = { fromDate: string | null; toDate: string | null };

export function travelerDates(from: string | undefined, to: string | undefined, trip: { startDate: string; endDate: string }): TravelerDates | { error: string } {
  const fromDate = from || null;
  const toDate = to || null;
  if (fromDate !== null && toDate !== null && fromDate > toDate) return { error: 'Data „od” jest po dacie „do”.' };
  for (const date of [fromDate, toDate]) {
    if (date !== null && (date < trip.startDate || date > trip.endDate)) return { error: `Daty muszą mieścić się w terminie wyjazdu (${trip.startDate} – ${trip.endDate}).` };
  }
  return { fromDate: fromDate === trip.startDate ? null : fromDate, toDate: toDate === trip.endDate ? null : toDate };
}
