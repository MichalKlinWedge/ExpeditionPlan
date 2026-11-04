import { parseCoordinates } from './coordinates.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Miejsce rezerwacji noclegu z formularza: nazwa i współrzędne albo link z mapy. Nazwa znana w planie
 * wskazuje to samo miejsce (także przy punktach), nowa tworzy nowe, a poprzednie zostaje tam, gdzie
 * jest używane. Puste współrzędne niczego nie kasują: miejsce bez nich można przypiąć później w planie.
 */

type Place = TripDocument['places'][number];

export type BookingPlaceInput = { name: string; coordinates: string; title: string };

export type BookingPlace = {
  placeRef: string | undefined;
  places: Place[];
  /** Miejsce do zapisania; brak = bez zmian w miejscach. */
  write?: { place: Place; op: 'insert' | 'update' };
};

const round = (value: number) => Math.round(value * 1e5) / 1e5;
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

export const BAD_COORDINATES = 'Nie widzę tu współrzędnych. Wklej np. „31.6295, -7.9811” albo pełny link z Google Maps lub OpenStreetMap (krótki link maps.app.goo.gl trzeba najpierw otworzyć).';

/** Wynik albo komunikat dla użytkownika. `newId` to UUID nowego miejsca, gdyby było potrzebne. */
export function bookingPlace(doc: TripDocument, currentRef: string | undefined, input: BookingPlaceInput, newId: string): BookingPlace | string {
  const name = input.name.trim();
  const typed = input.coordinates.trim();
  if (name === '' && typed === '') return { placeRef: undefined, places: doc.places };

  const point = typed === '' ? undefined : parseCoordinates(typed);
  if (point === null) return BAD_COORDINATES;
  const at = point === undefined ? undefined : { lat: round(point.lat), lng: round(point.lng) };

  const current = doc.places.find((place) => place.ref === currentRef);
  const found = name === '' ? current : current !== undefined && sameName(current.name, name) ? current : doc.places.find((place) => sameName(place.name, name));

  if (found === undefined) {
    const place: Place = { ref: `id-${newId}`, name: name || input.title, ...(at ?? {}), provider: at === undefined ? 'unknown' : 'user', links: [] };
    return { placeRef: place.ref, places: [...doc.places, place], write: { place, op: 'insert' } };
  }
  // Formularz podaje dotychczasowe liczby: bez zmiany miejsce nie staje się ręczną pinezką.
  const moved = at !== undefined && (found.lat === undefined || found.lng === undefined || round(found.lat) !== at.lat || round(found.lng) !== at.lng);
  if (!moved) return { placeRef: found.ref, places: doc.places };
  const place: Place = { ...found, ...at, provider: 'user' };
  return { placeRef: place.ref, places: doc.places.map((each) => (each.ref === place.ref ? place : each)), write: { place, op: 'update' } };
}
