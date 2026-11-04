/**
 * Wyjazd odłożony (`trips.status = 'postponed'`): termin niepewny albo wyjazd nie wypalił. Daty
 * zostają orientacyjne, więc to status, a nie data decyduje o sekcji listy: odłożony nie trafia ani
 * do wyjazdów przed nami, ani do archiwum, nie odlicza dni i nie przypomina na telefonie.
 */

export const POSTPONED = 'postponed';

/** Status po przywróceniu (domyślny w bazie). */
export const PLANNING = 'planning';

export const isPostponed = (trip: { status?: string | null }) => trip.status === POSTPONED;

type Listed = { status?: string | null; start_date: string | null; end_date: string | null };

/** Sekcje listy wyjazdów: przed nami (w kolejności listy), odłożone (wg terminu), archiwum (najnowsze na górze). */
export function tripSections<T extends Listed>(trips: T[], today: string): { ahead: T[]; postponed: T[]; archive: T[] } {
  const planned = trips.filter((trip) => !isPostponed(trip));
  const byStart = (a: T, b: T) => (a.start_date ?? '').localeCompare(b.start_date ?? '');
  return {
    ahead: planned.filter((trip) => (trip.end_date ?? '') >= today),
    postponed: trips.filter(isPostponed).sort(byStart),
    archive: planned.filter((trip) => (trip.end_date ?? '') < today).sort((a, b) => byStart(b, a)),
  };
}
