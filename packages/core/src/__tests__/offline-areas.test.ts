import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { maxZoomWithin, tileCount, tripMapAreas } from '../offline-areas.ts';
import { transitPlaceRefs } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('obszary mapy offline wyjazdu', () => {
  it('liczba kafli i zoom w limicie', () => {
    const bounds: [number, number, number, number] = [-8.05, 31.6, -7.96, 31.66];
    expect(tileCount(bounds, 10, 10)).toBeGreaterThanOrEqual(1);
    // Bez sufitu (20) zoom kończy się dokładnie na granicy limitu.
    const zoom = maxZoomWithin(bounds, 10, 3000, 20);
    expect(tileCount(bounds, 10, zoom)).toBeLessThanOrEqual(3000);
    expect(tileCount(bounds, 10, zoom + 1)).toBeGreaterThan(3000);
  });

  it('Maroko: przegląd trasy bez lotniska we Wrocławiu, paczki dokładne w limicie kafli', () => {
    const areas = tripMapAreas(load('maroko'));
    const [overview, ...detail] = areas;
    expect(overview!.label).toBe('Cała trasa');
    // Wrocław (ok. 51°N, 17°E) poza mapą Maroka.
    expect(overview!.bounds[3]).toBeLessThan(36);
    expect(overview!.bounds[2]).toBeLessThan(0);
    expect(detail.length).toBeGreaterThan(1);
    for (const area of areas) {
      expect(area.tiles).toBeLessThanOrEqual(3000);
      expect(area.maxZoom).toBeGreaterThanOrEqual(area.minZoom);
    }
    // Paczka dokładna pozwala chodzić po mieście (zoom co najmniej 14).
    expect(Math.max(...detail.map((area) => area.maxZoom))).toBeGreaterThanOrEqual(14);
  });

  it('Maroko: lotnisko we Wrocławiu to miejsce tylko dojazdu — poza obszarami, chyba że `transit`', () => {
    const doc = load('maroko');
    const wroclaw = doc.places.find((place) => place.name === 'Lotnisko Wrocław')!;
    const transit = transitPlaceRefs(doc);
    expect(transit.has(wroclaw.ref)).toBe(true);
    // Bazy noclegowe nigdy nie są dojazdem.
    for (const day of doc.days) if (day.baseRef !== undefined) expect(transit.has(day.baseRef)).toBe(false);
    // Bez progu odległości o obszarze decyduje sam dojazd.
    expect(tripMapAreas(doc, { outlierKm: 10_000 })[0]!.bounds[3]).toBeLessThan(36);
    expect(tripMapAreas(doc, { transit: true })[0]!.bounds[3]).toBeGreaterThan(51);
  });

  it('każdy wzorcowy plan daje obszary w limicie (albo żadnych, gdy brak współrzędnych)', () => {
    for (const slug of ['maroko', 'dinara', 'chatka', 'barcelona', 'gruzja']) {
      for (const area of tripMapAreas(load(slug))) expect(area.tiles).toBeLessThanOrEqual(3000);
    }
  });
});
