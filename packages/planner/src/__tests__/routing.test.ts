import { TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { legEnds, orsRoute, type RouteLookup, routeLegs } from '../routing.ts';

const doc = TripDocument.parse({
  schemaVersion: 1,
  trip: { title: 'Test', startDate: '2026-04-25', endDate: '2026-04-25', primaryTz: 'Europe/Zagreb', baseCurrency: 'EUR' },
  days: [{ ref: 'd1', date: '2026-04-25', tz: 'Europe/Zagreb', baseRef: 'p-sibenik' }],
  places: [
    { ref: 'p-sibenik', name: 'Szybenik', lat: 43.735, lng: 15.889 },
    { ref: 'p-dinara', name: 'Dinara — parking', lat: 43.95, lng: 16.42 },
    { ref: 'p-szczyt', name: 'Dinara — szczyt' },
  ],
  items: [
    { ref: 'jazda', dayRef: 'd1', sortKey: '0010', kind: 'transport', title: 'Dojazd pod Dinarę', placeRef: 'p-dinara', durationMin: 75, leg: { mode: 'rental_car', durationMin: 75, distanceKm: 60 } },
    { ref: 'trasa', dayRef: 'd1', sortKey: '0020', kind: 'activity', title: 'Trasa na szczyt', placeRef: 'p-szczyt', durationMin: 360 },
    { ref: 'zejscie', dayRef: 'd1', sortKey: '0030', kind: 'transport', title: 'Zejście', leg: { mode: 'hike', fromPlaceRef: 'p-szczyt', toPlaceRef: 'p-dinara' } },
    { ref: 'powrot', dayRef: 'd1', sortKey: '0040', kind: 'transport', title: 'Powrót', leg: { mode: 'car', fromPlaceRef: 'p-dinara', toPlaceRef: 'p-sibenik' } },
    { ref: 'lot', dayRef: 'd1', sortKey: '0050', kind: 'transport', title: 'Lot', leg: { mode: 'flight', durationMin: 95 } },
  ],
});

describe('trasy przejazdów (ORS)', () => {
  it('skąd/dokąd: z `leg`, a bez niego baza dnia i miejsce przejazdu', () => {
    const jazda = doc.items.find((item) => item.ref === 'jazda')!;
    expect(legEnds(doc, jazda)).toEqual({ from: { lat: 43.735, lng: 15.889 }, to: { lat: 43.95, lng: 16.42 } });
  });

  it('czas z trasy zastępuje szacunek AI (+30% w pesymistycznym); lot i brak współrzędnych zostają', async () => {
    const calls: string[] = [];
    const lookup: RouteLookup = async (_from, _to, profile) => {
      calls.push(profile);
      return { distanceKm: 52.34, durationMin: 58.6 };
    };
    const { doc: routed, results } = await routeLegs(doc, lookup);
    expect(calls).toEqual(['driving-car', 'driving-car']);
    const jazda = routed.items.find((item) => item.ref === 'jazda')!;
    expect(jazda.durationMin).toBeUndefined();
    expect(jazda.leg).toMatchObject({ mode: 'rental_car', durationMin: 59, durationMaxMin: 77, distanceKm: 52.3, routed: true });
    expect(Object.fromEntries(results.map((result) => [result.ref, result.status]))).toEqual({ jazda: 'routed', zejscie: 'no_coordinates', powrot: 'routed' });
    expect(results[0]!.before).toEqual({ durationMin: 75, distanceKm: 60 });
    expect(routed.items.find((item) => item.ref === 'lot')!.leg!.durationMin).toBe(95);
    expect(() => TripDocument.parse(routed)).not.toThrow();
  });

  it('„Wyjazd z parkingu”: cel to miejsce następnego punktu, nie miejsce przejazdu', () => {
    const wyjazd = TripDocument.parse({
      ...doc,
      places: [...doc.places, { ref: 'p-oboz', name: 'Obóz', lat: 31.45, lng: -8.1 }, { ref: 'p-parking', name: 'Parking', lat: 31.62, lng: -7.99 }],
      items: [
        { ref: 'a', dayRef: 'd1', sortKey: '0010', kind: 'meal', title: 'Lunch', placeRef: 'p-parking', durationMin: 60 },
        { ref: 'w', dayRef: 'd1', sortKey: '0020', kind: 'transport', title: 'Wyjazd do obozu', placeRef: 'p-parking', leg: { mode: 'rental_car', distanceKm: 40 } },
        { ref: 'z', dayRef: 'd1', sortKey: '0030', kind: 'lodging', title: 'Zameldowanie', placeRef: 'p-oboz' },
      ],
    });
    expect(legEnds(wyjazd, wyjazd.items[1]!)).toEqual({ from: { lat: 31.62, lng: -7.99 }, to: { lat: 31.45, lng: -8.1 } });
  });

  it('trasa niepasująca do dystansu z planu (×2,5) nie nadpisuje szacunku', async () => {
    const { doc: routed, results } = await routeLegs(doc, async () => ({ distanceKm: 3, durationMin: 8 }));
    expect(results.find((result) => result.ref === 'jazda')!.status).toBe('mismatch');
    expect(routed.items.find((item) => item.ref === 'jazda')!.leg!.durationMin).toBe(75);
  });

  it('brak trasy albo błąd usługi nie zatrzymuje reszty', async () => {
    let call = 0;
    const lookup: RouteLookup = async () => {
      call += 1;
      if (call === 1) return null;
      throw new Error('OpenRouteService 429');
    };
    const { doc: routed, results } = await routeLegs(doc, lookup);
    expect(results.map((result) => result.status)).toEqual(['not_found', 'no_coordinates', 'failed']);
    expect(routed.items.find((item) => item.ref === 'jazda')!.leg!.durationMin).toBe(75);
  });

  it('orsRoute: klucz w nagłówku, [lng, lat], 404 = brak trasy', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return requests.length === 1
        ? new Response(JSON.stringify({ routes: [{ summary: { distance: 52_340, duration: 3516 } }] }), { status: 200 })
        : new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const route = orsRoute('klucz-testowy', fake);
    expect(await route({ lat: 43.7, lng: 15.9 }, { lat: 43.9, lng: 16.4 }, 'driving-car')).toEqual({ distanceKm: 52.34, durationMin: 58.6 });
    expect(requests[0]!.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car');
    expect(requests[0]!.url).not.toContain('klucz');
    expect((requests[0]!.init.headers as Record<string, string>).Authorization).toBe('klucz-testowy');
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({ coordinates: [[15.9, 43.7], [16.4, 43.9]], radiuses: [5000, 5000], instructions: false });
    expect(await route({ lat: 43.7, lng: 15.9 }, { lat: 43.9, lng: 16.4 }, 'foot-hiking')).toBeNull();
  }, 10_000);
});
