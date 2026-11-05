import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mergePlaces, placeList, placeUsage, removeUnusedPlace, similarPlaces } from '../place-list.ts';
import { placeUses } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const SLUGS = ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko'];
const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('lista miejsc', () => {
  it('kolejność: najpierw bez współrzędnych, potem po nazwie; numery tylko dla miejsc na mapie, bez przerw', () => {
    for (const slug of SLUGS) {
      const list = placeList(fixture(slug));
      const missing = list.findIndex((entry) => entry.place.lat !== undefined);
      const head = missing === -1 ? list : list.slice(0, missing);
      const rest = missing === -1 ? [] : list.slice(missing);
      expect(head.every((entry) => entry.place.lat === undefined && entry.n === undefined)).toBe(true);
      expect(rest.map((entry) => entry.n)).toEqual(rest.map((_, index) => index + 1));
      expect(rest.every((entry) => entry.place.lat !== undefined)).toBe(true);
    }
  });

  it('użycie zgadza się z `placeUses` i dolicza przejazdy spoza punktów', () => {
    for (const slug of SLUGS) {
      const doc = fixture(slug);
      for (const place of doc.places) {
        const usage = placeUsage(doc, place.ref);
        expect(usage.total - usage.legs, `${slug}/${place.ref}`).toBe(placeUses(doc, place.ref));
      }
    }
  });

  it('każde nieużywane miejsce z pięciu planów da się usunąć bez dziury w dokumencie, użytego nie', () => {
    for (const slug of SLUGS) {
      const doc = fixture(slug);
      for (const place of doc.places) {
        const edit = removeUnusedPlace(doc, place.ref);
        if (placeUsage(doc, place.ref).total > 0) {
          expect(edit, `${slug}/${place.ref}`).toBeNull();
          continue;
        }
        expect(TripDocument.safeParse(edit!.doc).success, `${slug}/${place.ref}`).toBe(true);
        expect(JSON.stringify(edit!.doc), `${slug}/${place.ref}`).not.toContain(`"${place.ref}"`);
        expect(edit!.writes.at(-1)).toMatchObject({ collection: 'places', op: 'remove' });
      }
    }
    expect(removeUnusedPlace(fixture('dinara'), 'nie-ma')).toBeNull();
  });

  it('źródło traci odwołanie do usuwanego miejsca, ale zostaje', () => {
    const base = fixture('dinara');
    const doc = TripDocument.parse({
      ...base,
      places: [...base.places, { ref: 'miejsce-x', name: 'Stare miejsce', provider: 'unknown', links: [] }],
      sources: [...base.sources, { ref: 'zrodlo-x', kind: 'website', title: 'Blog', url: 'https://example.com/', appliesToRefs: ['miejsce-x'] }],
    });
    const edit = removeUnusedPlace(doc, 'miejsce-x')!;
    expect(edit.doc.sources.find((source) => source.ref === 'zrodlo-x')?.appliesToRefs).toEqual([]);
    expect(edit.writes.map((write) => [write.collection, write.op])).toEqual([
      ['sources', 'update'],
      ['places', 'remove'],
    ]);
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });
});

