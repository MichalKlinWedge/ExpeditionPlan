import { boxAround, candidateQueries, distanceKm, FAR_OK, medianPoint, type PlaceInput, skipReason, tooCoarse } from './queries.ts';

/**
 * Ugruntowanie miejsc (SPECYFIKACJA §4, zasada 3): nazwa z planu → realne miejsce z OSM.
 * Czyste TS (przeglądarka, Node, Deno): źródło miejsc (`Lookup`) przychodzi z zewnątrz —
 * Geoapify w aplikacji, Nominatim/Photon z cache plikowym w narzędziach.
 */

export type GeocodeHit = { lat: number; lng: number; displayName: string; osmType: string; osmId: number; category: string; countryCode: string; openingHours?: string };

export type Box = { south: number; west: number; north: number; east: number };

/** Promień obszaru wyjazdu (km od mediany) według rodzaju wyjazdu z briefu. */
export const RADIUS_KM: Record<string, number> = { city: 25, outdoor: 60, region: 200, route: 400, base_camps: 180 };
export const HOME_COUNTRY = 'pl';

export type Lookup = (query: string, countries: string[], box?: Box) => Promise<GeocodeHit | null>;

export type GroundResult =
  | { ref: string; status: 'found'; hit: GeocodeHit; query: string; awayKm: number | null; home: boolean }
  | { ref: string; status: 'rejected'; hit: GeocodeHit; query: string; awayKm: number }
  | { ref: string; status: 'skipped'; reason: string }
  | { ref: string; status: 'not_found' };

export type GroundOptions = {
  /** Kraje wyjazdu (ISO, dowolna wielkość liter). */
  countries: string[];
  /** Rodzaj wyjazdu z briefu — wyznacza promień obszaru. */
  kind: string;
  lookup: Lookup;
  /** Drugie źródło (Photon) — tylko dla nieznalezionych, tylko w obszarze wyjazdu. */
  fallback?: Lookup;
  aliases?: Record<string, string[]>;
  /** Miejsca planu, które już mają współrzędne — liczą się do środka obszaru (uzupełnianie planu). */
  anchors?: { lat: number; lng: number }[];
};

export async function groundPlaces(places: PlaceInput[], options: GroundOptions): Promise<GroundResult[]> {
  const tripCountries = options.countries.map((code) => code.toLowerCase());
  const countries = [...new Set([...tripCountries, HOME_COUNTRY])];
  const radius = RADIUS_KM[options.kind] ?? 300;
  const results = new Map<string, GroundResult>();
  const found = new Map<string, { hit: GeocodeHit; query: string }>();

  const firstHit = async (place: PlaceInput, box?: Box, lookup: Lookup = options.lookup) => {
    for (const query of candidateQueries(place, options.aliases?.[place.ref])) {
      const hit = await lookup(query, countries, box);
      if (hit !== null && !tooCoarse(place.category, hit.category)) {
        return { hit, query: box === undefined ? query : `${query} [w obszarze]` };
      }
    }
    return null;
  };

  for (const place of places) {
    const skip = skipReason(place);
    if (skip !== null) {
      results.set(place.ref, { ref: place.ref, status: 'skipped', reason: skip });
      continue;
    }
    const match = await firstHit(place);
    if (match === null) results.set(place.ref, { ref: place.ref, status: 'not_found' });
    else found.set(place.ref, match);
  }

  // Trafienia w kraju domowym (lotnisko wylotu) nie liczą się do środka obszaru wyjazdu.
  const center = medianPoint([
    ...[...found.values()].filter(({ hit }) => tripCountries.includes(hit.countryCode)).map(({ hit }) => hit),
    ...(options.anchors ?? []),
  ]);

  // Trafienie poza obszarem: drugie podejście tylko w prostokącie wokół środka wyjazdu.
  if (center !== null) {
    for (const [ref, match] of found) {
      const place = places.find((each) => each.ref === ref)!;
      if (distanceKm(center, match.hit) <= radius || FAR_OK.has(place.category ?? '')) continue;
      const again = await firstHit(place, boxAround(center, radius));
      if (again !== null) found.set(ref, again);
    }
    if (options.fallback !== undefined) {
      for (const place of places) {
        if (results.get(place.ref)?.status !== 'not_found') continue;
        const rescue = await firstHit(place, boxAround(center, radius), options.fallback);
        if (rescue !== null) {
          results.delete(place.ref);
          found.set(place.ref, rescue);
        }
      }
    }
  }

  const homeTrip = tripCountries.includes(HOME_COUNTRY);
  for (const [ref, match] of found) {
    const place = places.find((each) => each.ref === ref)!;
    const awayKm = center === null ? null : distanceKm(center, match.hit);
    const farOk = FAR_OK.has(place.category ?? '');
    // Kraj domowy tylko dla lotniska/miasta wylotu — „UNESCO” w Bieszczadach to pomyłka, nie dom.
    const home = match.hit.countryCode === HOME_COUNTRY && !homeTrip && farOk;
    const inArea = (match.hit.countryCode !== HOME_COUNTRY || homeTrip) && (awayKm === null || awayKm <= radius || farOk);
    results.set(
      ref,
      home || inArea
        ? { ref, status: 'found', hit: match.hit, query: match.query, awayKm, home }
        : { ref, status: 'rejected', hit: match.hit, query: match.query, awayKm: awayKm ?? 0 },
    );
  }

  return places.map((place) => results.get(place.ref)!);
}

export function describeResult(result: GroundResult, name: string): string {
  switch (result.status) {
    case 'skipped':
      return `  - ${result.ref}: pominięte (${result.reason})`;
    case 'not_found':
      return `  ? ${result.ref}: nie znaleziono („${name}”)`;
    default: {
      const where = result.status === 'found' && result.home ? '(dom)' : `${Math.round(result.awayKm ?? 0)} km`;
      const mark = result.status === 'found' ? '+' : '!';
      return `  ${mark} ${result.ref}: ${result.hit.lat.toFixed(4)},${result.hit.lng.toFixed(4)} ${where} ← „${result.query}” → ${result.hit.displayName}`;
    }
  }
}

type Coordinated = { lat?: number; lng?: number; provider?: string; openingHours?: string; [key: string]: unknown };

/** Współrzędne wstawione zaraz po `category` (albo `name`), żeby diff pliku był czytelny. */
export function withCoordinates<T extends Coordinated>(place: T, hit: GeocodeHit, options: { openingHours?: boolean } = {}): T {
  const after = 'category' in place ? 'category' : 'name';
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(place)) {
    if (key === 'lat' || key === 'lng' || key === 'provider') continue;
    result[key] = value;
    if (key === after) {
      result.lat = Math.round(hit.lat * 1e5) / 1e5;
      result.lng = Math.round(hit.lng * 1e5) / 1e5;
      result.provider = 'osm';
    }
  }
  if (options.openingHours && hit.openingHours !== undefined && result.openingHours === undefined) {
    result.openingHours = hit.openingHours;
  }
  return result as T;
}
