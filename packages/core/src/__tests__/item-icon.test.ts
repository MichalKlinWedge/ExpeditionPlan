import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemIcon } from '../item-icon.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const item = (ref: string) => maroko.items.find((each) => each.ref === ref)!;

describe('ikona punktu planu', () => {
  it('przejazd według środka, lot z rezerwacji, reszta według rodzaju', () => {
    expect(itemIcon(maroko, item('d5-wylot'))).toBe('✈️');
    expect(itemIcon(maroko, item('d1-przylot'))).toBe('✈️');
    expect(itemIcon(maroko, item('d1-suki'))).toBe('🏛️');
    const car = maroko.items.find((each) => each.leg?.mode === 'car' || each.leg?.mode === 'rental_car');
    if (car) expect(itemIcon(maroko, car)).toBe('🚗');
    const meal = maroko.items.find((each) => each.kind === 'meal')!;
    expect(itemIcon(maroko, meal)).toBe('🍽️');
  });
});
