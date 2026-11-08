import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dayItems, PlanReview, StoredReview, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { numberedReview, pendingSuggestions, reviewContext, reviewPrompt } from '../review.ts';
import { applyPatch, changedPlaces, patchDiff } from '../tune.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
let n = 0;
const newId = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
const offMap = maroko.places.find((place) => place.lat === undefined && maroko.items.some((item) => item.placeRef === place.ref))!;

describe('przegląd planu — kontekst dla modelu', () => {
  const context = reviewContext(maroko, new Set(['d2-medersa']));

  it('dni z faktami silnika, odległościami i blokadami', () => {
    expect(context.days.map((day) => day.ref)).toEqual(maroko.days.map((day) => day.ref));
    const items = context.days.flatMap((day) => day.items);
    expect(items.some((item) => item.kmFromPrevious !== undefined)).toBe(true);
    expect(items.some((item) => 'engine' in item)).toBe(true);
    expect(items.find((item) => item.ref === 'd2-medersa')).toMatchObject({ locked: true });
    expect(items.find((item) => item.ref === 'd1-a7')!.leg).toMatchObject({ mode: 'rental_car' });
    // Przejazd nie dostaje odległości, a punkt po nim wie, że dojazd już jest.
    expect(items.find((item) => item.ref === 'd1-a7')).not.toHaveProperty('kmFromPrevious');
    expect(items.some((item) => 'transportBefore' in item)).toBe(true);
  });

  it('miejsca poza mapą użyte w planie', () => {
    expect(context.placesNotOnMap.map((place) => place.ref)).toContain(offMap.ref);
    expect(context.days.flatMap((day) => day.items).find((item) => item.placeRef === offMap.ref)).toMatchObject({ notOnMap: true });
  });

  it('prompt tylko z wybranymi obszarami i prośbą człowieka', () => {
    const prompt = reviewPrompt(maroko, new Set(), ['map'], 'mniej chodzenia');
    expect(prompt).toContain('mapa — miejsca poza mapą');
    expect(prompt).not.toContain('posiłki — dzień bez obiadu');
    expect(prompt).toContain('Człowiek prosi szczególnie: mniej chodzenia');
  });
});

describe('przegląd planu — łatki tras i mapy', () => {
  it('set_leg zmienia środek i czas, nowe „dokąd” staje się miejscem planu', () => {
    const { doc, results } = applyPatch(
      maroko,
      { message: 'ok', ops: [{ op: 'set_leg', itemRef: 'd2-do-bahii', mode: 'taxi', durationMin: 10, to: 'Pałac Bahia — brama' }] },
      new Set(),
      newId,
    );
    expect(results).toEqual([expect.objectContaining({ ok: true, text: expect.stringContaining('środek → taksówka') })]);
    const leg = doc.items.find((item) => item.ref === 'd2-do-bahii')!.leg!;
    expect(leg).toMatchObject({ mode: 'taxi', durationMin: 10, fromPlaceRef: 'p-medersa' });
    expect(doc.places.find((place) => place.ref === leg.toPlaceRef)!.name).toBe('Pałac Bahia — brama');
    expect(() => TripDocument.parse(doc)).not.toThrow();
  });

  it('set_leg: nie przejazd albo czas z trasy — odrzucone z powodem', () => {
    const routed = { ...maroko, items: maroko.items.map((item) => (item.ref === 'd1-a7' ? { ...item, leg: { ...item.leg!, routed: true } } : item)) };
    const { results } = applyPatch(
      routed,
      {
        message: 'ok',
        ops: [
          { op: 'set_leg', itemRef: 'd2-medersa', durationMin: 5 },
          { op: 'set_leg', itemRef: 'd1-a7', durationMin: 5 },
        ],
      },
      new Set(),
      newId,
    );
    expect(results.map((result) => result.ok)).toEqual([false, false]);
    expect(results[1]!.text).toContain('z trasy');
  });

  it('set_place ustawia nazwę do wyszukania; ręczna pinezka nietykalna; zapis widzi zmienione miejsce', () => {
    const pinned = { ...maroko, places: maroko.places.map((place) => (place.ref === 'p-medersa' ? { ...place, provider: 'user' as const } : place)) };
    const { doc, results } = applyPatch(
      pinned,
      {
        message: 'ok',
        ops: [
          { op: 'set_place', placeRef: offMap.ref, searchName: 'Test Place, Marrakech' },
          { op: 'set_place', placeRef: 'p-medersa', searchName: 'Ben Youssef' },
        ],
      },
      new Set(),
      newId,
    );
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(changedPlaces(pinned, doc).map((place) => [place.ref, place.searchName])).toEqual([[offMap.ref, 'Test Place, Marrakech']]);
  });

  it('set_place na miejscu prywatnym — odrzucone, bo wyszukiwarka takich nie szuka', () => {
    const privateDoc = { ...maroko, places: maroko.places.map((place) => (place.ref === offMap.ref ? { ...place, name: 'Nocleg u znajomej (okolice Jaume I)' } : place)) };
    const { results } = applyPatch(privateDoc, { message: 'ok', ops: [{ op: 'set_place', placeRef: offMap.ref, searchName: 'Carrer de Jaume I, Barcelona' }] }, new Set(), newId);
    expect(results[0]).toMatchObject({ ok: false, text: expect.stringContaining('przypnij je ręcznie') });
  });

  it('add_item przejazdu z leg: skąd/dokąd jako miejsca, różnica zapisu zawiera nowe miejsce', () => {
    const before = dayItems(maroko, 'd2');
    const { doc, results } = applyPatch(
      maroko,
      {
        message: 'ok',
        ops: [{ op: 'add_item', dayRef: 'd2', afterItemRef: before[0]!.ref, item: { title: 'Taksówka do Bahii', kind: 'transport', leg: { mode: 'taxi', durationMin: 10, distanceKm: 2, from: 'Medersa Ben Youssef', to: 'Nowy przystanek' } } }],
      },
      new Set(),
      newId,
    );
    expect(results[0]!.ok).toBe(true);
    const added = dayItems(doc, 'd2')[1]!;
    expect(added).toMatchObject({ title: 'Taksówka do Bahii', leg: { mode: 'taxi', durationMin: 10, distanceKm: 2 } });
    const diff = patchDiff(maroko, doc);
    expect(diff.created.filter((each) => each.collection === 'places').map((each) => (each.element as { name: string }).name)).toContain('Nowy przystanek');
    expect(() => TripDocument.parse(doc)).not.toThrow();
  });
});

describe('przegląd planu — zapisane propozycje', () => {
  it('numery propozycji i nierozstrzygnięte', () => {
    const review = PlanReview.parse({
      summary: 'Dobry plan.',
      suggestions: [
        { category: 'routes', title: 'A', why: 'x', ops: [{ op: 'set_field', itemRef: 'd2-bahia', field: 'durationMin', value: 60 }] },
        { category: 'descriptions', title: 'B', why: 'y', ops: [{ op: 'set_field', itemRef: 'd2-bahia', field: 'description', value: 'Pałac z XIX w.' }] },
      ],
    });
    const stored = StoredReview.parse({ ...numberedReview(review), applied: ['s1'] });
    expect(stored.review.suggestions.map((each) => each.id)).toEqual(['s1', 's2']);
    expect(pendingSuggestions(stored).map((each) => each.id)).toEqual(['s2']);
  });
});
