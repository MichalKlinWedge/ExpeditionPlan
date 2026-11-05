import { eatOutGroup, mealEateries } from './eat-out.ts';
import { activeVariants, itemsForDay, type ScheduleOptions, scheduleDay } from './engine/schedule.ts';
import { MINUTE, minutesOfDay, zonedToInstant } from './engine/time.ts';
import { addItem, dayItems, heldTime, placeAfterBlock, type PlanEdit } from './plan-edits.ts';
import type { DayMap } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { keyBetween } from './sort-key.ts';

/**
 * Jedzenie i zakupy: posiłki z planu (punkty `meal`) dzień po dniu i liczba osób — dorośli
 * i dzieci osobno — jako punkt wyjścia do listy zakupów. Plan sam nie mówi, które posiłki są
 * „własne” (chatka, ognisko), a które w lokalu — to zaznacza użytkownik (`selfCooked`).
 * Lista zakupów to pozycje listy pakowania w kategorii `zakupy` (wspólne): na telefonie
 * odhacza się je offline jak pakowanie.
 */

type Doc = TripDocument;
type Packing = Doc['packing'][number];
type Traveler = Doc['travelers'][number];
type Item = Doc['items'][number];

export const SHOPPING_CATEGORY = 'zakupy';

export const isShopping = (item: Pick<Packing, 'category'>) => item.category.trim().toLowerCase() === SHOPPING_CATEGORY;

export type People = { adults: number; children: number };
export type Meal = { dayRef: string; date: string; dayNo: number; itemRef: string; title: string; placeRef?: string; place?: string; selfCooked?: boolean; people: People; at?: MealPoint; variants?: MealVariant[] };
/** Wariant planu, w którym jest posiłek. Posiłek bez aktywnego wariantu nie liczy się do porcji. */
export type MealVariant = { ref: string; label: string; active: boolean };
/** Punkt planu, przy którym jest posiłek; `stop` = przejazd, posiłek to postój w trasie. */
export type MealPoint = { ref: string; title: string; stop: boolean };

/** Dziecko = poniżej 13 lat albo (bez wieku) z opiekunem — jak „dorosły od 13 lat” u operatorów. */
const isChild = (traveler: Traveler) => (traveler.age !== undefined ? traveler.age < 13 : traveler.guardianRef !== undefined);

function count(travelers: Traveler[]): People {
  const children = travelers.filter(isChild).length;
  return { adults: travelers.length - children, children };
}

export const headcount = (doc: Doc): People => count(doc.travelers);

/**
 * Posiłki dnia po dniu; osoby z `participantRefs` punktu, inaczej cała grupa. Posiłek w wariantach
 * (knajpy do wyboru, `eat-out.ts`) liczy się raz — w wariancie, który jest teraz wybrany.
 * `allVariants` dokłada do przeglądania posiłki z pozostałych wariantów planu, z oznaczeniem wariantu.
 * Kopie posiłku dla kolejnych knajp zostają poza listą: te knajpy stoją pod posiłkiem (`mealEateries`).
 */
export function mealList(doc: Doc, options: { allVariants?: boolean } = {}): Meal[] {
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  const active = activeVariants(doc);
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const listed = (item: Item) => {
    if (item.kind !== 'meal') return false;
    if (item.variantRefs.length === 0) return item.planStatus === 'scheduled';
    return item.variantRefs.some((ref) => active.has(ref)) || (options.allVariants === true && eatOutGroup(doc, item.ref) === undefined);
  };
  const variantsOf = (item: Item) =>
    doc.variants.flatMap((variant) => (item.variantRefs.includes(variant.ref) ? [{ ref: variant.ref, label: variant.label, active: active.has(variant.ref) }] : []));
  return doc.days.flatMap((day, index) =>
    dayItems(doc, day.ref)
      .filter(listed)
      .map((item) => ({
        dayRef: day.ref,
        date: day.date,
        dayNo: index + 1,
        itemRef: item.ref,
        title: item.title,
        ...(item.placeRef === undefined ? {} : { placeRef: item.placeRef }),
        place: item.placeRef === undefined ? undefined : places.get(item.placeRef),
        selfCooked: item.selfCooked,
        ...(item.parentRef !== undefined && items.has(item.parentRef) ? { at: { ref: item.parentRef, title: items.get(item.parentRef)!.title, stop: items.get(item.parentRef)!.kind === 'transport' } } : {}),
        people: item.participantRefs === undefined ? headcount(doc) : count(doc.travelers.filter((traveler) => item.participantRefs!.includes(traveler.ref))),
        ...(item.variantRefs.length > 0 && eatOutGroup(doc, item.ref) === undefined ? { variants: variantsOf(item) } : {}),
      })),
  );
}

/** Dzień z jego posiłkami, także bez żadnego: na stronie „Posiłki” widać, gdzie nic nie zaplanowano. */
export type MealDay = { dayRef: string; date: string; dayNo: number; meals: Meal[] };

