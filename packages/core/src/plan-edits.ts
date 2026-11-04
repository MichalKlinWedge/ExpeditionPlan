import { scheduleDay } from './engine/schedule.ts';
import { MINUTE, minutesOfDay, zonedToInstant } from './engine/time.ts';
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
export type PlanPlace = Doc['places'][number];
/** Zmiana planu: nowy dokument, punkty do zapisania i — przy usuwaniu — inne elementy, które wskazywały punkt. */
export type PlanEdit = {
  doc: Doc;
  changed: Item[];
  /** Miejsca do zapisania (własna pinezka): nowe idą do bazy przed punktem, który je wskazuje. */
  places?: { place: PlanPlace; created?: true }[];
  others?: ({ collection: 'variants'; element: Doc['variants'][number] } | { collection: 'sources'; element: Doc['sources'][number] })[];
  created?: Item;
  removed?: string;
  /** O ile minut przesunięto wcześniej kolejne punkty po usunięciu (`removeItemClosingGap`). */
  shiftedMin?: number;
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

/** Do dnia `dayRef`, zaraz po `afterRef` (`null` = na początek dnia) — dla łatek AI („przenieś za X”). */
export function moveAfter(doc: Doc, ref: string, dayRef: string, afterRef: string | null): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) return null;
  const others = dayItems(doc, dayRef).filter((each) => each.ref !== ref);
  const index = afterRef === null ? -1 : others.findIndex((each) => each.ref === afterRef);
  if (afterRef !== null && index === -1) return null;
  const changed = place(doc, dayRef, { ...item, planStatus: 'scheduled', parentRef: undefined }, others[index]?.ref, others[index + 1]?.ref);
  return { doc: replace(doc, changed), changed };
}

/**
 * Przeciągnięcie w edytorze: do dnia `dayRef` przed punkt `nextRef` (brak = na koniec dnia) albo
 * do puli (`dayRef: null`). W obrębie dnia punkt zostaje w swoim bloku; do innego dnia idzie bez
 * bloku, jak przy „przenieś do…”. `null` = upuszczenie niczego nie zmienia.
 */
export function dropItem(doc: Doc, ref: string, dayRef: string | null, nextRef?: string): PlanEdit | null {
  if (dayRef === null) return moveToDay(doc, ref, null);
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined || ref === nextRef) return null;
  const others = dayItems(doc, dayRef).filter((each) => each.ref !== ref);
  const index = nextRef === undefined ? others.length : others.findIndex((each) => each.ref === nextRef);
  if (index === -1) return null;
  const sameDay = item.dayRef === dayRef;
  if (sameDay) {
    const current = dayItems(doc, dayRef).findIndex((each) => each.ref === ref);
    if (current === index) return null;
  }
  const moved: Item = { ...item, planStatus: 'scheduled', parentRef: sameDay ? item.parentRef : undefined };
  const changed = place(doc, dayRef, moved, others[index - 1]?.ref, others[index]?.ref);
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

/**
 * Nowy punkt w puli (atrakcja, miejsce, pomysł na później): bez dnia, status „kandydat”, na końcu
 * puli. Z nazwą miejsca — nowe miejsce bez współrzędnych (potem „Uzupełnij współrzędne” albo pinezka);
 * z pozycją `at` (telefon: „tu, gdzie jestem”) — własna pinezka w tym miejscu.
 */
export function addPoolItem(
  doc: Doc,
  ids: { itemId: string; placeId?: string },
  fields: Pick<Item, 'title' | 'kind'> & Partial<Item>,
  placeName?: string,
  at?: { lat: number; lng: number },
): PlanEdit {
  const last = doc.items.filter((item) => item.dayRef === undefined && item.sortKey !== undefined).sort((a, b) => a.sortKey!.localeCompare(b.sortKey!)).at(-1);
  const name = placeName?.trim() || (at ? fields.title : undefined);
  const place: PlanPlace | undefined =
    name && ids.placeId
      ? at
        ? { ref: `id-${ids.placeId}`, name, lat: round(at.lat), lng: round(at.lng), provider: 'user', links: [] }
        : { ref: `id-${ids.placeId}`, name, provider: 'unknown', links: [] }
      : undefined;
  const item: Item = {
    replacesRefs: [],
    variantRefs: [],
    links: [],
    notes: [],
    ...fields,
    planStatus: 'candidate',
    ref: `id-${ids.itemId}`,
    ...(place ? { placeRef: place.ref } : {}),
    sortKey: last?.sortKey === undefined ? keyBetween() : keyBetween(last.sortKey),
  };
  return {
    doc: { ...doc, places: place ? [...doc.places, place] : doc.places, items: [...doc.items, item] },
    changed: [],
    created: item,
    ...(place ? { places: [{ place, created: true as const }] } : {}),
  };
}

