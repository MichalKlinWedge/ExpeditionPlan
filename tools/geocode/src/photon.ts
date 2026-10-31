import type { Box, GeocodeHit } from './nominatim.ts';
import { USER_AGENT } from './nominatim.ts';

/**
 * Photon (komoot) — drugie źródło miejsc: wyszukiwanie nieprecyzyjne („Aït Benhaddou” znajduje
 * „Aït Ben Haddou”, czego Nominatim nie robi), ale równie chętnie zwraca coś z innego kraju.
 * Dlatego tylko jako zapas dla nieznalezionych, w prostokącie obszaru wyjazdu i w jego krajach.
 * Warunki: „rozsądne użycie” bez limitu liczbowego (docs/USLUGI.md) — 1 zapytanie na 1,1 s.
 */

const ENDPOINT = 'https://photon.komoot.io/api/';
const GAP_MS = 1100;

let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const turn = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, GAP_MS)));
  queue = turn;
  return turn;
}

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; osm_key?: string; osm_value?: string; osm_type?: string; osm_id?: number; countrycode?: string; city?: string; country?: string };
};

export async function searchPhoton(query: string, countryCodes: string[], box?: Box): Promise<GeocodeHit | null> {
  await throttle();
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    q: query,
    limit: '5',
    ...(box === undefined ? {} : { bbox: `${box.west},${box.south},${box.east},${box.north}` }),
  }).toString();
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Photon ${response.status} dla „${query}”`);
  const { features } = (await response.json()) as { features: Feature[] };
  const feature = features.find((each) => countryCodes.includes((each.properties.countrycode ?? '').toLowerCase()));
  if (feature === undefined) return null;
  const { properties: p, geometry } = feature;
  return {
    lat: geometry.coordinates[1],
    lng: geometry.coordinates[0],
    displayName: [p.name, p.city, p.country].filter(Boolean).join(', ') + ' [Photon]',
    osmType: p.osm_type ?? '',
    osmId: p.osm_id ?? 0,
    // Ta sama rodzina co `category` z Nominatim (klucz OSM: place, tourism, amenity…).
    category: p.osm_key ?? '',
    countryCode: (p.countrycode ?? '').toLowerCase(),
  };
}
