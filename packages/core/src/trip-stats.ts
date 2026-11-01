/**
 * Statystyki wyjazdów na ekran Start (Pocket Guide) — z samej listy wyjazdów (daty), więc działają
 * offline. Daty to dni kalendarzowe `YYYY-MM-DD` (obie granice włącznie), `today` w strefie telefonu.
 */

export type TripSummary = { id: string; title: string; startDate: string; endDate: string };

export type TripStats = {
  total: number;
  upcoming: number;
  past: number;
  /** Wyjazd, który trwa dziś (przy kilku — ten, który zaczął się najpóźniej). */
  ongoing: { trip: TripSummary; dayNo: number; days: number } | null;
  /** Najbliższy nadchodzący wyjazd. */
  next: { trip: TripSummary; inDays: number; days: number } | null;
  /** Dni w podróży: zakończone wyjazdy i dotychczasowe dni trwającego. */
  daysTraveled: number;
  /** Dni zaplanowanych nadchodzących wyjazdów. */
  daysAhead: number;
  /** Dni w podróży w bieżącym roku kalendarzowym (zakończone i zaplanowane). */
  daysThisYear: number;
};

const DAY = 86_400_000;
const epochDay = (date: string) => Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY);
const span = (from: string, to: string) => Math.max(0, epochDay(to) - epochDay(from) + 1);

export function tripStats(trips: TripSummary[], today: string): TripStats {
  const now = epochDay(today);
  const year = today.slice(0, 4);
  const stats: TripStats = { total: trips.length, upcoming: 0, past: 0, ongoing: null, next: null, daysTraveled: 0, daysAhead: 0, daysThisYear: 0 };
  for (const trip of trips) {
    const start = epochDay(trip.startDate);
    const end = epochDay(trip.endDate);
    const days = span(trip.startDate, trip.endDate);
    // Część wyjazdu w bieżącym roku (wyjazd na przełomie lat liczy się częściowo).
    const yearFrom = trip.startDate.slice(0, 4) === year ? trip.startDate : `${year}-01-01`;
    const yearTo = trip.endDate.slice(0, 4) === year ? trip.endDate : `${year}-12-31`;
    if (yearFrom <= yearTo && trip.startDate <= `${year}-12-31` && trip.endDate >= `${year}-01-01`) stats.daysThisYear += span(yearFrom, yearTo);

    if (end < now) {
      stats.past++;
      stats.daysTraveled += days;
    } else if (start > now) {
      stats.upcoming++;
      stats.daysAhead += days;
      if (stats.next === null || start < epochDay(stats.next.trip.startDate)) stats.next = { trip, inDays: start - now, days };
    } else {
      stats.daysTraveled += now - start + 1;
      if (stats.ongoing === null || start > epochDay(stats.ongoing.trip.startDate)) stats.ongoing = { trip, dayNo: now - start + 1, days };
    }
  }
  return stats;
}

/** Dzisiejsza data `YYYY-MM-DD` w strefie urządzenia. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
