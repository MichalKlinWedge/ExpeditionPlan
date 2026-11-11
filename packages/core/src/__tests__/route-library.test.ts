import { describe, expect, it } from 'vitest';

import { encodePolyline, type LngLat } from '../polyline.ts';
import { attachRoute, carRouteFromItem, detachRoute, removeRoute, routeChoices, routeGroups, routeKindFor, routeUsers } from '../route-library.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const road: LngLat[] = [
  [17.03, 51.1],
  [17.2, 51.0],
  [17.4, 50.9],
];
const doc = TripDocument.parse({
  schemaVersion: 1,
  trip: { title: 'Trasy', startDate: '2027-05-01', endDate: '2027-05-02', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
  places: [
    { ref: 'a', name: 'Wrocław', lat: 51.1, lng: 17.03 },
    { ref: 'b', name: 'Nysa', lat: 50.9, lng: 17.4 },
    { ref: 'szczyt', name: 'Śnieżnik', lat: 50.2, lng: 16.85 },
  ],
  days: [
    { ref: 'd1', date: '2027-05-01', tz: 'Europe/Warsaw' },
    { ref: 'd2', date: '2027-05-02', tz: 'Europe/Warsaw' },
  ],
  tracks: [{ ref: 'slad', name: 'Na Śnieżnik', distanceKm: 12, durationMin: 240, ascentM: 700, geojson: { type: 'LineString', coordinates: [[16.8, 50.25], [16.85, 50.2]] } }],
  items: [
    {
      ref: 'jazda',
      dayRef: 'd1',
      sortKey: '10',
      kind: 'transport',
      title: 'Do Nysy',
      leg: { mode: 'car', fromPlaceRef: 'a', toPlaceRef: 'b', durationMin: 75, distanceKm: 70, routed: true, geometry: encodePolyline(road), via: [{ lat: 51.0, lng: 17.2 }] },
    },
    { ref: 'powrot', dayRef: 'd2', sortKey: '20', kind: 'transport', title: 'Z Wrocławia do Nysy, drugi raz', leg: { mode: 'taxi', fromPlaceRef: 'a', toPlaceRef: 'b', durationMin: 90 } },
    { ref: 'wejscie', dayRef: 'd2', sortKey: '10', kind: 'activity', title: 'Wejście', placeRef: 'szczyt', durationMin: 180, activity: { trackRef: 'slad' } },
    { ref: 'pociag', dayRef: 'd2', sortKey: '30', kind: 'transport', title: 'Pociąg', leg: { mode: 'train' } },
  ],
});
const ids = { fromId: 'f1', toId: 't1' };

describe('Trasy wyjazdu', () => {
  it('przejazd autem trafia do „Tras” z linią, „Jedź przez” i końcami, a punkt ją wskazuje', () => {
    const saved = carRouteFromItem(doc, 'jazda', 'id-r1')!;
    expect(saved.created).toBe(true);
    expect(saved.track).toMatchObject({ ref: 'id-r1', name: 'Wrocław → Nysa', distanceKm: 70, durationMin: 75, route: { mode: 'car', from: { name: 'Wrocław' }, to: { name: 'Nysa' }, via: [{ lat: 51.0, lng: 17.2 }] } });
    expect(saved.track.geojson?.coordinates).toHaveLength(3);
    expect(saved.doc.items.find((item) => item.ref === 'jazda')!.leg!.trackRef).toBe('id-r1');
    // Drugi zapis tego samego punktu aktualizuje jego trasę, nie robi nowej.
    expect(carRouteFromItem(saved.doc, 'jazda', 'id-r2')!.created).toBe(false);
    expect(carRouteFromItem(doc, 'powrot', 'id-r3')).toBeNull();
    expect(carRouteFromItem(doc, 'pociag', 'id-r3')).toBeNull();
  });

  it('usunięcie punktu nie kasuje trasy, a podpięcie do innego przejazdu kopiuje przebieg', () => {
    const saved = carRouteFromItem(doc, 'jazda', 'id-r1')!.doc;
    const without = { ...saved, items: saved.items.filter((item) => item.ref !== 'jazda') };
    expect(without.tracks.some((track) => track.ref === 'id-r1')).toBe(true);
    expect(routeUsers(without, 'id-r1')).toEqual([]);
    const choices = routeChoices(without, without.items.find((item) => item.ref === 'powrot')!);
    expect(choices).toEqual([expect.objectContaining({ variant: true, track: expect.objectContaining({ ref: 'id-r1' }) })]);
    const attached = attachRoute(without, 'powrot', 'id-r1', ids);
    if (typeof attached === 'string') throw new Error(attached);
    expect(attached.item.leg).toMatchObject({ mode: 'taxi', trackRef: 'id-r1', durationMin: 75, distanceKm: 70, routed: true, via: [{ lat: 51.0, lng: 17.2 }] });
    expect(attached.item.leg!.geometry).toBe(encodePolyline(road));
    expect(TripDocument.safeParse(attached.doc).success).toBe(true);
  });

  it('środek musi pasować, a ślad pieszy przenosi km, czas i podejście', () => {
    expect(attachRoute(doc, 'powrot', 'slad', ids)).toBe('To trasa piesza, a punkt jedzie autem.');
    expect(routeKindFor(doc.items.find((item) => item.ref === 'pociag')!)).toBeUndefined();
    const walk = { ...doc, items: [...doc.items, { ...doc.items.find((item) => item.ref === 'wejscie')!, ref: 'drugie', sortKey: '40', activity: {}, durationMin: 60 }] };
    const attached = attachRoute(walk, 'drugie', 'slad', ids);
    if (typeof attached === 'string') throw new Error(attached);
    expect(attached.item).toMatchObject({ durationMin: 240, activity: { trackRef: 'slad', distanceKm: 12, ascentM: 700 } });
    expect(routeUsers(attached.doc, 'slad').map((item) => item.ref)).toEqual(['wejscie', 'drugie']);
  });

  it('warianty tej samej drogi są w jednej grupie; używanej trasy nie da się usunąć', () => {
    const one = carRouteFromItem(doc, 'jazda', 'id-r1')!.doc;
    const other = { ...one, tracks: [...one.tracks, { ref: 'id-r2', name: 'Przez Oławę', route: { mode: 'car' as const, from: { name: 'Wrocław', lat: 51.1, lng: 17.031 }, to: { name: 'Nysa', lat: 50.9, lng: 17.4 } } }] };
    const groups = routeGroups(other);
    expect(groups.map((group) => group.tracks.map((track) => track.ref))).toEqual([['id-r1', 'id-r2'], ['slad']]);
    expect(groups[0]).toMatchObject({ kind: 'car', from: 'Wrocław', to: 'Nysa' });
    expect(removeRoute(other, 'id-r1')).toBe('Trasa jest podpięta do: „Do Nysy”. Najpierw ją odepnij.');
    expect((removeRoute(other, 'id-r2') as TripDocument).tracks.map((track) => track.ref)).toEqual(['slad', 'id-r1']);
    const detached = detachRoute(one, 'jazda')!;
    expect(detached.item.leg!.trackRef).toBeUndefined();
    expect(detached.item.leg!.geometry).toBe(encodePolyline(road));
    expect(detachRoute(doc, 'pociag')).toBeNull();
  });
});
