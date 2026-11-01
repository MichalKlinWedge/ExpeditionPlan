import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { fetchHolidays, type Holiday } from '@expeditionplan/planner';

/** Święta z Nager.Date z cache w pliku (narzędzie puszczane wielokrotnie na tych samych planach). */
export async function holidays(country: string, year: number, cachePath: string): Promise<Holiday[]> {
  const cache: Record<string, Holiday[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const key = `${country}-${year}`;
  if (cache[key] === undefined) {
    cache[key] = await fetchHolidays(country, year);
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
  }
  return cache[key];
}
