import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { tripMap } from '../trip-map.ts';
import { tripMemories } from '../trip-memories.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const SLUGS = ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko'];

describe('mapa wyjazdu', () => {
  it('pięć planów: wszystkie punkty dni, kolejne numery przez cały wyjazd bez powtórzeń, każde miejsce z pinezki ma okno', () => {
    for (const slug of SLUGS) {
      const doc = fixture(slug);
      const result = tripMap(doc, { skipRefs: [], guideOf: () => null, journal: [] });
      const stats = tripMemories(doc, { done: [], skipRefs: [] });
      for (const ref of stats.routeRefs) expect(result.stops[ref]).toBeDefined();
      expect(result.map.pins.length).toBeGreaterThan(0);
      for (const pin of result.map.pins) {
        expect(result.places[pin.placeRef]).toBeDefined();
        // Każda pinezka otwiera okno: numerem albo `clickRef`.
        expect(pin.stops.length > 0 || pin.clickRef !== undefined).toBe(true);
        for (const stop of pin.stops) expect(stop.n).toBe(result.stops[stop.ref]!.no);
      }
      const numbers = result.map.pins.flatMap((pin) => pin.stops.map((stop) => stop.n)).sort((a, b) => a - b);
      expect(numbers).toEqual(numbers.map((_, at) => at + 1));
      // Numery idą za dniami: punkt późniejszego dnia ma większy numer.
      const byNo = Object.values(result.stops).filter((stop) => stop.no !== undefined).sort((a, b) => a.no! - b.no!);
      for (let at = 1; at < byNo.length; at++) expect(byNo[at]!.dayNo).toBeGreaterThanOrEqual(byNo[at - 1]!.dayNo);
      // Trasy na mapie można kliknąć: każda linia z punktem wskazuje znany punkt z `route`.
      for (const line of result.map.lines) for (const ref of line.refs ?? []) expect(result.stops[ref]?.route).toBe(true);
    }
  });

  it('pominięte w terenie znikają z mapy', () => {
    const doc = fixture('maroko');
    const full = tripMap(doc, { skipRefs: [], guideOf: () => null, journal: [] });
    const skip = Object.values(full.stops).find((stop) => !stop.night)!.ref;
    const result = tripMap(doc, { skipRefs: [skip], guideOf: () => null, journal: [] });
    expect(result.stops[skip]).toBeUndefined();
  });

  it('zdjęcie punktu stoi przy jego miejscu, zdjęcie z samym dniem — przy punkcie sprzed zdjęcia', () => {
    const doc = fixture('barcelona');
    const base = tripMap(doc, { skipRefs: [], guideOf: () => null, journal: [] });
    const located = Object.values(base.stops).find((stop) => !stop.night && stop.placeRef !== undefined && base.places[stop.placeRef] !== undefined && stop.time !== undefined)!;
    const day = doc.days.find((each) => each.ref === located.dayRef)!;
    const result = tripMap(doc, {
      skipRefs: [],
      guideOf: () => null,
      journal: [
        { id: 'a', itemRef: located.ref, dayRef: day.ref, body: 'przy punkcie', takenAt: Date.parse(`${day.date}T12:00:00Z`), photoUrl: 'https://example.org/a.jpg' },
        { id: 'b', dayRef: day.ref, body: 'wieczorem', takenAt: Date.parse(`${day.date}T21:30:00Z`), photoUrl: 'https://example.org/b.jpg' },
        { id: 'c', body: 'bez dnia', takenAt: 0, photoUrl: 'https://example.org/c.jpg' },
      ],
    });
    const a = result.photos.find((photo) => photo.id === 'a')!;
    expect(a.placeRef).toBe(located.placeRef);
    expect(a.itemTitle).toBe(located.title);
    expect(result.places[located.placeRef!]!.photoIds).toContain('a');
    expect(result.photos.find((photo) => photo.id === 'b')).toBeDefined();
    expect(result.photos.find((photo) => photo.id === 'c')).toBeUndefined();
    const pin = result.photoPins.find((each) => each.placeRef === located.placeRef)!;
    expect(pin.count).toBeGreaterThanOrEqual(1);
  });
});