export function mealDays(doc: Doc, meals: Meal[] = mealList(doc)): MealDay[] {
  return doc.days.map((day, index) => ({ dayRef: day.ref, date: day.date, dayNo: index + 1, meals: meals.filter((meal) => meal.dayRef === day.ref) }));
}

/** Miejsca posiłku: jego własne i przypięte knajpy, także te jeszcze niewybrane. */
export function mealPlaceRefs(doc: Doc, meal: Pick<Meal, 'itemRef' | 'placeRef'>): string[] {
  return [...new Set([...(meal.placeRef === undefined ? [] : [meal.placeRef]), ...mealEateries(doc, meal.itemRef).map((each) => each.placeRef)])];
}

/**
 * Mapa posiłków: numer na miejsce ze współrzędnymi, po kolei od pierwszego użycia. Posiłki w tym samym
 * lokalu mają ten sam numer, bo mapa i opis pod nią dotyczą miejsca, nie posiłku. Knajpy do wyboru też mają pinezki.
 */
export function mealMap(doc: Doc, meals: Meal[] = mealList(doc)): { numbers: Record<string, number>; map: DayMap } {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const numbers: Record<string, number> = {};
  const pins: DayMap['pins'] = [];
  for (const meal of meals) {
    for (const ref of mealPlaceRefs(doc, meal)) {
      const place = places.get(ref);
      if (place?.lat === undefined || place.lng === undefined) continue;
      const line = `Dzień ${meal.dayNo}: ${meal.title}`;
      const pin = pins.find((each) => each.placeRef === place.ref);
      if (pin !== undefined) {
        if (!pin.stops[0]!.title.split(', ').includes(line)) pin.stops[0]!.title += `, ${line}`;
        continue;
      }
      const n = pins.length + 1;
      numbers[place.ref] = n;
      pins.push({ placeRef: place.ref, name: place.name, lat: place.lat, lng: place.lng, stops: [{ ref: place.ref, n, title: line }] });
    }
  }
  return { numbers, map: { pins, lines: [], numbers: {} } };
}

/** Godzina posiłku do listy: własna („ok. 13:00”), a posiłek spięty z punktem liczy ją od punktu. Postój w trasie godziny nie pokazuje. */
export function mealTime(doc: Doc, meal: Meal): string | null {
  const time = doc.items.find((item) => item.ref === meal.itemRef)?.time;
  if (time !== undefined && 'start' in time && time.start !== undefined) return `${time.precision === 'approx' ? 'ok. ' : ''}${time.start}`;
  if (meal.at === undefined || meal.at.stop) return null;
  const counted = scheduleDay(doc, meal.dayRef).items.find((each) => each.ref === meal.itemRef)?.startLocal;
  return counted ? `ok. ${counted}` : null;
}

/** Ile posiłków robicie sami i ile to „posiłko-osób” (dorośli i dzieci osobno). Posiłek z niewybranego wariantu się nie liczy. */
export function selfCookedTotals(meals: Meal[]): { meals: number } & People {
  const own = meals.filter((meal) => meal.selfCooked === true && (meal.variants === undefined || meal.variants.some((variant) => variant.active)));
  return { meals: own.length, adults: own.reduce((sum, meal) => sum + meal.people.adults, 0), children: own.reduce((sum, meal) => sum + meal.people.children, 0) };
}

/** Punkty dnia, przy których może być posiłek: główne punkty, wspólne dla grupy, poza wariantami i innymi posiłkami. */
export function mealPoints(doc: Doc, dayRef: string, options: ScheduleOptions = {}): Item[] {
  return itemsForDay(doc, dayRef, options).filter((item) => isMealPoint(item) && item.variantRefs.length === 0);
}

const isMealPoint = (item: Item) => item.parentRef === undefined && item.kind !== 'meal' && (item.participantRefs ?? []).length === 0;

/**
 * Do czego można spiąć ten posiłek: punkt wspólny, a posiłek z wariantu także punkt obecny we wszystkich
 * jego wariantach, bo punkt musi być w planie zawsze wtedy, gdy posiłek. Pusto, gdy posiłek ma własne podpunkty.
 */
export function mealPointsFor(doc: Doc, ref: string, options: ScheduleOptions = {}): Item[] {
  const meal = doc.items.find((item) => item.ref === ref);
  if (meal?.dayRef === undefined || doc.items.some((item) => item.parentRef === ref)) return [];
  const inVariant = meal.variantRefs.length > 0;
  return itemsForDay(doc, meal.dayRef, options).filter(
    (item) => isMealPoint(item) && (item.variantRefs.length === 0 || (inVariant && meal.variantRefs.every((variant) => item.variantRefs.includes(variant)))),
  );
}

