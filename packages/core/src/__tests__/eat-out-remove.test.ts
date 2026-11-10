import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { addEatOutChoices, type Eatery, eatOutGroup, mealEateries, removeEatOutChoice } from '../eat-out.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { documentProblem } from '../plan-edits.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

let counter = 0;
const newRef = () => `id-00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
const eatery = (name: string, dLat: number): Eatery => ({ name, lat: 31.626 + dLat, lng: -7.988, kind: 'restaurant' });

/** Posiłek z trzema knajpami do wyboru: A (posiłek), B i C (kopie). */
function threeChoices() {
  const edit = addEatOutChoices(maroko, 'd2-lunch', [{ eatery: eatery('A', 0) }, { eatery: eatery('B', 0.01) }, { eatery: eatery('C', 0.02) }], newRef)!;
  const refs = Object.fromEntries(mealEateries(edit.doc, 'd2-lunch').map((each) => [each.name, each.placeRef]));
  return { doc: edit.doc, refs };
}

describe('odpinanie knajpy od posiłku', () => {
  it('jedyna knajpa: posiłek traci miejsce, miejsce zostaje w planie', () => {
    const pinned = addEatOutChoices(maroko, 'd2-lunch', [{ eatery: eatery('Jedyna', 0) }], newRef)!;
    const placeRef = pinned.pinned[0]!;
    const edit = removeEatOutChoice(pinned.doc, 'd2-lunch', placeRef)!;
    expect(edit.doc.items.find((each) => each.ref === 'd2-lunch')!.placeRef).toBeUndefined();
    expect(edit.doc.places.some((each) => each.ref === placeRef)).toBe(true);
    expect(edit.writes.map((each) => [each.collection, each.op])).toEqual([['items', 'update']]);
    expect(removeEatOutChoice(edit.doc, 'd2-lunch', placeRef)).toBeNull();
  });

  it('kopia z grupy: znika jej wariant i punkt, reszta zostaje', () => {
    const { doc, refs } = threeChoices();
    const edit = removeEatOutChoice(doc, 'd2-lunch', refs.B!)!;
    expect(mealEateries(edit.doc, 'd2-lunch').map((each) => each.name)).toEqual(['A', 'C']);
    expect(edit.doc.items.length).toBe(doc.items.length - 1);
    expect(edit.writes.map((each) => [each.collection, each.op])).toEqual([
      ['items', 'remove'],
      ['variants', 'remove'],
    ]);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('własna knajpa posiłku: posiłek zostaje i przejmuje następną (polecaną), a jej kopia znika', () => {
    const { doc, refs } = threeChoices();
    const group = eatOutGroup(doc, 'd2-lunch')!;
    const chosen = { ...doc, variantGroups: doc.variantGroups.map((each) => (each.ref === group.ref ? { ...each, chosenRef: doc.items.find((item) => item.ref === 'd2-lunch')!.variantRefs[0]! } : each)) };
    const edit = removeEatOutChoice(chosen, 'd2-lunch', refs.A!)!;
    const meal = edit.doc.items.find((each) => each.ref === 'd2-lunch')!;
    expect(meal.placeRef).toBe(refs.B);
    expect(mealEateries(edit.doc, 'd2-lunch').map((each) => each.name)).toEqual(['B', 'C']);
    expect(edit.doc.variants.find((each) => meal.variantRefs.includes(each.ref))!.recommended).toBe(true);
    expect(eatOutGroup(edit.doc, 'd2-lunch')!.chosenRef).toBeUndefined();
    expect(edit.doc.items.length).toBe(doc.items.length - 1);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('zostaje jedna: grupa, warianty i kopie znikają, posiłek ma miejsce tej knajpy', () => {
    const { doc, refs } = threeChoices();
    const two = removeEatOutChoice(doc, 'd2-lunch', refs.B!)!.doc;
    const edit = removeEatOutChoice(two, 'd2-lunch', refs.A!)!;
    const meal = edit.doc.items.find((each) => each.ref === 'd2-lunch')!;
    expect(meal).toMatchObject({ placeRef: refs.C, variantRefs: [] });
    expect(eatOutGroup(edit.doc, 'd2-lunch')).toBeUndefined();
    expect(edit.doc.variantGroups.length).toBe(maroko.variantGroups.length);
    expect(edit.doc.variants.length).toBe(maroko.variants.length);
    expect(edit.doc.items.length).toBe(maroko.items.length);
    expect(mealEateries(edit.doc, 'd2-lunch').map((each) => each.name)).toEqual(['C']);
    expect(edit.writes.map((each) => [each.collection, each.op])).toEqual([
      ['items', 'update'],
      ['items', 'remove'],
      ['variants', 'remove'],
      ['variants', 'remove'],
      ['variantGroups', 'remove'],
    ]);
    expect(documentProblem(edit.doc)).toBeNull();
  });
});
