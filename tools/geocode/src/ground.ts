import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { GeocodeHit, Lookup } from '@expeditionplan/planner';

import { searchNominatim } from './nominatim.ts';

/** Źródło miejsc z trwałym cache zapytań (zasady OSMF: każde zapytanie najwyżej raz). */
export function cachedLookup(cachePath: string, search: Lookup = searchNominatim): Lookup {
  const cache: Record<string, GeocodeHit | null> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  return async (query, countries, box) => {
    const area = box === undefined ? '' : `|${[box.south, box.west, box.north, box.east].map((v) => v.toFixed(2)).join(',')}`;
    const key = `${countries.join(',')}|${query}${area}`;
    if (!(key in cache)) {
      cache[key] = await search(query, countries, box);
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
    }
    return cache[key] ?? null;
  };
}
