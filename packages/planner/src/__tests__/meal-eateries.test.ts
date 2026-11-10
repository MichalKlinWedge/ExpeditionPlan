import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Eatery, mealSearchCenter, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { EateriesRequest, eateriesForMeal, positionCenter, roundPosition } from '../meal-eateries.ts';
import type { EaterySearch } from '../restaurants.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

const near = (name: string, dLat: number, extra: Partial<Eatery> = {}): Eatery => {
  const center = mealSearchCenter(maroko, 'd1-kolacja')!;
  return { name, lat: center.lat + dLat, lng: center.lng, kind: 'restaurant', ...extra };
};

/** Udawane Geoapify: zapamiętuje zapytanie, oddaje gotową listę. */
function fakeSearch(results: Eatery[]) {
  const calls: EaterySearch[] = [];
  return { calls, search: async (query: EaterySearch) => (calls.push(query), results) };
}

describe('knajpy w pobliżu posiłku — wspólne dla akcji webu i /api/eateries', () => {
  it('środek z planu, promień w granicach, otwarte w porze posiłku najpierw, potem najbliższe', async () => {
    const { calls, search } = fakeSearch([
      near('Daleko otwarta', 0.004, { openingHours: 'Mo-Su 12:00-23:00' }),
      near('Blisko zamknięta', 0.001, { openingHours: 'Mo-Su 08:00-16:00' }),
      near('Blisko otwarta', 0.002, { openingHours: 'Mo-Su 12:00-23:00', cuisine: 'moroccan' }),
      near('Bez godzin', 0.0005),
    ]);
    const answer = await eateriesForMeal(maroko, 'd1-kolacja', { kinds: ['restaurant', 'cafe'], radiusM: 99_999, diet: 'vegan' }, { search });
    if ('error' in answer) throw new Error(answer.error);
    expect(answer.center.near).toBe('Dżami al-Fna');
    expect(calls).toEqual([{ lat: answer.center.lat, lng: answer.center.lng, radiusM: 5000, kinds: ['restaurant', 'cafe'], diet: 'vegan', limit: 100 }]);
    expect(answer.results.map((each) => each.name)).toEqual(['Blisko otwarta', 'Daleko otwarta', 'Bez godzin', 'Blisko zamknięta']);
    expect(answer.results[0]).toMatchObject({ open: { state: 'open', hours: '12:00–23:00' }, distanceM: 222, summary: 'marokańska · 220 m · 12:00–23:00' });
    expect(answer.results[3]!.open.state).toBe('closed');
  });

  it('pozycja telefonu: zaokrąglona do ~100 m i tylko jako środek zapytania', async () => {
    expect(roundPosition({ lat: 31.625_812_3, lng: -7.989_123_4 })).toEqual({ lat: 31.626, lng: -7.989 });
    const { calls, search } = fakeSearch([]);
    const answer = await eateriesForMeal(maroko, 'd1-kolacja', { kinds: [], radiusM: 800, center: positionCenter({ lat: 31.625_812_3, lng: -7.989_123_4 }) }, { search });
    expect(answer).toEqual({ center: { lat: 31.626, lng: -7.989, near: 'Twoja okolica' }, results: [], tipSources: [] });
    expect(calls[0]).toMatchObject({ lat: 31.626, lng: -7.989, radiusM: 800, kinds: [] });
  });

  it('błędy: posiłku nie ma, Geoapify nie odpowiada', async () => {
    expect(await eateriesForMeal(maroko, 'nie-ma', { kinds: [], radiusM: 1000 }, { search: fakeSearch([]).search })).toEqual({ error: 'Tego posiłku już nie ma — odśwież plan.' });
    const broken = async () => {
      throw new Error('Geoapify Places 429');
    };
    expect(await eateriesForMeal(maroko, 'd1-kolacja', { kinds: [], radiusM: 1000 }, { search: broken })).toEqual({ error: 'Geoapify Places 429' });
  });

  it('ciało zapytania z telefonu: pozycja opcjonalna, promień i rodzaje z listy', () => {
    const base = { tripId: '0190f1c2-0000-7000-8000-000000000001', itemRef: 'd1-kolacja', kinds: ['restaurant'], radiusM: 1000 };
    expect(EateriesRequest.safeParse(base).success).toBe(true);
    expect(EateriesRequest.safeParse({ ...base, position: { lat: 31.626, lng: -7.989 }, diet: 'halal' }).success).toBe(true);
    expect(EateriesRequest.safeParse({ ...base, kinds: ['bar_mleczny'] }).success).toBe(false);
    expect(EateriesRequest.safeParse({ ...base, radiusM: 50_000 }).success).toBe(false);
    expect(EateriesRequest.safeParse({ ...base, position: { lat: 120, lng: 0 } }).success).toBe(false);
  });
});
