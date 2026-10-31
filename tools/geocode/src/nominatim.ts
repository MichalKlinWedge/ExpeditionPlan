/**
 * Publiczny Nominatim (OSMF) według zasad z docs/USLUGI.md: najwyżej 1 zapytanie na sekundę,
 * identyfikujący User-Agent, wyniki w cache — to narzędzie jednorazowe dla planów wzorcowych,
 * nie usługa aplikacji (w aplikacji geokodowanie idzie przez Geoapify).
 */

export type GeocodeHit = { lat: number; lng: number; displayName: string; osmType: string; osmId: number; category: string; countryCode: string };

export const USER_AGENT = 'ExpeditionPlan-fixtures/0.1 (+https://github.com/MichalKlinWedge/ExpeditionPlan)';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const GAP_MS = 1100;

let last = 0;

async function throttle() {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  last = Date.now();
}

export type Box = { south: number; west: number; north: number; east: number };

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
    ...(box === undefined ? {} : { viewbox: `${box.west},${box.north},${box.east},${box.south}`, bounded: '1' }),
  }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Nominatim ${response.status} dla „${query}”`);
  const [hit] = (await response.json()) as { lat: string; lon: string; display_name: string; osm_type: string; osm_id: number; category: string; address?: { country_code?: string } }[];
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
      };
}