describe('scalanie miejsc', () => {
  const withPlaces = (slug: string, ...extra: object[]) => {
    const base = fixture(slug);
    return TripDocument.parse({ ...base, places: [...base.places, ...extra] });
  };

  it('każda para miejsc z pięciu planów: dokument spójny, żadne odwołanie nie zostaje, użycia się sumują', () => {
    for (const slug of SLUGS) {
      const doc = fixture(slug);
      for (const drop of doc.places) {
        const keep = doc.places.find((each) => each.ref !== drop.ref);
        if (keep === undefined) continue;
        const edit = mergePlaces(doc, keep.ref, drop.ref)!;
        const label = `${slug}/${drop.ref}`;
        expect(TripDocument.safeParse(edit.doc).success, label).toBe(true);
        expect(JSON.stringify(edit.doc), label).not.toContain(`"${drop.ref}"`);
        const before = placeUsage(doc, keep.ref).total + placeUsage(doc, drop.ref).total;
        // Punkt może korzystać z obu miejsc, wtedy liczy się raz.
        expect(placeUsage(edit.doc, keep.ref).total, label).toBeLessThanOrEqual(before);
        expect(placeUsage(edit.doc, keep.ref).total, label).toBeGreaterThanOrEqual(Math.max(placeUsage(doc, keep.ref).total, placeUsage(doc, drop.ref).total));
        expect(edit.writes.at(-1)).toMatchObject({ collection: 'places', op: 'remove', element: { ref: drop.ref } });
        expect(edit.writes.at(-2)).toMatchObject({ collection: 'places', op: 'update', element: { ref: keep.ref } });
      }
    }
  });

  it('punkty, przejazdy, dni i rezerwacje przechodzą na zostające miejsce', () => {
    const base = fixture('dinara');
    const place = base.places[0]!;
    const doc = TripDocument.parse({
      ...base,
      places: [...base.places, { ref: 'dup', name: place.name, provider: 'unknown', links: [] }],
      items: base.items.map((item, index) => (index === 0 ? { ...item, kind: 'transport', placeRef: 'dup', leg: { mode: 'car', links: [], fromPlaceRef: 'dup', toPlaceRef: 'dup' } } : item)),
      days: base.days.map((day, index) => (index === 0 ? { ...day, baseRef: 'dup' } : day)),
      bookings: [...base.bookings, { ref: 'r-x', kind: 'lodging', status: 'booked', title: 'Nocleg', startPlaceRef: 'dup', endPlaceRef: 'dup' }],
      travelers: base.travelers.map((traveler, index) => (index === 0 ? { ...traveler, startPlaceRef: 'dup', endPlaceRef: 'dup' } : traveler)),
    });
    expect(placeUsage(doc, 'dup').travelers).toBe(1);
    const edit = mergePlaces(doc, place.ref, 'dup')!;
    const item = edit.doc.items[0]!;
    expect([item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]).toEqual([place.ref, place.ref, place.ref]);
    expect(edit.doc.days[0]!.baseRef).toBe(place.ref);
    expect(edit.doc.bookings.find((each) => each.ref === 'r-x')).toMatchObject({ startPlaceRef: place.ref, endPlaceRef: place.ref });
    expect(edit.doc.travelers[0]).toMatchObject({ startPlaceRef: place.ref, endPlaceRef: place.ref });
    expect(JSON.stringify(edit.doc)).not.toContain('"dup"');
    expect(edit.writes.map((write) => write.collection).slice(0, 4)).toEqual(['travelers', 'items', 'days', 'bookings']);
  });

  it('zostające miejsce bierze z drugiego tylko to, czego nie ma, a współrzędne razem ze źródłem', () => {
    const doc = withPlaces(
      'dinara',
      { ref: 'a', name: 'Chatka', provider: 'unknown', links: [{ label: 'Strona', url: 'https://a.example/' }], notes: 'Pierwsza' },
      { ref: 'b', name: 'Chatka Górska', provider: 'osm', lat: 50.1, lng: 15.2, address: 'Orle 1', links: [{ label: 'Strona', url: 'https://a.example/' }, { label: 'Mapa', url: 'https://b.example/' }], notes: 'Druga' },
      { ref: 'c', name: 'Inna', provider: 'user', lat: 51, lng: 16, address: 'Własny', links: [] },
    );
    const merged = mergePlaces(doc, 'a', 'b')!.doc.places.find((each) => each.ref === 'a')!;
    expect(merged).toMatchObject({ name: 'Chatka', lat: 50.1, lng: 15.2, provider: 'osm', address: 'Orle 1', notes: 'Pierwsza\nDruga' });
    expect(merged.links.map((link) => link.url)).toEqual(['https://a.example/', 'https://b.example/']);
    const kept = mergePlaces(doc, 'c', 'b')!.doc.places.find((each) => each.ref === 'c')!;
    expect(kept).toMatchObject({ lat: 51, lng: 16, provider: 'user', address: 'Własny', name: 'Inna' });
  });

  it('miejsce startu uczestnika nie jest „nieużywane” i nie da się go usunąć', () => {
    const base = fixture('dinara');
    const place = base.places[0]!;
    const doc = TripDocument.parse({ ...base, travelers: base.travelers.map((traveler, index) => (index === 0 ? { ...traveler, endPlaceRef: place.ref } : traveler)) });
    expect(placeUsage(doc, place.ref).total).toBeGreaterThan(placeUsage(base, place.ref).total);
    const spare = TripDocument.parse({ ...doc, places: [...doc.places, { ref: 'wolne', name: 'Wolne', provider: 'unknown', links: [] }], travelers: doc.travelers.map((traveler, index) => (index === 0 ? { ...traveler, startPlaceRef: 'wolne' } : traveler)) });
    expect(removeUnusedPlace(spare, 'wolne')).toBeNull();
    expect(() => TripDocument.parse({ ...doc, travelers: doc.travelers.map((traveler, index) => (index === 0 ? { ...traveler, startPlaceRef: 'nie-ma' } : traveler)) })).toThrow();
  });

  it('nie scala miejsca samego ze sobą ani nieistniejącego', () => {
    const doc = fixture('dinara');
    const ref = doc.places[0]!.ref;
    expect(mergePlaces(doc, ref, ref)).toBeNull();
    expect(mergePlaces(doc, ref, 'nie-ma')).toBeNull();
    expect(mergePlaces(doc, 'nie-ma', ref)).toBeNull();
  });

  it('podpowiedź duplikatów: nazwa bez względu na wielkość liter i znaki, te same współrzędne, daleko to nie duplikat', () => {
    const doc = withPlaces(
      'dinara',
      { ref: 'a', name: 'Chatka Górzystów', provider: 'osm', lat: 50.85469, lng: 15.36079, links: [] },
      { ref: 'b', name: 'chatka  gorzystow', provider: 'osm', lat: 50.8547, lng: 15.3608, links: [] },
      { ref: 'c', name: 'Schronisko', provider: 'osm', lat: 50.85469, lng: 15.36079, links: [] },
      { ref: 'd', name: 'Chatka Górzystów', provider: 'unknown', links: [] },
      { ref: 'e', name: 'Chatka Górzystów', provider: 'osm', lat: 49, lng: 20, links: [] },
    );
    const similar = similarPlaces(doc);
    expect(similar.a).toEqual(['b', 'c', 'd']);
    expect(similar.c).toEqual(['a']);
    expect(similar.e).toEqual(['d']);
  });
});
