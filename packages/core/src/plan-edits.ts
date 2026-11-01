import { TripDocument } from './schemas/trip-document.ts';
import { keyBetween, NoRoomError, renumber } from './sort-key.ts';

/**
 * Zmiany planu w edytorze (MVP-3) jako czyste funkcje na dokumencie: zwracają nowy dokument
 * i listę punktów do zapisania. Widok liczy z nowego dokumentu harmonogram od razu, a zapis
 * idzie w tle — jedno źródło prawdy o tym, co się zmieniło.
 */

type Doc = TripDocument;
export type PlanItem = Doc['items'][number];
type Item = PlanItem;
/** Zmiana planu: nowy dokument, punkty do zapisania i — przy usuwaniu — inne elementy, które wskazywały punkt. */
export type PlanEdit = {
  doc: Doc;
  changed: Item[];
  others?: ({ collection: 'variants'; element: Doc['variants'][number] } | { collection: 'sources'; element: Doc['sources'][number] })[];
  created?: Item;
  removed?: string;
};

const byKey = (a: Item, b: Item) => (a.sortKey ?? '').localeCompare(b.sortKey ?? '');

export const dayItems = (doc: Doc, dayRef: string) => doc.items.filter((item) => item.dayRef === dayRef).sort(byKey);

function replace(doc: Doc, items: Item[]): Doc {
  const next = new Map(items.map((item) => [item.ref, item]));
  return { ...doc, items: doc.items.map((item) => next.get(item.ref) ?? item) };
}

/** Klucz dla `item` między sąsiadami; bez miejsca — przenumerowanie całego dnia. */
function place(doc: Doc, dayRef: string, item: Item, beforeRef: string | undefined, afterRef: string | undefined): Item[] {
  const others = dayItems(doc, dayRef).filter((each) => each.ref !== item.ref);
  const before = others.find((each) => each.ref === beforeRef)?.sortKey;
  const after = others.find((each) => each.ref === afterRef)?.sortKey;
  try {
    return [{ ...item, dayRef, sortKey: keyBetween(before, after) }];
  } catch (error) {
    if (!(error instanceof NoRoomError)) throw error;
    const order = [...others];
    const at = afterRef === undefined ? order.length : order.findIndex((each) => each.ref === afterRef);
    order.splice(at, 0, { ...item, dayRef });
    const keys = renumber(order.length, Date.now().toString(36));
    return order.map((each, index) => ({ ...each, sortKey: keys[index]! }));
  }
}

/** W górę / w dół w kolejności dnia. */
export function moveWithinDay(doc: Doc, ref: string, direction: -1 | 1): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item?.dayRef === undefined) return null;
  const list = dayItems(doc, item.dayRef);
  const index = list.findIndex((each) => each.ref === ref);
  const target = index + direction;
  if (target < 0 || target >= list.length) return null;
  const rest = list.filter((each) => each.ref !== ref);
  const insertAt = direction === -1 ? target : target;
  const changed = place(doc, item.dayRef, item, rest[insertAt - 1]?.ref, rest[insertAt]?.ref);
  return { doc: replace(doc, changed), changed };
}

/** Do innego dnia (na koniec) albo do puli (`null`). */
export function moveToDay(doc: Doc, ref: string, dayRef: string | null): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined || item.dayRef === (dayRef ?? undefined)) return null;
  if (dayRef === null) {
    // W puli punkt nie może być „w planie”, a godzina względna wymaga dnia.
    const pooled: Item = {
      ...item,
      dayRef: undefined,
      sortKey: undefined,
      parentRef: undefined,
      planStatus: item.planStatus === 'scheduled' ? 'candidate' : item.planStatus,
      time: item.time?.precision === 'relative' ? undefined : item.time,
    };
    return { doc: replace(doc, [pooled]), changed: [pooled] };
  }
  const last = dayItems(doc, dayRef).at(-1);
  const changed = place(doc, dayRef, { ...item, planStatus: 'scheduled', parentRef: undefined }, last?.ref, undefined);
  return { doc: replace(doc, changed), changed };
}

export function updateItem(doc: Doc, ref: string, patch: Partial<Item>): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) return null;
  const changed = [{ ...item, ...patch }];
  return { doc: replace(doc, changed), changed };
}

