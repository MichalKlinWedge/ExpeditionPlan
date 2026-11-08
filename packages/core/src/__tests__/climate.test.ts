import { describe, expect, it } from 'vitest';

import { climateFor, climateLine, climateYears, daylight, fetchClimate, geocodeClimatePlace, needsClimate, yearsBack } from '../climate.ts';

const barcelona = { lat: 41.39, lng: 2.17, name: 'Barcelona' };

/** Archiwum na niby: rok N ma maksimum 10+N mod 10, minimum 5, opad 2 mm co drugi dzień, 6 h słońca. */
const archive = (calls: string[]) =>
  (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.search);
    const start = url.searchParams.get('start_date')!;
    const end = url.searchParams.get('end_date')!;
    const year = Number(start.slice(0, 4));
    if (year === 2017) return new Response('', { status: 500 });
    const time: string[] = [];
    for (let day = start; day <= end; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) time.push(day);
    return Response.json({
      daily: {
        time,
        temperature_2m_max: time.map(() => 10 + (year % 10)),
        temperature_2m_min: time.map(() => 5),
        precipitation_sum: time.map((_, index) => (index % 2 === 0 ? 2 : 0)),
        sunshine_duration: time.map(() => 6 * 3600),
      },
    });
  }) as typeof fetch;

describe('klimat terminu', () => {
  it('klimat dopiero poza horyzontem prognozy (16 dni)', () => {
    expect(needsClimate('2026-11-23', '2026-11-08')).toBe(false);
    expect(needsClimate('2026-11-24', '2026-11-08')).toBe(true);
  });

  it('lata: najnowszy rok, którego okno jest już w archiwum, i 9 wcześniejszych', () => {
    expect(climateYears('2026-12-07', '2026-11-08')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(climateYears('2026-11-10', '2026-11-08')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(climateYears('2026-11-03', '2026-11-08')[0]).toBe(1);
    expect(climateYears('2028-05-01', '2026-11-08')[0]).toBe(2);
    expect(yearsBack('2028-02-29', 1)).toBe('2027-03-01');
  });

  it('średnie z lat, które się pobrały; termin w środku pobranego okna', async () => {
    const calls: string[] = [];
    const data = await fetchClimate(barcelona, '2027-01-01', '2027-02-28', '2026-11-08', archive(calls));
    expect(calls).toHaveLength(10);
    expect(calls[0]).toContain('start_date=2025-12-29&end_date=2026-03-03');
    const climate = climateFor(data, '2027-01-15', '2027-01-17')!;
    // Okna od 29.12 lat 2016–2025 (etykieta = rok terminu, 2017–2026), bez nieudanego 2017: maksima 10 + rok mod 10.
    expect(climate).toMatchObject({ tMin: 5, tMax: 14, sunHours: 6, firstYear: 2017, lastYear: 2026 });
    expect(climate.wetShare).toBeGreaterThanOrEqual(44);
    expect(climate.wetShare).toBeLessThanOrEqual(56);
    expect(climate.precipMm).toBeCloseTo(1, 0);
    expect(climateLine(climate)).toMatch(/^śr\. 5–14°C · opad w \d+% dni \(śr\. 1,1 mm\) · słońce 6 h · dzień 9 h \d\d min$/);
  });

  it('długość dnia lokalnie; noc polarna = brak', () => {
    expect(daylight('2027-06-21', '2027-06-21', { lat: 52.23, lng: 21.01 })).toBeGreaterThan(16 * 60);
    expect(daylight('2027-12-21', '2027-12-21', { lat: 78.2, lng: 15.6 })).toBeNull();
  });

  it('geokoder: pierwszy wynik z krajem, za krótka nazwa bez zapytania', async () => {
    const urls: string[] = [];
    const fake = (async (input: string) => {
      urls.push(input);
      return Response.json({ results: [{ latitude: 41.39, longitude: 2.16, name: 'Barcelona', country: 'Hiszpania' }] });
    }) as unknown as typeof fetch;
    expect(await geocodeClimatePlace('Barcelona', { countryCode: 'es', fetchImpl: fake })).toEqual({ lat: 41.39, lng: 2.16, name: 'Barcelona (Hiszpania)', geonames: true });
    expect(urls[0]).toContain('name=Barcelona&count=1&language=pl&format=json&countryCode=ES');
    expect(await geocodeClimatePlace(' x ', { fetchImpl: fake })).toBeNull();
  });
});
