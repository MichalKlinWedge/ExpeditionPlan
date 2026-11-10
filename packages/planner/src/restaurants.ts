import type { Eatery, EateryKind } from '@expeditionplan/core';

/**
 * Knajpy w pobliżu z Geoapify Places (dane OSM) — docs/USLUGI.md: 1 kredyt za do 20 wyników,
 * wyniki wolno przechowywać przy atrybucji „© OpenStreetMap, Powered by Geoapify”. Klucz tylko
 * po stronie serwera.
 */

const ENDPOINT = 'https://api.geoapify.com/v2/places';

/** W centrum miasta 20 najbliższych to przypadkowa garść: bierzemy więcej (5 kredytów) i odsiewamy filtrami. */
export const MAX_RESULTS = 100;

const CATEGORIES: Record<EateryKind, string[]> = {
  restaurant: ['catering.restaurant'],
  fast_food: ['catering.fast_food', 'catering.food_court'],
  cafe: ['catering.cafe'],
  pub: ['catering.pub', 'catering.bar', 'catering.biergarten'],
  // Schroniska są w OSM noclegiem (`tourism=alpine_hut`), zwykle bez znaczników jedzenia.
  hut: ['accommodation.hut'],
};

/** Filtry diety z `conditions` Geoapify. */
export type EateryDiet = 'vegetarian' | 'vegan' | 'gluten_free' | 'halal';

export type EaterySearch = { lat: number; lng: number; radiusM: number; kinds: EateryKind[]; diet?: EateryDiet; limit?: number };

type Raw = Record<string, unknown> & { osm_id?: number; osm_type?: string; cuisine?: string; brand?: string; 'brand:wikidata'?: string; opening_hours?: string; website?: string; phone?: string; 'contact:phone'?: string; 'contact:website'?: string };
type Feature = {
  properties?: {
    name?: string;
    lat?: number;
    lon?: number;
    categories?: string[];
    address_line2?: string;
    formatted?: string;
    website?: string;
    opening_hours?: string;
    contact?: { phone?: string };
    catering?: { cuisine?: string };
    datasource?: { raw?: Raw };
  };
};

const OSM_TYPE: Record<string, string> = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' };
const yes = (value: unknown) => value === 'yes' || value === 'only';

function kindOf(categories: string[]): EateryKind {
  for (const kind of ['restaurant', 'fast_food', 'cafe', 'pub', 'hut'] as const) if (CATEGORIES[kind].some((category) => categories.includes(category))) return kind;
  return 'restaurant';
}

export function eateryFrom(feature: Feature): Eatery | null {
  const p = feature.properties ?? {};
  if (!p.name || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  const raw = p.datasource?.raw ?? {};
  const kind = kindOf(p.categories ?? []);
  // Chatka bez obsługi albo schronisko z `food=no` nie nakarmi.
  if (kind === 'hut' && (raw.tourism === 'wilderness_hut' || raw.food === 'no')) return null;
  const cuisine = raw.cuisine ?? p.catering?.cuisine;
  const hours = raw.opening_hours ?? p.opening_hours;
  const website = raw.website ?? raw['contact:website'] ?? p.website;
  const phone = raw.phone ?? raw['contact:phone'] ?? p.contact?.phone;
  const osmType = OSM_TYPE[raw.osm_type ?? ''];
  return {
    name: p.name,
    lat: p.lat,
    lng: p.lon,
    kind,
    ...(p.address_line2 ? { address: p.address_line2 } : p.formatted ? { address: p.formatted } : {}),
    ...(cuisine ? { cuisine } : {}),
    ...(hours ? { openingHours: hours } : {}),
    ...(website ? { website } : {}),
    ...(phone ? { phone } : {}),
    ...(osmType && typeof raw.osm_id === 'number' ? { osm: { type: osmType, id: Math.abs(raw.osm_id) } } : {}),
    ...(yes(raw['diet:vegetarian']) || yes(raw['diet:vegan']) ? { vegetarian: true } : {}),
    ...(yes(raw['diet:vegan']) ? { vegan: true } : {}),
    ...(raw.brand || raw['brand:wikidata'] ? { chain: true } : {}),
  };
}

/** Do `limit` (domyślnie 20, najwyżej 100) knajp w promieniu, najbliższe pierwsze: 1 kredyt za każde rozpoczęte 20 wyników. */
export async function findEateries(apiKey: string, search: EaterySearch, fetchImpl: typeof fetch = fetch): Promise<Eatery[]> {
  const kinds = search.kinds.length > 0 ? search.kinds : (Object.keys(CATEGORIES) as EateryKind[]);
  const params = new URLSearchParams({
    categories: kinds.flatMap((kind) => CATEGORIES[kind]).join(','),
    filter: `circle:${search.lng},${search.lat},${Math.round(search.radiusM)}`,
    bias: `proximity:${search.lng},${search.lat}`,
    limit: String(Math.min(search.limit ?? 20, MAX_RESULTS)),
    lang: 'pl',
    apiKey,
  });
  if (search.diet) params.set('conditions', search.diet);
  const response = await fetchImpl(`${ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`Geoapify Places ${response.status}`);
  const body = (await response.json()) as { features?: Feature[] };
  return (body.features ?? []).map(eateryFrom).filter((each): each is Eatery => each !== null);
}