/** Nowy punkt na końcu dnia. `ref` = `id-<uuid>`, tak jak dla wierszy bez `ref` z bazy. */
export function addItem(doc: Doc, dayRef: string, id: string, fields: Pick<Item, 'title' | 'kind'> & Partial<Item>): PlanEdit {
  const last = dayItems(doc, dayRef).at(-1);
  const item: Item = {
    replacesRefs: [],
    variantRefs: [],
    links: [],
    notes: [],
    planStatus: 'scheduled',
    ...fields,
    ref: `id-${id}`,
    dayRef,
    sortKey: last?.sortKey === undefined ? keyBetween() : keyBetween(last.sortKey),
  };
  return { doc: { ...doc, items: [...doc.items, item] }, changed: [], created: item };
}

/** Punkt nie da się usunąć, bo wskazuje na niego coś, czego edytor jeszcze nie zmienia. */
export class ItemInUseError extends Error {
  constructor(title: string, uses: string[]) {
    super(`„${title}” jest powiązany z: ${uses.join(', ')}. Usuń najpierw to powiązanie.`);
    this.name = 'ItemInUseError';
  }
}

/**
 * Miękkie usunięcie. Odwołania z list (punkt „zamiast”, wariant, który punkt wyrzuca, źródło)
 * są czyszczone, podpunkty bloku zostają bez bloku. Ograniczenie, pozycja budżetu, zadanie,
 * notatka czy przejście wskazujące punkt blokują usunięcie — inaczej plan przestałby się składać.
 */
export function removeItem(doc: Doc, ref: string): PlanEdit | null {
  const target = doc.items.find((each) => each.ref === ref);
  if (target === undefined) return null;
  const uses = [
    ...doc.constraints.filter((each) => each.itemRef === ref).map(() => 'ograniczenie'),
    ...doc.budgetLines.filter((each) => each.itemRef === ref).map((each) => `budżet „${each.title}”`),
    ...doc.tasks.filter((each) => each.itemRef === ref || (each.due?.kind === 'before_item' && each.due.itemRef === ref)).map((each) => `zadanie „${each.title}”`),
    ...doc.notes.filter((each) => each.targetRef === ref).map(() => 'notatka'),
    ...doc.legs.filter((each) => each.fromRef === ref || each.toRef === ref).map(() => 'przejście'),
  ];
  if (uses.length > 0) throw new ItemInUseError(target.title, [...new Set(uses)]);

  const items = doc.items
    .filter((each) => each.ref !== ref && (each.parentRef === ref || each.replacesRefs.includes(ref)))
    .map((each) => ({
      ...each,
      parentRef: each.parentRef === ref ? undefined : each.parentRef,
      replacesRefs: each.replacesRefs.filter((other) => other !== ref),
    }));
  const variants = doc.variants
    .filter((each) => each.excludesRefs.includes(ref))
    .map((each) => ({ ...each, excludesRefs: each.excludesRefs.filter((other) => other !== ref) }));
  const sources = doc.sources
    .filter((each) => each.appliesToRefs.includes(ref))
    .map((each) => ({ ...each, appliesToRefs: each.appliesToRefs.filter((other) => other !== ref) }));

  const swap = <T extends { ref?: string }>(list: T[], changed: T[]) => {
    const next = new Map(changed.map((each) => [each.ref, each]));
    return list.map((each) => next.get(each.ref) ?? each);
  };
  const next: Doc = {
    ...replace({ ...doc, items: doc.items.filter((each) => each.ref !== ref) }, items),
    variants: swap(doc.variants, variants),
    sources: swap(doc.sources, sources),
  };
  return {
    doc: next,
    changed: items,
    others: [...variants.map((element) => ({ collection: 'variants' as const, element })), ...sources.map((element) => ({ collection: 'sources' as const, element }))],
    removed: ref,
  };
}

/** Pierwszy problem walidacji dokumentu po zmianie — po polsku, do pokazania przy planie. */
export function documentProblem(doc: Doc): string | null {
  const result = TripDocument.safeParse(doc);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return `${issue.path.join('.')}: ${issue.message}`;
}
