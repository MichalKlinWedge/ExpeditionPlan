import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatMinutes, legLabel, mapCoverage, missingOnMap } from '../plan-info.ts';
import { DocItem, TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
const transport = (leg: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  DocItem.parse({ ref: 't', kind: 'transport', title: 'Przejazd', leg: { mode: 'rental_car', ...leg }, ...extra });

describe('opis mapy w planie', () => {
  it('czas po ludzku', () => {
    expect(formatMinutes(84)).toBe('1 h 24 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
  });

  it('przejazd: trasa z mapy, szacunek albo czas wpisany ręcznie', () => {
    expect(legLabel(transport({ durationMin: 84, durationMaxMin: 109, distanceKm: 63.6, routed: true }))).toBe('64 km · 1 h 24 min, w gorszym razie 1 h 49 min (trasa z mapy)');
    expect(legLabel(transport({ durationMin: 20, distanceKm: 1.7, routed: true }))).toBe('1,7 km · 20 min (trasa z mapy)');
    expect(legLabel(transport({ durationMin: 75, distanceKm: 70 }))).toBe('ok. 1 h 15 min, ok. 70 km (szacunek)');
    expect(legLabel(transport({ durationMin: 75, routed: true }, { durationMin: 90 }))).toBe('1 h 30 min (wpisane ręcznie)');
    expect(legLabel(transport({}))).toBeNull();
  });

  it('pokrycie mapy planu wzorcowego: miejsca bez współrzędnych i przejazdy bez trasy', () => {
    const coverage = mapCoverage(maroko);
    expect(coverage.places.total).toBeGreaterThan(coverage.places.onMap);
    expect(coverage.legs).toMatchObject({ routed: 0 });
    expect(coverage.legs.routable).toBeGreaterThan(0);
    const unplaced = maroko.items.find((item) => missingOnMap(maroko, item));
    expect(unplaced).toBeDefined();
  });
});
