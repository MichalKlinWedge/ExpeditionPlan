import { itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import type { PlanEdit } from './plan-edits.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Postój w trasie: atrakcja po drodze jako podpunkt przejazdu (`parentRef` wskazuje `transport` z tego
 * samego dnia). W odróżnieniu od podpunktu bloku wydłuża rodzica: przejazd trwa tyle, ile jazda, przerwy
 * i wszystkie postoje razem (`scheduleDay`). Dokładnej godziny postoju nie znamy, więc plan pokazuje
 * tylko jego czas trwania. Punkt wspólny dla wariantów może być postojem na przejeździe każdego z nich:
 * pierwszy przejazd to `parentRef`, kolejne `routeParentRefs`, a dzień liczy ten, który jest w oglądanym wariancie.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

const routeParents = (item: Item) => [...(item.parentRef === undefined ? [] : [item.parentRef]), ...item.routeParentRefs];

/** Punkt bez tego przejazdu: pozostałe warianty zachowują swoje postoje. */
export function dropRouteParent(item: Item, ref: string): Item {
  const [first, ...rest] = routeParents(item).filter((each) => each !== ref);
  const { parentRef: _parent, ...free } = item;
  return { ...free, ...(first === undefined ? {} : { parentRef: first }), routeParentRefs: rest };
}

export function isRouteStop(doc: Doc, item: Item): boolean {
  if (item.parentRef === undefined || item.dayRef === undefined) return false;
  const parent = doc.items.find((each) => each.ref === item.parentRef);
  return parent?.kind === 'transport' && parent.dayRef === item.dayRef;
}

/**
 * Przejazd, do którego punkt może dołączyć: najbliższy wcześniejszy punkt dnia poza podpunktami, jeśli jest
 * przejazdem. Liczy się dzień w oglądanym wariancie (`options`), a punkt podpięty pod przejazd spoza tego
 * wariantu może być postojem także na tutejszym.
 */
export function routeStopTarget(doc: Doc, ref: string, options: ScheduleOptions = {}): Item | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item?.dayRef === undefined || item.isFixed) return null;
  if (item.kind === 'transport' || item.kind === 'lodging' || (item.participantRefs ?? []).length > 0) return null;
  const day = itemsForDay(doc, item.dayRef, options);
  if (item.parentRef !== undefined && (routeParents(item).some((parent) => day.some((each) => each.ref === parent)) || doc.items.find((each) => each.ref === item.parentRef)?.kind !== 'transport')) return null;
  const index = day.findIndex((each) => each.ref === ref);
  if (index === -1) return null;
  const previous = day.slice(0, index).filter((each) => each.parentRef === undefined).at(-1);
  return previous?.kind === 'transport' ? previous : null;
}

/** Włącza punkt do trasy poprzedniego przejazdu (`true`) albo wyjmuje go z niej (`false`), tylko w oglądanym wariancie (`options`). */
export function setRouteStop(doc: Doc, ref: string, on: boolean, options: ScheduleOptions = {}): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) return null;
  let next: Item;
  if (on) {
    const parent = routeStopTarget(doc, ref, options);
    if (parent === null) return null;
    next = item.parentRef === undefined ? { ...item, parentRef: parent.ref } : { ...item, routeParentRefs: [...item.routeParentRefs, parent.ref] };
  } else {
    if (!isRouteStop(doc, item)) return null;
    const current = itemsForDay(doc, item.dayRef!, options).find((each) => each.ref === ref)?.parentRef;
    next = dropRouteParent(item, current ?? item.parentRef!);
  }
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === ref ? next : each)) }, changed: [next] };
}

/** Przejazd przeniesiony do innego dnia zostawia swoje postoje jako zwykłe punkty tamtego dnia. */
export function detachRouteStops(edit: PlanEdit, parentRef: string): PlanEdit {
  const parent = edit.doc.items.find((each) => each.ref === parentRef);
  if (parent?.kind !== 'transport') return edit;
  const left = edit.doc.items.filter((each) => routeParents(each).includes(parentRef) && each.dayRef !== parent.dayRef);
  if (left.length === 0) return edit;
  const freed = new Map(left.map((each) => [each.ref, dropRouteParent(each, parentRef)]));
  return { ...edit, doc: { ...edit.doc, items: edit.doc.items.map((each) => freed.get(each.ref) ?? each) }, changed: [...edit.changed, ...freed.values()] };
}
