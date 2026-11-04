import { itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import type { PlanEdit } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Postój w trasie: atrakcja po drodze jako podpunkt przejazdu (`parentRef` wskazuje `transport` z tego
 * samego dnia). W odróżnieniu od podpunktu bloku wydłuża rodzica: przejazd trwa tyle, ile jazda, przerwy
 * i wszystkie postoje razem (`scheduleDay`). Dokładnej godziny postoju nie znamy, więc plan pokazuje
 * tylko jego czas trwania.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export function isRouteStop(doc: Doc, item: Item): boolean {
  if (item.parentRef === undefined || item.dayRef === undefined) return false;
  const parent = doc.items.find((each) => each.ref === item.parentRef);
  return parent?.kind === 'transport' && parent.dayRef === item.dayRef;
}

/**
 * Przejazd, do którego punkt może dołączyć: najbliższy wcześniejszy punkt dnia poza podpunktami, jeśli jest
 * przejazdem. Liczy się dzień w oglądanym wariancie (`options`), a punkt podpięty pod przejazd spoza tego
 * wariantu może przejść do tutejszego.
 */
export function routeStopTarget(doc: Doc, ref: string, options: ScheduleOptions = {}): Item | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item?.dayRef === undefined || item.isFixed) return null;
  if (item.kind === 'transport' || item.kind === 'lodging' || (item.participantRefs ?? []).length > 0) return null;
  const day = itemsForDay(doc, item.dayRef, options);
  if (item.parentRef !== undefined && (day.some((each) => each.ref === item.parentRef) || doc.items.find((each) => each.ref === item.parentRef)?.kind !== 'transport')) return null;
  const index = day.findIndex((each) => each.ref === ref);
  if (index === -1) return null;
  const previous = day.slice(0, index).filter((each) => each.parentRef === undefined).at(-1);
  return previous?.kind === 'transport' ? previous : null;
}

/** Włącza punkt do trasy poprzedniego przejazdu (`true`) albo wyjmuje go z niej (`false`). */
export function setRouteStop(doc: Doc, ref: string, on: boolean, options: ScheduleOptions = {}): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) return null;
  let next: Item;
  if (on) {
    const parent = routeStopTarget(doc, ref, options);
    if (parent === null) return null;
    next = { ...item, parentRef: parent.ref };
  } else {
    if (!isRouteStop(doc, item)) return null;
    const { parentRef: _parent, ...rest } = item;
    next = rest;
  }
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === ref ? next : each)) }, changed: [next] };
}

/** Przejazd przeniesiony do innego dnia zostawia swoje postoje jako zwykłe punkty tamtego dnia. */
export function detachRouteStops(edit: PlanEdit, parentRef: string): PlanEdit {
  const parent = edit.doc.items.find((each) => each.ref === parentRef);
  if (parent?.kind !== 'transport') return edit;
  const left = edit.doc.items.filter((each) => each.parentRef === parentRef && each.dayRef !== parent.dayRef);
  if (left.length === 0) return edit;
  const freed = new Map(
    left.map((each) => {
      const { parentRef: _parent, ...rest } = each;
      return [each.ref, rest as Item];
    }),
  );
  return { ...edit, doc: { ...edit.doc, items: edit.doc.items.map((each) => freed.get(each.ref) ?? each) }, changed: [...edit.changed, ...freed.values()] };
}
