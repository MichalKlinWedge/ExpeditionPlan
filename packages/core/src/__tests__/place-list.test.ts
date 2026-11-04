import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { placeList, placeUsage, removeUnusedPlace } from '../place-list.ts';
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
