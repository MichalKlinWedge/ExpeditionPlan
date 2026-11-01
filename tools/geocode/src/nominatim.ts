/**
 * Publiczny Nominatim (OSMF) według zasad z docs/USLUGI.md: najwyżej 1 zapytanie na sekundę,
 * identyfikujący User-Agent, wyniki w cache — to narzędzie jednorazowe dla planów wzorcowych,
 * nie usługa aplikacji (w aplikacji geokodowanie idzie przez Geoapify).
 */

import type { Box, GeocodeHit } from '@expeditionplan/planner';

export const USER_AGENT = 'ExpeditionPlan-fixtures/0.1 (+https://github.com/MichalKlinWedge/ExpeditionPlan)';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const GAP_MS = 1100;

let queue: Promise<void> = Promise.resolve();

/** Kolejka: zapytania idą jedno po drugim co `GAP_MS`, także gdy woła je kilka planów naraz. */
function throttle(): Promise<void> {
  const turn = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, GAP_MS)));
  queue = turn;
  return turn;
}

/** `box` = szukaj tylko w tym prostokącie (imiennicy: Orlica w górach, a nie pod Szczecinem). */
export async function searchNominatim(query: string, countryCodes: string[], box?: Box): Promise<GeocodeHit | null> {
  await throttle();
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    countrycodes: countryCodes.join(','),
    'accept-language': 'pl,en',
    addressdetails: '1',
    extratags: '1',
    ...(box === undefined ? {} : { viewbox: `${box.west},${box.north},${box.east},${box.south}`, bounded: '1' }),
  }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Nominatim ${response.status} dla „${query}”`);
  const [hit] = (await response.json()) as { lat: string; lon: string; display_name: string; osm_type: string; osm_id: number; category: string; address?: { country_code?: string }; extratags?: { opening_hours?: string } | null }[];
  return hit === undefined
    ? null
    : {
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        displayName: hit.display_name,
        osmType: hit.osm_type,
        osmId: hit.osm_id,
        category: hit.category,
        countryCode: hit.address?.country_code ?? '',
        ...(hit.extratags?.opening_hours ? { openingHours: hit.extratags.opening_hours } : {}),
      };
}