/**
 * Własna pinezka na mapie: nowe miejsce `provider: 'user'` ze współrzędnymi i punkt w nim na końcu
 * dnia. Nazwa miejsca = tytuł punktu. `itemId` i `placeId` to uuid nowych wierszy.
 */
export function addItemAtPin(
  doc: Doc,
  dayRef: string,
  ids: { itemId: string; placeId: string },
  at: { lat: number; lng: number },
  fields: Pick<Item, 'title' | 'kind'> & Partial<Item>,
): PlanEdit {
  const place: PlanPlace = { ref: `id-${ids.placeId}`, name: fields.title, lat: round(at.lat), lng: round(at.lng), provider: 'user', links: [] };
  const edit = addItem({ ...doc, places: [...doc.places, place] }, dayRef, ids.itemId, { ...fields, placeRef: place.ref });
  return { ...edit, places: [{ place, created: true }] };
}

/**
 * Przesunięcie własnej pinezki (`provider: 'user'`) albo postawienie jej miejscu bez współrzędnych
 * (wtedy staje się własną pinezką). Miejsc z bazy (OSM, Geoapify) ze współrzędnymi nie ruszamy.
 */
export function movePlace(doc: Doc, ref: string, at: { lat: number; lng: number }): PlanEdit | null {
  const found = doc.places.find((each) => each.ref === ref);
  if (found === undefined) return null;
  const located = found.lat !== undefined && found.lng !== undefined;
  if (found.provider !== 'user' && located) return null;
  const place = { ...found, lat: round(at.lat), lng: round(at.lng), provider: 'user' as const };
  return { doc: { ...doc, places: doc.places.map((each) => (each.ref === ref ? place : each)) }, changed: [], places: [{ place }] };
}

/** Ile elementów planu wskazuje miejsce: punkty (też ich przejazdy), dni (baza) i rezerwacje. */
export function placeUses(doc: Doc, ref: string): number {
  return (
    doc.items.filter((item) => item.placeRef === ref || item.leg?.fromPlaceRef === ref || item.leg?.toPlaceRef === ref).length +
    doc.days.filter((day) => day.baseRef === ref).length +
    doc.bookings.filter((booking) => booking.startPlaceRef === ref || booking.endPlaceRef === ref).length
  );
}

/** Poprawa nazwy miejsca: ta sama lokalizacja, nowa nazwa wszędzie, gdzie miejsce występuje. */
export function renamePlace(doc: Doc, ref: string, name: string): PlanEdit | null {
  const found = doc.places.find((each) => each.ref === ref);
  const trimmed = name.trim();
  if (found === undefined || trimmed === '' || trimmed === found.name) return null;
  const place = { ...found, name: trimmed };
  return { doc: { ...doc, places: doc.places.map((each) => (each.ref === ref ? place : each)) }, changed: [], places: [{ place }] };
}

/**
 * „To inny lokal”: pod tym samym miejscem jest teraz coś innego (np. nowy nocleg), więc punkty, baza
 * dnia i rezerwacje dalej je wskazują, ale współrzędne, adres, godziny i linki starego miejsca znikają.
 * Miejsce trafia na „brak na mapie” — pinezka albo „Uzupełnij współrzędne” ustawiają je od nowa.
 */
export function replacePlace(doc: Doc, ref: string, name: string): PlanEdit | null {
  const found = doc.places.find((each) => each.ref === ref);
  const trimmed = name.trim();
  if (found === undefined || trimmed === '') return null;
  const place: PlanPlace = { ref, name: trimmed, provider: 'unknown', links: [] };
  return { doc: { ...doc, places: doc.places.map((each) => (each.ref === ref ? place : each)) }, changed: [], places: [{ place }] };
}

/**
 * Inne miejsce tylko dla tego punktu: miejsce z tą nazwą, jeśli już jest na liście (bez względu na
 * wielkość liter), inaczej nowe, bez współrzędnych. `placeId` to uuid nowego wiersza.
 */
export function setItemPlace(doc: Doc, itemRef: string, placeId: string, name: string): PlanEdit | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  const existing = doc.places.find((each) => each.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing !== undefined) return updateItem(doc, itemRef, { placeRef: existing.ref });
  const place: PlanPlace = { ref: `id-${placeId}`, name: trimmed, provider: 'unknown', links: [] };
  const edit = updateItem({ ...doc, places: [...doc.places, place] }, itemRef, { placeRef: place.ref });
  return edit === null ? null : { ...edit, places: [{ place, created: true }] };
}

