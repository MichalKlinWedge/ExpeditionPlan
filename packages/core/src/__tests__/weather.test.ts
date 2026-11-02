import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { badWeather, fetchWeather, weatherLine, weatherPoints, weatherVariantHint } from '../weather.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

describe('pogoda dni wyjazdu', () => {
  it('każdy dzień ma miejsce (baza albo pierwszy punkt)', () => {
    const points = weatherPoints(maroko);
    expect(points.map((point) => point.dayRef)).toEqual([...maroko.days].sort((a, b) => a.date.localeCompare(b.date)).map((day) => day.ref));
    // Maroko, nie Wrocław (lotnisko wylotu jest pierwszym punktem dnia 1, ale baza dnia jest w Marakeszu).
    expect(points[0]!.lat).toBeLessThan(36);
  });

  it('jedno zapytanie dla wielu miejsc; dni poza horyzontem pominięte', async () => {
    const points = weatherPoints(maroko);
    const today = points[1]!.date;
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const lats = new URL(url).searchParams.get('latitude')!.split(',');
      const dates = points.filter((point) => point.date >= today).map((point) => point.date);
      const daily = { time: dates, temperature_2m_max: dates.map(() => 21.4), temperature_2m_min: dates.map(() => 12.6), precipitation_sum: dates.map(() => 3.2), precipitation_probability_max: dates.map(() => 70), wind_speed_10m_max: dates.map(() => 18), weather_code: dates.map(() => 61) };
      return new Response(JSON.stringify(lats.map(() => ({ daily }))));
    }) as unknown as typeof fetch;
    const forecast = await fetchWeather(points, today, fake);
    expect(urls).toHaveLength(1);
    expect(Object.keys(forecast)).not.toContain(points[0]!.dayRef);
    const day = forecast[points[1]!.dayRef]!;
    expect(weatherLine(day)).toBe('🌧️ 13–21°C · deszcz 3,2 mm (70%)');
    expect(badWeather(day)).toBe(true);
  });

  it('zła pogoda w dniu z wariantem pogodowym podpowiada wariant B', () => {
    const doc = TripDocument.parse({
      ...maroko,
      variantGroups: [...maroko.variantGroups, { ref: 'g-deszcz', scope: 'day', dayRef: 'd3', title: 'Plan na deszcz', conditionKind: 'weather' }],
      variants: [...maroko.variants, { ref: 'v-a', groupRef: 'g-deszcz', label: 'Słońce' }, { ref: 'v-b', groupRef: 'g-deszcz', label: 'Deszcz: medyna' }],
    });
    const rainy = { date: '2026-12-28', tMin: 12, tMax: 16, precipMm: 6, precipProb: 80, windKmh: 20, code: 63 };
    expect(weatherVariantHint(doc, 'd3', rainy)).toMatchObject({ variant: 'Deszcz: medyna', variantRef: 'v-b' });
    expect(weatherVariantHint(doc, 'd3', { ...rainy, precipMm: 0, precipProb: 10, code: 0 })).toBeNull();
  });
});
