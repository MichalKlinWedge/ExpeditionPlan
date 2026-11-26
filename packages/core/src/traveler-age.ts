import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Wiek uczestnika liczony z roku urodzenia (`DocTraveler.birthYear`, `travelers.birth_year`) na początek
 * wyjazdu, więc zgadza się także przy planach na kolejne lata. Bez dnia urodzin: rok daty − rok urodzenia
 * (osoba, która urodziny ma później w roku, wychodzi o rok starsza).
 */

type Doc = Pick<TripDocument, 'trip' | 'travelers'>;
type Traveler = TripDocument['travelers'][number];

/** Wiek w roku podanej daty (`YYYY-MM-DD`); bez roku urodzenia — brak. */
export function ageOn(birthYear: number | undefined, date: string): number | undefined {
  if (birthYear === undefined) return undefined;
  return Math.max(0, Number(date.slice(0, 4)) - birthYear);
}

/** Wiek uczestnika na początku wyjazdu. */
export const travelerAge = (doc: Doc, traveler: Traveler): number | undefined => ageOn(traveler.birthYear, doc.trip.startDate);

/** Uczestnicy z wiekiem na początku wyjazdu — do progów cen, porcji i składu grupy. */
export const travelersWithAge = (doc: Doc, travelers: Traveler[] = doc.travelers): (Traveler & { age?: number })[] =>
  travelers.map((traveler) => {
    const age = travelerAge(doc, traveler);
    return age === undefined ? traveler : { ...traveler, age };
  });

/** Rok urodzenia z wieku podanego na daną datę (brief, dawne dane). */
export const birthYearFromAge = (age: number, date: string): number => Number(date.slice(0, 4)) - age;
