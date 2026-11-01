import type { Box, GeocodeHit, Lookup } from './ground.ts';

/**
 * Geoapify Geocoding (dane OSM) jako źródło miejsc aplikacji — docs/USLUGI.md: 3000 kredytów
 * dziennie, 5 zapytań/s, wyniki wolno przechowywać, atrybucja „© OpenStreetMap, Geoapify”.
 * Klucz tylko po stronie serwera.
 */

const ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
/** Odstęp między zapytaniami: limit 5/s z zapasem. */
const GAP_MS = 220;

type Result = {
  lat?: number;
  lon?: number;
  formatted?: string;
  result_type?: string;
  country_code?: string;
  /** Pewność dopasowania tekstu 0–1; 0 = Geoapify zgadł („Plaża Sidi Kaouki” → „Poznań Plaza”). */
  rank?: { confidence?: number };
  datasource?: { sourcename?: string; raw?: { osm_id?: number; osm_type?: string; opening_hours?: string } };
};

/** Poniżej tej pewności wynik to zgadywanie, nie trafienie — lepiej brak niż złe miasto. */
export const MIN_CONFIDENCE = 0.2;

/** Obszary administracyjne Geoapify ↔ klasa `place`/`boundary` z Nominatim (dla `tooCoarse`). */
const AREAS = new Set(['city', 'county', 'state', 'country', 'suburb', 'district', 'postcode', 'locality']);

export function geoapifyHit(result: Result): GeocodeHit | null {
  if (typeof result.lat !== 'number' || typeof result.lon !== 'number') return null;
  const raw = result.datasource?.raw ?? {};
  return {
    lat: result.lat,
    lng: result.lon,
    displayName: result.formatted ?? '',
    osmType: raw.osm_type ?? '',
    osmId: raw.osm_id ?? 0,
    category: AREAS.has(result.result_type ?? '') ? 'place' : (result.result_type ?? 'unknown'),
    countryCode: result.country_code ?? '',
    ...(raw.opening_hours ? { openingHours: raw.opening_hours } : {}),
  };
}

export function geoapifyLookup(apiKey: string, fetchImpl: typeof fetch = fetch): Lookup {
  let queue: Promise<void> = Promise.resolve();
  const throttle = () => {
    const turn = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, GAP_MS)));
    queue = turn;
    return turn;
  };
  return async (query: string, countries: string[], box?: Box) => {
    await throttle();
    const filters = [`countrycode:${countries.map((code) => code.toLowerCase()).join(',')}`];
    if (box !== undefined) filters.push(`rect:${box.west},${box.south},${box.east},${box.north}`);
    const params = new URLSearchParams({ text: query, format: 'json', limit: '1', lang: 'pl', filter: filters.join('|'), apiKey });
    const response = await fetchImpl(`${ENDPOINT}?${params.toString()}`);
    if (!response.ok) throw new Error(`Geoapify ${response.status} dla „${query}”`);
    const body = (await response.json()) as { results?: Result[] };
    const first = body.results?.[0];
    if (first === undefined || (first.rank?.confidence !== undefined && first.rank.confidence < MIN_CONFIDENCE)) return null;
    return geoapifyHit(first);
  };
}
