import { LIVE_BOOKING } from './plan-info.ts';
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

/** Miejsca użyte w planie (punkty, bazy dni, końce przejazdów, noclegi z rezerwacji) bez współrzędnych — z tytułami punktów, które ich używają. */
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
  for (const booking of doc.bookings) if (booking.kind === 'lodging' && LIVE_BOOKING.has(booking.status)) use(booking.startPlaceRef, `nocleg: ${booking.title}`);
  return doc.places
    .filter((place) => usedBy.has(place.ref) && (place.lat === undefined || place.lng === undefined))
    .map((place) => ({ ref: place.ref, name: place.name, ...(place.searchName ? { searchName: place.searchName } : {}), usedBy: [...new Set(usedBy.get(place.ref))] }));
}

/** Najwięcej punktów „Jedź przez” (Maps URLs przyjmują 9 punktów pośrednich). */
export const MAX_VIA_POINTS = 9;

/**
 * „Jedź przez” z pola tekstowego: jeden punkt w wierszu — współrzędne albo pełny link z mapy
 * (`parseCoordinates`). Wiersze, których nie da się odczytać, wracają w `bad`.
 */
export function parseViaPoints(text: string): { points: LatLng[]; bad: string[] } {
  const points: LatLng[] = [];
  const bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const point = parseCoordinates(line);
    if (point === null) bad.push(line.trim());
    else points.push({ lat: Math.round(point.lat * 1e6) / 1e6, lng: Math.round(point.lng * 1e6) / 1e6 });
  }
  return { points, bad };
}

/** Punkty „Jedź przez” do pola tekstowego, jeden w wierszu. */
export const viaPointsText = (points: readonly LatLng[] | undefined) => (points ?? []).map((point) => `${point.lat}, ${point.lng}`).join('\n');