/** Godzina posiłku po spięciu: liczona od początku punktu, żeby szła razem z nim. Godzina trzymana (stała, bilet) zostaje. */
function timeAtPoint(doc: Doc, meal: Item, parentRef: string, options: ScheduleOptions): Pick<Item, 'time' | 'durationMin'> {
  const time = meal.time;
  if (time === undefined || !('start' in time) || heldTime(meal)) return { time, durationMin: meal.durationMin };
  const day = doc.days.find((each) => each.ref === meal.dayRef)!;
  const start = scheduleDay(doc, day.ref, options).items.find((each) => each.ref === parentRef)?.start;
  const offset = start === undefined ? 0 : Math.round((zonedToInstant(day.date, time.start, time.tz ?? day.tz) - start) / MINUTE);
  return {
    time: offset > 0 ? { precision: 'relative', offsetMin: offset, from: 'previous' } : undefined,
    durationMin: meal.durationMin ?? (time.precision === 'range' ? minutesOfDay(time.end) - minutesOfDay(time.start) : undefined),
  };
}

/**
 * Spina posiłek z punktem planu (`null` = odpina). Spięty stoi w planie zaraz pod punktem, zaczyna się
 * razem z nim albo tyle minut po nim, ile wynikało z jego godziny, i przenosi się razem z nim; miejsce bierze
 * z punktu, jeśli nie ma własnego. Przy przejeździe to postój w trasie: wydłuża przejazd.
 */
export function linkMeal(doc: Doc, ref: string, parentRef: string | null, options: ScheduleOptions = {}): PlanEdit | null {
  const meal = doc.items.find((item) => item.ref === ref);
  if (meal?.dayRef === undefined || (meal.parentRef ?? null) === parentRef) return null;
  if (parentRef === null) {
    const { parentRef: previous, ...free } = meal;
    // Godzina liczona od punktu traci sens: bez niej posiłek idzie zaraz po nim.
    return placeAfterBlock(doc, { ...free, routeParentRefs: [], time: free.time?.precision === 'relative' ? undefined : free.time }, previous!);
  }
  const parent = mealPointsFor(doc, ref, options).find((item) => item.ref === parentRef);
  if (parent === undefined) return null;
  if (parent.kind === 'transport') return placeAfterBlock(doc, { ...meal, parentRef, routeParentRefs: [] }, parentRef);
  const edit = placeAfterBlock(doc, { ...meal, parentRef, routeParentRefs: [], placeRef: meal.placeRef ?? parent.placeRef, time: undefined }, parentRef);
  const fields = timeAtPoint(edit.doc, { ...edit.doc.items.find((item) => item.ref === ref)!, time: meal.time }, parentRef, options);
  const apply = (item: Item) => (item.ref === ref ? { ...item, ...fields } : item);
  return { ...edit, doc: { ...edit.doc, items: edit.doc.items.map(apply) }, changed: edit.changed.map(apply) };
}

/** Godzina punktu z planu (dokładna albo „ok.”) — do ułożenia nowego posiłku w dniu. */
const startOf = (item: Doc['items'][number]) => (item.time?.precision === 'exact' || item.time?.precision === 'approx' ? item.time.start : undefined);

/**
 * Nowy posiłek w dniu (strona „Posiłki”: śniadanie, obiad, kolacja…): punkt „jedzenie” z godziną
 * „ok. HH:MM” wstawiony przed pierwszym punktem dnia, który ma późniejszą godzinę (bez godziny —
 * na koniec dnia). Czas trwania domyślnie 60 min; „gotujemy sami” od razu, jeśli zaznaczone. Z `atRef` od razu
 * spięty z tym punktem (`linkMeal`).
 */
export function addMeal(doc: Doc, dayRef: string, id: string, meal: { title: string; time?: string; durationMin?: number; selfCooked?: boolean; atRef?: string }): PlanEdit {
  const edit = placeNewMeal(doc, dayRef, id, meal);
  if (meal.atRef === undefined) return edit;
  const linked = linkMeal(edit.doc, edit.created!.ref, meal.atRef);
  if (linked === null) return edit;
  const created = linked.doc.items.find((item) => item.ref === edit.created!.ref)!;
  return { ...linked, created, changed: linked.changed.filter((item) => item.ref !== created.ref) };
}

function placeNewMeal(doc: Doc, dayRef: string, id: string, meal: { title: string; time?: string; durationMin?: number; selfCooked?: boolean }): PlanEdit {
  const edit = addItem(doc, dayRef, id, {
    title: meal.title,
    kind: 'meal',
    durationMin: meal.durationMin ?? 60,
    ...(meal.time ? { time: { precision: 'approx' as const, start: meal.time } } : {}),
    ...(meal.selfCooked ? { selfCooked: true } : {}),
  });
  if (!meal.time) return edit;
  const items = dayItems(doc, dayRef);
  const at = items.findIndex((item) => {
    const start = startOf(item);
    return start !== undefined && start > meal.time!;
  });
  if (at === -1) return edit;
  const created = { ...edit.created!, sortKey: keyBetween(items[at - 1]?.sortKey, items[at]!.sortKey) };
  return { ...edit, doc: { ...edit.doc, items: edit.doc.items.map((item) => (item.ref === created.ref ? created : item)) }, created };
}
