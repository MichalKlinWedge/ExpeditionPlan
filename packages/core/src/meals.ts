import { dayItems } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Jedzenie i zakupy: posiłki z planu (punkty `meal`) dzień po dniu i liczba osób — dorośli
 * i dzieci osobno — jako punkt wyjścia do listy zakupów. Plan nie mówi, które posiłki są
 * „własne” (chatka, ognisko), a które w lokalu, więc nic tu nie jest zgadywane.
 * Lista zakupów to pozycje listy pakowania w kategorii `zakupy` (wspólne): na telefonie
 * odhacza się je offline jak pakowanie.
 */

type Doc = TripDocument;
type Packing = Doc['packing'][number];

export const SHOPPING_CATEGORY = 'zakupy';

export const isShopping = (item: Pick<Packing, 'category'>) => item.category.trim().toLowerCase() === SHOPPING_CATEGORY;

export type Meal = { dayRef: string; date: string; dayNo: number; itemRef: string; title: string; place?: string };

export function mealList(doc: Doc): Meal[] {
  const places = new Map(doc.places.map((place) => [place.ref, place.name]));
  return doc.days.flatMap((day, index) =>
    dayItems(doc, day.ref)
      .filter((item) => item.kind === 'meal' && item.planStatus === 'scheduled')
      .map((item) => ({ dayRef: day.ref, date: day.date, dayNo: index + 1, itemRef: item.ref, title: item.title, place: item.placeRef === undefined ? undefined : places.get(item.placeRef) })),
  );
}

/** Dziecko = poniżej 13 lat albo (bez wieku) z opiekunem — jak „dorosły od 13 lat” u operatorów. */
export function headcount(doc: Doc): { adults: number; children: number } {
  const children = doc.travelers.filter((traveler) => (traveler.age !== undefined ? traveler.age < 13 : traveler.guardianRef !== undefined)).length;
  return { adults: doc.travelers.length - children, children };
}