/** 6 miejsc po przecinku ≈ 10 cm — więcej z kliknięcia na mapie i tak nie wynika. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Punkt nie da się usunąć, bo wskazuje na niego coś, czego edytor jeszcze nie zmienia. */
export class ItemInUseError extends Error {
  readonly uses: string[];

  constructor(title: string, uses: string[]) {
    super(`„${title}” jest powiązany z: ${uses.join(', ')}. Usuń najpierw to powiązanie.`);
    this.name = 'ItemInUseError';
    this.uses = uses;
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

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Usunięcie, po którym dzień „zamyka lukę”. Godziny w planie znaczą „nie wcześniej niż”, więc
 * bez tego punkty z godziną przybliżoną (szkic AI daje ją prawie każdemu) zostają na swoich
 * miejscach i w dniu zostaje dziura. Kolejne punkty z godziną przybliżoną albo przedziałem idą
 * wcześniej o zwolniony czas (trwanie + zapas usuniętego), ale najwyżej do końca poprzedniego
 * punktu — tyle, ile silnik pozwala. Przesuwanie kończy się na pierwszej stałej godzinie
 * (`exact`, `isFixed`: lot, mecz), punkty bez godziny i liczone od poprzedniego idą same.
 * Podpunkty bloku i punkty części grupy (osobne ścieżki) nie przesuwają reszty — tu też nie.
 */
export function removeItemClosingGap(doc: Doc, ref: string): PlanEdit | null {
  const target = doc.items.find((each) => each.ref === ref);
  const edit = removeItem(doc, ref);
  if (edit === null || target?.dayRef === undefined || target.parentRef !== undefined || (target.participantRefs ?? []).length > 0) return edit;
  const freed = (target.durationMin ?? 0) + (target.bufferAfterMin ?? 0);
  if (freed === 0) return edit;
  const day = doc.days.find((each) => each.ref === target.dayRef)!;
  const original = dayItems(doc, day.ref);
  const following = original.slice(original.findIndex((each) => each.ref === ref) + 1).map((each) => edit.doc.items.find((item) => item.ref === each.ref) ?? each);

  // Pierwszy punkt z godziną po usuniętym wyznacza, ile da się przesunąć; stała godzina — nic.
  const first = following.find((item) => item.time !== undefined && 'start' in item.time);
  if (first?.time === undefined || !('start' in first.time) || first.time.precision === 'exact' || first.isFixed) return edit;
  // Kiedy punkt by się zaczął bez swojej godziny = koniec tego, co przed nim.
  const probe: Doc = { ...edit.doc, items: edit.doc.items.map((item) => (item.ref === first.ref ? { ...item, time: undefined } : item)) };
  let arrival: number | undefined;
  try {
    arrival = scheduleDay(probe, day.ref).items.find((item) => item.ref === first.ref)?.start;
  } catch {
    return edit;
  }
  if (arrival === undefined) return edit;
  const stated = zonedToInstant(day.date, first.time.start, first.time.tz ?? day.tz);
  const shift = Math.min(freed, Math.floor((stated - arrival) / MINUTE));
  if (shift <= 0) return edit;

  const shifted: Item[] = [];
  for (const item of following.slice(following.indexOf(first))) {
    const time = item.time;
    if (time?.precision === 'exact' || item.isFixed) break;
    if (time === undefined || !('start' in time)) continue;
    const start = minutesOfDay(time.start) - shift;
    if (start < 0) break;
    const end = time.end === undefined ? undefined : minutesOfDay(time.end) - shift;
    shifted.push({ ...item, time: { ...time, start: hhmm(start), ...(end !== undefined && end >= 0 ? { end: hhmm(end) } : {}) } as Item['time'] });
  }
  if (shifted.length === 0) return edit;
  const others = new Set(shifted.map((each) => each.ref));
  return { ...edit, doc: replace(edit.doc, shifted), changed: [...edit.changed.filter((each) => !others.has(each.ref)), ...shifted], shiftedMin: shift };
}

/** Pierwszy problem walidacji dokumentu po zmianie — po polsku, do pokazania przy planie. */
export function documentProblem(doc: Doc): string | null {
  const result = TripDocument.safeParse(doc);
  if (result.success) return null;
  const issue = result.error.issues[0]!;
  return `${issue.path.join('.')}: ${issue.message}`;
}
