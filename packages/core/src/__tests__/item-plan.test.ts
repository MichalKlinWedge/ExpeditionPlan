import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemInPlan, itemPlanFacts, planSequence, variantsForItem } from '../item-plan.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const item = (ref: string) => maroko.items.find((each) => each.ref === ref)!;

describe('punkt na tle planu', () => {
  it('kolejność planu przechodzi przez dni, a wybrany wariant zmienia sąsiadów', () => {
    const steps = planSequence(maroko);
    expect(steps.map((step) => step.dayRef)).toEqual([...steps.map((step) => step.dayRef)].sort());
    const plain = steps.map((step) => step.ref);
    expect(plain).toContain('d4-plaza');
    expect(plain).not.toContain('d4-paradise');
    const b = planSequence(maroko, { activeVariants: { 'd4-wariant': 'd4-v-b' } }).map((step) => step.ref);
    expect(b).toContain('d4-paradise');
    expect(b).not.toContain('d4-plaza');
    // Ostatni punkt dnia 1 prowadzi do pierwszego punktu dnia 2.
    const lastOfDay1 = steps.filter((step) => step.dayRef === 'd1').at(-1)!;
    expect(itemInPlan(maroko, lastOfDay1.ref).next?.dayRef).toBe('d2');
  });

  it('godziny i sąsiedzi z silnika; pierwszy punkt nie ma poprzedniego', () => {
    const first = planSequence(maroko)[0]!;
    const plan = itemInPlan(maroko, first.ref);
    expect(plan.previous).toBeUndefined();
    expect(plan.next).toBeDefined();
    expect(plan.scheduled?.startLocal).toMatch(/^\d\d:\d\d$/);
  });

  it('punkt innego wariantu niż wybrany: kolejność wg jego wariantu', () => {
    const paradise = item('d4-paradise');
    const chosen = variantsForItem(maroko, paradise);
    expect(chosen.switched).toEqual({ groupRef: 'd4-wariant', variantRef: 'd4-v-b' });
    expect(itemInPlan(maroko, paradise.ref, { activeVariants: chosen.variants }).scheduled).toBeDefined();
    expect(itemInPlan(maroko, paradise.ref).scheduled).toBeUndefined();
    expect(variantsForItem(maroko, item('d4-plaza')).switched).toBeUndefined();
  });

  it('szczegóły z planu: wariant i cena', () => {
    const facts = itemPlanFacts(maroko, item('d4-paradise'));
    expect(facts.find((fact) => fact.label === 'Wariant')?.text).toContain('„');
    expect(itemPlanFacts(maroko, item('d2-medersa')).find((fact) => fact.label === 'Cena')?.text).toContain('za 5 os.');
  });
});
