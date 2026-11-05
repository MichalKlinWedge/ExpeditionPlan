import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { addMeal, headcount, isShopping, linkMeal, mealList, mealPoints, mealPointsFor, selfCookedTotals } from '../meals.ts';
import { dayItems, dropItem, moveToDay, moveWithinDay, removeItem } from '../plan-edits.ts';
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

describe('nowy posiłek ze strony „Posiłki”', () => {
  it('śniadanie o 8:00 trafia przed punkty z późniejszą godziną, bez godziny — na koniec dnia', () => {
    const maroko = load('maroko');
    const day = maroko.days[1]!.ref;
    const breakfast = addMeal(maroko, day, 'sniadanie', { title: 'Śniadanie', time: '08:00', selfCooked: true });
    expect(TripDocument.safeParse(breakfast.doc).success).toBe(true);
    const meals = mealList(breakfast.doc).filter((meal) => meal.dayRef === day);
    expect(meals[0]).toMatchObject({ itemRef: 'id-sniadanie', title: 'Śniadanie', selfCooked: true });
    expect(breakfast.created).toMatchObject({ kind: 'meal', durationMin: 60, time: { precision: 'approx', start: '08:00' } });

    const snack = addMeal(maroko, day, 'przekaska', { title: 'Przekąska' });
    expect(mealList(snack.doc).filter((meal) => meal.dayRef === day).at(-1)?.title).toBe('Przekąska');
  });
});

