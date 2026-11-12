import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemMap } from '../item-map.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const SLUGS = ['barcelona', 'chatka', 'gruzja', 'dinara', 'maroko'];

type Doc = TripDocument;
const places = [
  { ref: 'a', name: 'Parking', lat: 50.8277, lng: 15.5228, provider: 'user' as const, links: [] },
  { ref: 'b', name: 'Szczyt', lat: 50.8476, lng: 15.4927, provider: 'user' as const, links: [] },
  { ref: 'c', name: 'Schronisko', lat: 50.84, lng: 15.5, provider: 'user' as const, links: [] },
];
const base = { places, tracks: [], items: [], days: [] } as unknown as Doc;
const item = (extra: object) => ({ ref: 'x', kind: 'visit', variantRefs: [], routeParentRefs: [], ...extra }) as unknown as Doc['items'][number];

describe('mapa jednego punktu', () => {
  it('zwykły punkt — samo miejsce, bez linii', () => {
    const map = itemMap(base, item({ placeRef: 'b' }));
    expect(map.points).toEqual([{ kind: 'place', name: 'Szczyt', lat: 50.8476, lng: 15.4927 }]);
    expect(map.lines).toEqual([]);
  });

  it('przejazd bez przebiegu — start, cel i prosta; postój w trasie z nazwą podpunktu', () => {
    const leg = item({ kind: 'transport', leg: { mode: 'car', links: [], fromPlaceRef: 'a', toPlaceRef: 'b' } });
    const stop = item({ ref: 'y', title: 'Kawa', placeRef: 'c', parentRef: 'x' });
    const map = itemMap({ ...base, items: [leg, stop] } as Doc, leg);
    expect(map.points.map((point) => [point.kind, point.name])).toEqual([
      ['start', 'Parking'],
      ['end', 'Szczyt'],
      ['stop', 'Kawa'],
    ]);
    expect(map.lines).toEqual([{ coordinates: [[15.5228, 50.8277], [15.4927, 50.8476]], straight: true, foot: false }]);
  });

  it('ślad GPX ma pierwszeństwo przed prostą, a pętla ma jedną pinezkę startu', () => {
    const coordinates = [[15.5228, 50.8277, 600], [15.4927, 50.8476, 1600], [15.5228, 50.8277, 600]];
    const doc = { ...base, tracks: [{ ref: 't', name: 'Pętla', geojson: { type: 'LineString', coordinates } }] } as unknown as Doc;
    const map = itemMap(doc, item({ kind: 'activity', placeRef: 'b', activity: { trackRef: 't' } }));
    expect(map.lines).toEqual([{ coordinates: [[15.5228, 50.8277], [15.4927, 50.8476], [15.5228, 50.8277]], straight: false, foot: true }]);
    expect(map.points.map((point) => point.kind)).toEqual(['start', 'place']);
  });

  it('na pięciu planach nie rzuca, a przejazdy z przebiegiem mają linię', () => {
    for (const slug of SLUGS) {
      const doc = fixture(slug);
      for (const each of doc.items) {
        const map = itemMap(doc, each);
        if (each.leg?.geometry !== undefined) expect(map.lines.length).toBeGreaterThan(0);
        for (const point of map.points) expect(Number.isFinite(point.lat) && Number.isFinite(point.lng)).toBe(true);
      }
    }
  });
});
