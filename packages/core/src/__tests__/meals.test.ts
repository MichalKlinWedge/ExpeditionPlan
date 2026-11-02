import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { headcount, isShopping, mealList, selfCookedTotals } from '../meals.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('jedzenie i zakupy', () => {
  it('posiłki z planu dzień po dniu, z miejscem', () => {
    const chatka = load('chatka');
    const meals = mealList(chatka);
    expect(meals.length).toBeGreaterThan(0);
    expect(meals.map((meal) => meal.dayNo)).toEqual([...meals.map((meal) => meal.dayNo)].sort((a, b) => a - b));
    expect(meals.find((meal) => meal.title === 'KOLACJA')).toMatchObject({ dayNo: 1, place: 'Chatka Sylwestrowa' });
  });

  it('dzieci: wiek poniżej 13 albo opiekun bez wieku', () => {
    expect(headcount(load('chatka'))).toEqual({ adults: 5, children: 6 });
    // Maroko: 16 lat to już dorosły, 10 lat — dziecko.
    expect(headcount(load('maroko'))).toEqual({ adults: 4, children: 1 });
  });

  it('lista zakupów = kategoria „zakupy” bez względu na wielkość liter', () => {
    expect(isShopping({ category: 'Zakupy ' })).toBe(true);
    expect(isShopping({ category: 'jedzenie' })).toBe(false);
  });
});

describe('posiłki „gotujemy sami”', () => {
  it('sumy porcji tylko z zaznaczonych posiłków; uczestnicy punktu zamiast całej grupy', () => {
    const chatka = load('chatka');
    const kolacja = chatka.items.find((item) => item.title === 'KOLACJA')!;
    const sniadanie = chatka.items.find((item) => item.title === 'Pobudka, śniadanie')!;
    const adults = chatka.travelers.filter((traveler) => traveler.guardianRef === undefined).map((traveler) => traveler.ref);
    const doc = {
      ...chatka,
      items: chatka.items.map((item) =>
        item.ref === kolacja.ref ? { ...item, selfCooked: true } : item.ref === sniadanie.ref ? { ...item, selfCooked: true, participantRefs: adults.slice(0, 2) } : item,
      ),
    };
    const meals = mealList(doc);
    expect(meals.find((meal) => meal.itemRef === kolacja.ref)).toMatchObject({ selfCooked: true, people: { adults: 5, children: 6 } });
    expect(selfCookedTotals(meals)).toEqual({ meals: 2, adults: 7, children: 6 });
  });
});