describe('posiłek przy punkcie planu', () => {
  const point = (ref: string, sortKey: string, fields: Record<string, unknown> = {}) => ({ ref, sortKey, dayRef: 'd1', title: ref, kind: 'visit', planStatus: 'scheduled', durationMin: 60, ...fields });
  const plan = (items: Record<string, unknown>[]) =>
    TripDocument.parse({
      schemaVersion: 1,
      trip: { title: 'Test', startDate: '2026-12-11', endDate: '2026-12-12', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
      days: [
        { ref: 'd1', date: '2026-12-11', tz: 'Europe/Warsaw' },
        { ref: 'd2', date: '2026-12-12', tz: 'Europe/Warsaw' },
      ],
      places: [{ ref: 'chatka', name: 'Chatka' }],
      travelers: [{ ref: 'ola', name: 'Ola' }, { ref: 'jan', name: 'Jan' }],
      variantGroups: [{ ref: 'g', scope: 'item', title: 'g', conditionKind: 'choice' }],
      variants: [{ ref: 'v', groupRef: 'g', label: 'v' }],
      items,
    });
  const base = () =>
    plan([
      point('a', 'a', { time: { precision: 'exact', start: '10:00' }, placeRef: 'chatka' }),
      point('b', 'b', { durationMin: 30 }),
      point('obiad', 'c', { kind: 'meal', time: { precision: 'approx', start: '10:20' }, durationMin: 90 }),
      point('c', 'd', { durationMin: 30 }),
    ]);
  const order = (doc: TripDocument, day = 'd1') => dayItems(doc, day).map((item) => item.ref);
  const at = (doc: TripDocument, ref: string, day = 'd1') => scheduleDay(doc, day).items.find((item) => item.ref === ref)!;

  it('spięty staje pod punktem, godzinę liczy od niego, miejsce bierze z punktu', () => {
    const { doc } = linkMeal(base(), 'obiad', 'a')!;
    const meal = doc.items.find((item) => item.ref === 'obiad')!;
    expect(order(doc)).toEqual(['a', 'obiad', 'b', 'c']);
    expect(meal.time).toEqual({ precision: 'relative', offsetMin: 20, from: 'previous' });
    expect(meal.placeRef).toBe('chatka');
    expect(at(doc, 'obiad').startLocal).toBe('10:20');
    expect(at(doc, 'obiad').child).toBe(true);
    expect(mealList(doc)[0]!.at).toEqual({ ref: 'a', title: 'a', stop: false });
  });

  it('kolejny punkt czeka, aż skończą jeść, a krótszy posiłek dnia nie wydłuża', () => {
    const { doc } = linkMeal(base(), 'obiad', 'a')!;
    expect(at(doc, 'b').startLocal).toBe('11:50');
    const short = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'obiad' ? { ...item, durationMin: 20 } : item)) });
    expect(at(short, 'b').startLocal).toBe('11:00');
  });

  it('idzie za punktem, gdy zmienia się jego godzina', () => {
    const { doc } = linkMeal(base(), 'obiad', 'a')!;
    const later = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'a' ? { ...item, time: { precision: 'exact', start: '12:00' } } : item)) });
    expect(at(later, 'obiad').startLocal).toBe('12:20');
    expect(at(later, 'obiad').driftMin).toBe(0);
  });

  it('godzina przed punktem albo brak godziny: razem z punktem', () => {
    const early = plan([point('a', 'a', { time: { precision: 'exact', start: '12:00' } }), point('m', 'b', { kind: 'meal', time: { precision: 'approx', start: '09:00' } })]);
    const { doc } = linkMeal(early, 'm', 'a')!;
    expect(doc.items.find((item) => item.ref === 'm')!.time).toBeUndefined();
    expect(at(doc, 'm').startLocal).toBe('12:00');
  });

  it('godzina stała zostaje', () => {
    const fixed = plan([point('a', 'a', { time: { precision: 'exact', start: '10:00' } }), point('m', 'b', { kind: 'meal', isFixed: true, time: { precision: 'exact', start: '10:30' } })]);
    expect(linkMeal(fixed, 'm', 'a')!.doc.items.find((item) => item.ref === 'm')!.time).toEqual({ precision: 'exact', start: '10:30' });
  });

  it('przy przejeździe to postój w trasie: wydłuża przejazd i nie rusza miejsca', () => {
    const road = plan([point('jazda', 'a', { kind: 'transport', time: { precision: 'exact', start: '08:00' }, placeRef: 'chatka' }), point('m', 'b', { kind: 'meal', durationMin: 40 }), point('x', 'c')]);
    const { doc } = linkMeal(road, 'm', 'jazda')!;
    expect(at(doc, 'jazda').durationMin).toBe(100);
    expect(at(doc, 'm').routeStop).toBe(true);
    expect(doc.items.find((item) => item.ref === 'm')!.placeRef).toBeUndefined();
    expect(mealList(doc)[0]!.at!.stop).toBe(true);
  });

  it('odpięcie: zaraz po punkcie, bez godziny liczonej od niego', () => {
    const { doc } = linkMeal(base(), 'obiad', 'a')!;
    const free = linkMeal(doc, 'obiad', null)!.doc;
    const meal = free.items.find((item) => item.ref === 'obiad')!;
    expect(meal.parentRef).toBeUndefined();
    expect(meal.time).toBeUndefined();
    expect(order(free)).toEqual(['a', 'obiad', 'b', 'c']);
    expect(at(free, 'obiad').startLocal).toBe('11:00');
    expect(linkMeal(free, 'obiad', null)).toBeNull();
  });

  it('lista punktów: bez posiłków, podpunktów i punktów części grupy; posiłek z wariantu także przy punktach tego wariantu', () => {
    const doc = plan([
      point('a', 'a'),
      point('dziecko', 'b', { parentRef: 'a' }),
      point('m', 'c', { kind: 'meal' }),
      point('inny', 'd', { kind: 'meal' }),
      point('ekipa', 'e', { participantRefs: ['ola'] }),
    ]);
    expect(mealPoints(doc, 'd1').map((item) => item.ref)).toEqual(['a']);
    expect(mealPointsFor(doc, 'm').map((item) => item.ref)).toEqual(['a']);
    expect(linkMeal(doc, 'm', 'inny')).toBeNull();
    const variant = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'm' ? { ...item, variantRefs: ['v'] } : item)) });
    expect(mealPointsFor(variant, 'm').map((item) => item.ref)).toEqual(['a']);

    const withStop = plan([point('a', 'a'), point('w', 'b', { variantRefs: ['v'] }), point('m', 'c', { kind: 'meal', variantRefs: ['v'] }), point('wspolny', 'd', { kind: 'meal' })]);
    expect(mealPointsFor(withStop, 'm').map((item) => item.ref)).toEqual(['a', 'w']);
    // Posiłek wspólny jest w planie także bez tego wariantu, więc punkt z wariantu nie wchodzi w grę.
    expect(mealPointsFor(withStop, 'wspolny').map((item) => item.ref)).toEqual(['a']);
    const linked = linkMeal(withStop, 'm', 'w')!;
    expect(linked.doc.items.find((item) => item.ref === 'm')!.parentRef).toBe('w');
    expect(scheduleDay(linked.doc, 'd1').items.find((item) => item.ref === 'm')!.child).toBe(true);
  });

  it('wszystkie warianty: posiłki z niewybranych wariantów są na liście z oznaczeniem, a porcje liczą tylko wybrane', () => {
    const doc = load('barcelona');
    const ref = 'd1-gotyk-kolacja';
    expect(mealList(doc).some((meal) => meal.itemRef === ref)).toBe(false);
    const all = mealList(doc, { allVariants: true });
    expect(all.length).toBe(mealList(doc).length + 1);
    const meal = all.find((each) => each.itemRef === ref)!;
    expect(meal.variants).toHaveLength(1);
    expect(meal.variants![0]!.active).toBe(false);
    expect(meal.place).toBeDefined();
    expect(mealList(doc).every((each) => each.variants === undefined || each.variants.some((variant) => variant.active))).toBe(true);

    const cooked = all.map((each) => ({ ...each, selfCooked: true }));
    expect(selfCookedTotals(cooked).meals).toBe(all.length - 1);
  });

  it('posiłek w wybranym wariancie jest na liście także ze statusem alternatywy', () => {
    const doc = load('barcelona');
    const variant = doc.items.find((item) => item.ref === 'd1-gotyk-kolacja')!.variantRefs[0]!;
    const groupRef = doc.variants.find((each) => each.ref === variant)!.groupRef;
    const chosen = TripDocument.parse({ ...doc, variantGroups: doc.variantGroups.map((group) => (group.ref === groupRef ? { ...group, chosenRef: variant } : group)) });
    const meal = mealList(chosen).find((each) => each.itemRef === 'd1-gotyk-kolacja')!;
    expect(meal.variants![0]!.active).toBe(true);
  });

  it('nowy posiłek od razu przy punkcie', () => {
    const edit = addMeal(base(), 'd1', '0190', { title: 'Kolacja', time: '10:30', atRef: 'a' });
    expect(edit.created!.parentRef).toBe('a');
    expect(edit.created!.time).toEqual({ precision: 'relative', offsetMin: 30, from: 'previous' });
    expect(order(edit.doc).slice(0, 2)).toEqual(['a', edit.created!.ref]);
    expect(edit.changed.some((item) => item.ref === edit.created!.ref)).toBe(false);
  });

  describe('przenoszenie', () => {
    const linked = () => linkMeal(base(), 'obiad', 'a')!.doc;

    it('w górę i w dół: punkt idzie z posiłkiem, a sąsiad przeskakuje cały blok', () => {
      const down = moveWithinDay(linked(), 'a', 1)!.doc;
      expect(order(down)).toEqual(['b', 'a', 'obiad', 'c']);
      expect(order(moveWithinDay(down, 'a', -1)!.doc)).toEqual(['a', 'obiad', 'b', 'c']);
      expect(order(moveWithinDay(linked(), 'b', -1)!.doc)).toEqual(['b', 'a', 'obiad', 'c']);
    });

    it('posiłek nie wychodzi strzałką z bloku', () => {
      expect(moveWithinDay(linked(), 'obiad', -1)).toBeNull();
      expect(moveWithinDay(linked(), 'obiad', 1)).toBeNull();
    });

    it('do innego dnia: posiłek razem z punktem', () => {
      const { doc } = moveToDay(linked(), 'a', 'd2')!;
      expect(order(doc, 'd2')).toEqual(['a', 'obiad']);
      expect(doc.items.find((item) => item.ref === 'obiad')!.parentRef).toBe('a');
    });

    it('do puli: punkt idzie sam, posiłek zostaje w dniu bez spięcia', () => {
      const { doc } = moveToDay(linked(), 'a', null)!;
      const meal = doc.items.find((item) => item.ref === 'obiad')!;
      expect(meal.dayRef).toBe('d1');
      expect(meal.parentRef).toBeUndefined();
    });

    it('przeciąganie: punkt z posiłkiem, cudzy punkt nie ląduje w bloku, posiłek poza blokiem się odpina', () => {
      expect(order(dropItem(linked(), 'a', 'd1', 'c')!.doc)).toEqual(['b', 'a', 'obiad', 'c']);
      expect(order(dropItem(linked(), 'c', 'd1', 'obiad')!.doc)).toEqual(['a', 'obiad', 'c', 'b']);
      const out = dropItem(linked(), 'obiad', 'd1', 'c')!.doc;
      expect(out.items.find((item) => item.ref === 'obiad')!.parentRef).toBeUndefined();
      expect(order(out)).toEqual(['a', 'b', 'obiad', 'c']);
    });

    it('usunięcie punktu zostawia posiłek bez spięcia', () => {
      const { doc } = removeItem(linked(), 'a')!;
      expect(doc.items.find((item) => item.ref === 'obiad')!.parentRef).toBeUndefined();
    });
  });
});
