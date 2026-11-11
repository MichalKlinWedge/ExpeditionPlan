/**
 * Wyjazd odłożony (`trips.status = 'postponed'`): termin niepewny albo wyjazd nie wypalił. Daty
 * zostają orientacyjne, więc to status, a nie data decyduje o sekcji listy: odłożony nie trafia ani
 * do wyjazdów przed nami, ani do archiwum, nie odlicza dni i nie przypomina na telefonie.
 */

import { plainName } from './place-list.ts';

export const POSTPONED = 'postponed';

/** Status po przywróceniu (domyślny w bazie). */
export const PLANNING = 'planning';

export const isPostponed = (trip: { status?: string | null }) => trip.status === POSTPONED;

/** Szkic z „Zaplanuj z AI” to osobny wyjazd rozpoznawany po początku tytułu. */
export const DRAFT_PREFIX = 'Szkic AI: ';

export const isDraft = (trip: { title?: string | null }) => trip.title?.startsWith(DRAFT_PREFIX) === true;

type Listed = { title?: string | null; status?: string | null; start_date: string | null; end_date: string | null };

/** Sekcje listy wyjazdów: przed nami (w kolejności listy), odłożone (wg terminu), archiwum (najnowsze na górze), szkice AI (wg terminu, bez względu na datę i status). */
export function tripSections<T extends Listed>(trips: T[], today: string): { ahead: T[]; postponed: T[]; archive: T[]; drafts: T[] } {
  const real = trips.filter((trip) => !isDraft(trip));
  const planned = real.filter((trip) => !isPostponed(trip));
  const byStart = (a: T, b: T) => (a.start_date ?? '').localeCompare(b.start_date ?? '');
  return {
    ahead: planned.filter((trip) => (trip.end_date ?? '') >= today),
    postponed: real.filter(isPostponed).sort(byStart),
    archive: planned.filter((trip) => (trip.end_date ?? '') < today).sort((a, b) => byStart(b, a)),
    drafts: trips.filter(isDraft).sort(byStart),
  };
}

const words = (name: string) => new Set(plainName(name).split(' ').filter((word) => word !== ''));

const bigrams = (name: string) => {
  const plain = plainName(name).replaceAll(' ', '');
  return new Set(Array.from({ length: Math.max(plain.length - 1, 0) }, (_, at) => plain.slice(at, at + 2)));
};

/** Współczynnik Dice'a dwóch zbiorów (0–1). */
const dice = (a: Set<string>, b: Set<string>) => (a.size + b.size === 0 ? 0 : (2 * [...a].filter((each) => b.has(each)).length) / (a.size + b.size));

/**
 * Jak bardzo nazwa szkicu (bez „Szkic AI: ”) pasuje do nazwy planu: 1 = ta sama (bez wielkości liter,
 * polskich znaków i interpunkcji), inaczej wspólne słowa, a przy remisie wspólne pary liter.
 */
export function draftNameScore(planTitle: string, draftTitle: string): number {
  const name = draftTitle.startsWith(DRAFT_PREFIX) ? draftTitle.slice(DRAFT_PREFIX.length) : draftTitle;
  if (plainName(name) === plainName(planTitle)) return 1;
  return 0.8 * dice(words(name), words(planTitle)) + 0.19 * dice(bigrams(name), bigrams(planTitle));
}

/**
 * Szkice do porównania z planem: tylko szkice AI, od najlepiej pasującego nazwą (przy równych wg
 * kolejności wejścia); `best` to ten pierwszy, o ile w ogóle coś ma wspólnego z nazwą planu.
 */
export function draftsForPlan<T extends { title?: string | null }>(planTitle: string, trips: T[]): { drafts: T[]; best: T | undefined } {
  const scored = trips.filter(isDraft).map((trip, at) => ({ trip, at, score: draftNameScore(planTitle, trip.title!) }));
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  const drafts = scored.map((each) => each.trip);
  return { drafts, best: scored[0] !== undefined && scored[0].score > 0 ? scored[0].trip : undefined };
}
