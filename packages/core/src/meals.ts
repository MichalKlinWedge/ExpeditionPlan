import { dayItems } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';

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

export const SHOPPING_CATEGORY = 'zakupy';

export const isShopping = (item: Pick<Packing, 'category'>) => item.category.trim().toLowerCase() === SHOPPING_CATEGORY;

export type People = { adults: number; children: number };
export type Meal = { dayRef: string; date: string; dayNo: number; itemRef: string; title: string; place?: string; selfCooked?: boolean; people: People };

/** Dziecko = poniżej 13 lat albo (bez wieku) z opiekunem — jak „dorosły od 13 lat” u operatorów. */
const isChild = (traveler: Traveler) => (traveler.age !== undefined ? traveler.age < 13 : traveler.guardianRef !== undefined);

function count(travelers: Traveler[]): People {
  const children = travelers.filter(isChild).length;
  return { adults: travelers.length - children, children };
}

export const headcount = (doc: Doc): People => count(doc.travelers);

/** Posiłki dnia po dniu; osoby z `participantRefs` punktu, inaczej cała grupa. */
export function mealList(doc: Doc): Meal[] {
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  return doc.days.flatMap((day, index) =>
    dayItems(doc, day.ref)
      .filter((item) => item.kind === 'meal' && item.planStatus === 'scheduled')
      .map((item) => ({
        dayRef: day.ref,
        date: day.date,
        dayNo: index + 1,
        itemRef: item.ref,
        title: item.title,
        place: item.placeRef === undefined ? undefined : places.get(item.placeRef),
        selfCooked: item.selfCooked,
        people: item.participantRefs === undefined ? headcount(doc) : count(doc.travelers.filter((traveler) => item.participantRefs!.includes(traveler.ref))),
      })),
  );
}

/** Ile posiłków robicie sami i ile to „posiłko-osób” (dorośli i dzieci osobno). */
export function selfCookedTotals(meals: Meal[]): { meals: number } & People {
  const own = meals.filter((meal) => meal.selfCooked === true);
  return { meals: own.length, adults: own.reduce((sum, meal) => sum + meal.people.adults, 0), children: own.reduce((sum, meal) => sum + meal.people.children, 0) };
}
