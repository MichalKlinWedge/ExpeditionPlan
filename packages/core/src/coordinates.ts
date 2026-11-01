import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Ręczne przypinanie miejsca: współrzędne wklejone tak, jak je kopiuje człowiek — „31.6295, -7.9811”,
 * link z Google Maps (`@31.62,-7.98,17z`, `?q=31.62,-7.98`, `!3d31.62!4d-7.98`), z OpenStreetMap
 * (`#map=17/31.62/-7.98`, `?mlat=…&mlon=…`) albo `geo:31.62,-7.98`. Krótkich linków
 * (`maps.app.goo.gl`) nie rozwijamy — trzeba otworzyć i skopiować pełny adres albo współrzędne.
 */

export type LatLng = { lat: number; lng: number };

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;

const PATTERNS: RegExp[] = [
  // Google: miejsce z dokładnymi współrzędnymi pinezki (ważniejsze niż środek widoku `@`).
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  // OpenStreetMap: pinezka, potem środek mapy.
  /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/,
  /#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,
  /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  // Same liczby: „31.6295, -7.9811”, „31.6295 -7.9811”, „31,6295; -7,9811” (polski przecinek).
  /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/,
];

/** Współrzędne z wklejonego tekstu albo linku; `null`, gdy nic nie pasuje. */
export function parseCoordinates(text: string): LatLng | null {
  const input = text.trim();
  for (const pattern of PATTERNS) {
    const match = pattern.exec(input);
    if (match === null) continue;
    const found = valid(Number(match[1]!.replace(',', '.')), Number(match[2]!.replace(',', '.')));
    if (found !== null) return found;
  }
  return null;
}

/** Miejsca użyte w planie (punkty, bazy dni, końce przejazdów) bez współrzędnych — z tytułami punktów, które ich używają. */
export function placesOffMap(doc: TripDocument): { ref: string; name: string; searchName?: string; usedBy: string[] }[] {
  const usedBy = new Map<string, string[]>();
  const use = (ref: string | undefined, what: string) => {
    if (ref === undefined) return;
    usedBy.set(ref, [...(usedBy.get(ref) ?? []), what]);
  };
  for (const item of doc.items) {
    use(item.placeRef, item.title);
    use(item.leg?.fromPlaceRef, item.title);
    use(item.leg?.toPlaceRef, item.title);
  }
  for (const day of doc.days) use(day.baseRef, `baza dnia ${day.date}`);
  return doc.places
    .filter((place) => usedBy.has(place.ref) && (place.lat === undefined || place.lng === undefined))
    .map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}), usedBy: [...new Set(usedBy.get(place.ref))] }));
}
