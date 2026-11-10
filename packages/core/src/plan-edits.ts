import { detachRouteStops, dropRouteParent } from './route-stops.ts';
import { isTransit } from './plan-info.ts';
import { itemsForDay, type ScheduleOptions, scheduleDay } from './engine/schedule.ts';
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

/** Czy punkt jest podpunktem innego z tej samej listy (blok, postój w trasie, posiłek przy punkcie). */
const inBlock = (list: Item[], item: Item) => item.parentRef !== undefined && list.some((each) => each.ref === item.parentRef);
/** Ostatni element bloku: sam punkt albo jego najpóźniejszy podpunkt. */
const blockEnd = (list: Item[], item: Item) => [item, ...list.filter((each) => each.parentRef === item.ref)].sort(byKey).at(-1)!;

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

/** Spóźnienie mniejsze od tego pokazuje się w planie jako zgodne z godziną. */
const DRIFT_TOLERANCE_MIN = 15;

/**
 * Czy godzina punktu nie pasuje do jego nowego miejsca w dniu: już minęła albo przez nią kolejne punkty
 * spóźniają się względem swoich godzin lub dzień przechodzi przez północ. Porównuje dzień z godziną i bez.
 */
function timeClashes(doc: Doc, item: Item, dayRef: string): boolean {
  const date = doc.days.find((day) => day.ref === dayRef)?.date;
  const probe = replace(doc, [{ ...item, time: undefined }]);
  try {
    const stated = scheduleDay(doc, dayRef).items;
    const free = scheduleDay(probe, dayRef).items;
    const late = (items: typeof stated) => items.reduce((sum, each) => sum + (each.ref === item.ref ? 0 : each.driftMin), 0);
    const pastMidnight = (items: typeof stated) => items.some((each) => each.endDate !== date);
    return (
      (stated.find((each) => each.ref === item.ref)?.driftMin ?? 0) > DRIFT_TOLERANCE_MIN ||
      late(stated) - late(free) > DRIFT_TOLERANCE_MIN ||
      (pastMidnight(stated) && !pastMidnight(free))
    );
  } catch {
    return false;
  }
}

/**
 * Po przeniesieniu punkt bez sztywnej godziny traci godzinę, która nie pasuje do nowego miejsca, i idzie
 * „po poprzednim”. Bez tego godzina z innej pory dnia przesuwa cały dzień. Zostają: stała godzina,
 * dokładna godzina rezerwacji (bilet) i godzina względna, która sama liczy się od poprzedniego punktu.
 */
/** Godzina, której nie zmieniamy po przesunięciu czegoś innego: oznaczona jako stała albo dokładna z rezerwacją (bilet). */
export const heldTime = (item: Item) => item.isFixed === true || (item.time?.precision === 'exact' && item.bookingRef !== undefined);

function settleMovedTime(edit: PlanEdit, ref: string, dayRef: string): PlanEdit {
  const item = edit.doc.items.find((each) => each.ref === ref);
  const time = item?.time;
  if (item === undefined || time === undefined || time.precision === 'relative' || time.precision === 'day') return edit;
  if (heldTime(item)) return edit;
  if (!timeClashes(edit.doc, item, dayRef)) return edit;
  const cleared: Item = { ...item, time: undefined };
  return { ...edit, doc: replace(edit.doc, [cleared]), changed: edit.changed.map((each) => (each.ref === ref ? cleared : each)) };
}

/**
 * Podpunkty idą za swoim punktem: ten sam dzień i miejsce zaraz po nim. Silnik liczy podpunkt od początku
 * rodzica, więc nie może stać przed nim. Postojów przejazdu to nie dotyczy przy zmianie dnia (`detachRouteStops`).
 */
function carryChildren(edit: PlanEdit, ref: string): PlanEdit {
  const parent = edit.doc.items.find((each) => each.ref === ref);
  if (parent?.dayRef === undefined) return edit;
  const dayRef = parent.dayRef;
  const children = edit.doc.items.filter((each) => each.parentRef === ref && (parent.kind !== 'transport' || each.dayRef === dayRef)).sort(byKey);
  let result = edit;
  let beforeRef = ref;
  for (const child of children) {
    const doc = result.doc;
    const list = dayItems(doc, dayRef);
    const before = list.find((each) => each.ref === beforeRef)!;
    const afterRef = list.find((each) => each.ref !== ref && each.parentRef !== ref && (each.sortKey ?? '') > (before.sortKey ?? ''))?.ref;
    const placed = place(doc, dayRef, doc.items.find((each) => each.ref === child.ref)!, beforeRef, afterRef);
    const placedRefs = new Set(placed.map((each) => each.ref));
    result = { ...result, doc: replace(doc, placed), changed: [...result.changed.filter((each) => !placedRefs.has(each.ref)), ...placed] };
    if (child.dayRef !== dayRef) result = settleMovedTime(result, child.ref, dayRef);
    beforeRef = child.ref;
  }
  return result;
}

/** Punkt (z już ustawionymi polami) zaraz po bloku `blockRef`: po punkcie i wszystkich jego podpunktach. */
export function placeAfterBlock(doc: Doc, item: Item, blockRef: string): PlanEdit {
  const list = dayItems(doc, item.dayRef!).filter((each) => each.ref !== item.ref);
  const end = blockEnd(list, list.find((each) => each.ref === blockRef)!);
  const next = list.find((each) => (each.sortKey ?? '') > (end.sortKey ?? '') && each.parentRef !== blockRef);
  const changed = place(doc, item.dayRef!, item, end.ref, next?.ref);
  return { doc: replace(doc, changed), changed };
}

/**
 * W górę / w dół w kolejności dnia. Punkt przeskakuje sąsiada razem z jego podpunktami i zabiera swoje;
 * podpunkt zmienia miejsce tylko wśród podpunktów tego samego punktu.
 */
export function moveWithinDay(doc: Doc, ref: string, direction: -1 | 1): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item?.dayRef === undefined) return null;
  const list = dayItems(doc, item.dayRef);
  const child = inBlock(list, item);
  const steps = child ? list.filter((each) => each.parentRef === item.parentRef) : list.filter((each) => !inBlock(list, each));
  const target = steps.findIndex((each) => each.ref === ref) + direction;
  if (target < 0 || target >= steps.length) return null;
  const rest = steps.filter((each) => each.ref !== ref);
  const previous = rest[target - 1];
  const before = previous === undefined ? (child ? list.find((each) => each.ref === item.parentRef) : undefined) : child ? previous : blockEnd(list, previous);
  const after = rest[target] ?? list.find((each) => (each.sortKey ?? '') > (before?.sortKey ?? '') && each.ref !== ref && !(child && each.parentRef === item.parentRef));
  const changed = place(doc, item.dayRef, item, before?.ref, after?.ref);
  return carryChildren(settleMovedTime({ doc: replace(doc, changed), changed }, ref, item.dayRef), ref);
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
      routeParentRefs: [],
      planStatus: item.planStatus === 'scheduled' ? 'candidate' : item.planStatus,
      time: item.time?.precision === 'relative' ? undefined : item.time,
    };
    // Podpunkty zostają w dniu, już jako zwykłe punkty.
    const freed = doc.items.filter((each) => each.parentRef === ref || each.routeParentRefs.includes(ref)).map((each) => dropRouteParent(each, ref));
    return { doc: replace(doc, [pooled, ...freed]), changed: [pooled, ...freed] };
  }
  const last = dayItems(doc, dayRef).at(-1);
  const changed = place(doc, dayRef, { ...item, planStatus: 'scheduled', parentRef: undefined, routeParentRefs: [] }, last?.ref, undefined);
  return detachRouteStops(carryChildren(settleMovedTime({ doc: replace(doc, changed), changed }, ref, dayRef), ref), ref);
}

/** Do dnia `dayRef`, zaraz po `afterRef` (`null` = na początek dnia) — dla łatek AI („przenieś za X”). */
export function moveAfter(doc: Doc, ref: string, dayRef: string, afterRef: string | null): PlanEdit | null {
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined) return null;
  const others = dayItems(doc, dayRef).filter((each) => each.ref !== ref && each.parentRef !== ref);
  let index = afterRef === null ? -1 : others.findIndex((each) => each.ref === afterRef);
  if (afterRef !== null && index === -1) return null;
  // Zaraz po bloku `afterRef`, nie w jego środku.
  while (index >= 0 && others[index + 1]?.parentRef === afterRef) index++;
  const changed = place(doc, dayRef, { ...item, planStatus: 'scheduled', parentRef: undefined, routeParentRefs: [] }, others[index]?.ref, others[index + 1]?.ref);
  return detachRouteStops(carryChildren({ doc: replace(doc, changed), changed }, ref), ref);
}

/**
 * Przeciągnięcie w edytorze: do dnia `dayRef` przed punkt `nextRef` (brak = na koniec dnia) albo
 * do puli (`dayRef: null`). Podpunkt upuszczony w swoim bloku zostaje podpunktem, a poza nim albo w innym
 * dniu idzie bez bloku, jak przy „przenieś do…”. Punkt zabiera swoje podpunkty i nie ląduje w środku cudzego
 * bloku. `null` = upuszczenie niczego nie zmienia.
 */
export function dropItem(doc: Doc, ref: string, dayRef: string | null, nextRef?: string): PlanEdit | null {
  if (dayRef === null) return moveToDay(doc, ref, null);
  const item = doc.items.find((each) => each.ref === ref);
  if (item === undefined || ref === nextRef) return null;
  const own = dayItems(doc, dayRef).filter((each) => each.parentRef !== ref);
  const others = own.filter((each) => each.ref !== ref);
  let index = nextRef === undefined ? others.length : others.findIndex((each) => each.ref === nextRef);
  if (index === -1) return null;
  const sameDay = item.dayRef === dayRef;
  if (sameDay && own.findIndex((each) => each.ref === ref) === index) return null;
  const sibling = (each: Item | undefined) => each !== undefined && each.parentRef !== undefined && each.parentRef === item.parentRef;
  while (others[index] !== undefined && inBlock(others, others[index]!) && !sibling(others[index])) index++;
  const previous = others[index - 1];
  const staysInBlock = sameDay && item.parentRef !== undefined && (previous?.ref === item.parentRef || sibling(previous));
  const moved: Item = { ...item, planStatus: 'scheduled', parentRef: staysInBlock ? item.parentRef : undefined, routeParentRefs: staysInBlock ? item.routeParentRefs : [] };
  const changed = place(doc, dayRef, moved, previous?.ref, others[index]?.ref);
  return detachRouteStops(carryChildren(settleMovedTime({ doc: replace(doc, changed), changed }, ref, dayRef), ref), ref);
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
    routeParentRefs: [],
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
    routeParentRefs: [],
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

/** Ile elementów planu wskazuje miejsce: punkty (też ich przejazdy), dni (baza), rezerwacje i uczestnicy (start, koniec). */
export function placeUses(doc: Doc, ref: string): number {
  return (
    doc.items.filter((item) => item.placeRef === ref || item.leg?.fromPlaceRef === ref || item.leg?.toPlaceRef === ref).length +
    doc.days.filter((day) => day.baseRef === ref).length +
    doc.bookings.filter((booking) => booking.startPlaceRef === ref || booking.endPlaceRef === ref).length +
    doc.travelers.filter((traveler) => traveler.startPlaceRef === ref || traveler.endPlaceRef === ref).length
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

export type LegRouteEdit = PlanEdit & { placesChanged: boolean; viaChanged: boolean };

/**
 * Skąd, dokąd i własny link przejazdu. Nazwa znana w planie wskazuje to samo miejsce, nowa tworzy nowe.
 * Inne końce unieważniają trasę: znika linia i dystans, a czas zostaje jako szacunek, żeby dzień się
 * nie zawalił, zanim trasa się przeliczy. Przejazd bez szczegółów (`leg`) dostaje je przy pierwszym
 * zapisie, domyślnie autem. `null` = bez zmian albo punkt nie jest przejazdem.
 */
export function setLegRoute(doc: Doc, itemRef: string, ids: { fromId: string; toId: string }, fields: { from: string; to: string; routeUrl: string; roundTrip?: boolean; transit?: boolean; via?: { lat: number; lng: number }[] }): LegRouteEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item?.kind !== 'transport') return null;
  const fresh = item.leg === undefined;
  const current: NonNullable<Item['leg']> = item.leg ?? { mode: 'car', links: [] };
  const created: PlanPlace[] = [];
  const resolve = (typed: string, current: string | undefined, id: string) => {
    const name = typed.trim();
    if (name === '') return undefined;
    const known = [...doc.places, ...created];
    const same = (place: PlanPlace) => place.name.trim().toLowerCase() === name.toLowerCase();
    const found = known.find((place) => place.ref === current && same(place)) ?? known.find(same);
    if (found !== undefined) return found.ref;
    const place: PlanPlace = { ref: `id-${id}`, name, provider: 'unknown', links: [] };
    created.push(place);
    return place.ref;
  };
  const from = resolve(fields.from, current.fromPlaceRef, ids.fromId);
  const to = resolve(fields.to, current.toPlaceRef ?? item.placeRef, ids.toId);
  const url = fields.routeUrl.trim();

  const placesChanged = fresh ? from !== undefined || to !== undefined : from !== current.fromPlaceRef || to !== (current.toPlaceRef ?? item.placeRef);
  const roundTrip = fields.roundTrip ?? current.roundTrip === true;
  // Zapisany tylko wybór inny niż automat, żeby przejazd dalej zależał od długości trasy, gdy nikt tego nie zmienił.
  const { transit: _transit, ...withoutChoice } = current;
  const automatic = isTransit(doc, { ...item, leg: withoutChoice });
  const transit = fields.transit === undefined ? current.transit : fields.transit === automatic ? undefined : fields.transit;
  const via = fields.via === undefined ? current.via : fields.via.length > 0 ? fields.via : undefined;
  const viaChanged = JSON.stringify(via ?? []) !== JSON.stringify(current.via ?? []);
  if (!fresh && !placesChanged && !viaChanged && url === (current.routeUrl ?? '') && roundTrip === (current.roundTrip === true) && transit === current.transit) return null;

  const { fromPlaceRef: _from, toPlaceRef: _to, routeUrl: _url, roundTrip: _roundTrip, transit: _chosen, via: _via, ...rest } = current;
  let kept = rest;
  if (placesChanged || viaChanged) {
    const { routed: _routed, geometry: _geometry, distanceKm: _km, durationMaxMin: _max, ...still } = rest;
    kept = still;
  }
  const leg = { ...kept, ...(from !== undefined ? { fromPlaceRef: from } : {}), ...(to !== undefined ? { toPlaceRef: to } : {}), ...(url !== '' ? { routeUrl: url } : {}), ...(via !== undefined ? { via } : {}), ...(transit !== undefined ? { transit } : {}), ...(roundTrip ? { roundTrip } : {}) };
  const edit = updateItem({ ...doc, places: [...doc.places, ...created] }, itemRef, { leg, ...(to !== undefined ? { placeRef: to } : {}) });
  if (edit === null) return null;
  return { ...edit, ...(created.length > 0 ? { places: created.map((place) => ({ place, created: true })) } : {}), placesChanged, viaChanged };
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
    .filter((each) => each.ref !== ref && (each.parentRef === ref || each.routeParentRefs.includes(ref) || each.replacesRefs.includes(ref)))
    .map((each) => ({
      ...dropRouteParent(each, ref),
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
 * bez tego punkty z podaną godziną zostają na swoich miejscach i w dniu zostaje dziura. Kolejne
 * punkty z godziną idą wcześniej o zwolniony czas (czas punktu z silnika, także czas drogi z trasy,
 * + zapas usuniętego), ale najwyżej do końca poprzedniego punktu — tyle, ile silnik pozwala.
 * Przesuwanie kończy się na pierwszej godzinie trzymanej (`heldTime`: lot, mecz, bilet), punkty bez
 * godziny i liczone od poprzedniego idą same. Postój w trasie skraca przejazd, więc też zwalnia
 * czas; przy usuwaniu przejazdu jego postoje zostają w dniu, więc zwalnia się tylko jazda. Podpunkty
 * bloku i punkty części grupy (osobne ścieżki) nie przesuwają reszty — tu też nie. Liczy się dzień
 * w oglądanym wariancie (`options`).
 */
export function removeItemClosingGap(doc: Doc, ref: string, options: Pick<ScheduleOptions, 'activeVariants'> = {}): PlanEdit | null {
  const target = doc.items.find((each) => each.ref === ref);
  const edit = removeItem(doc, ref);
  if (edit === null || target?.dayRef === undefined || (target.participantRefs ?? []).length > 0) return edit;
  const day = doc.days.find((each) => each.ref === target.dayRef)!;
  let scheduledAfter: ReturnType<typeof scheduleDay>['items'];
  let freed: number;
  try {
    const entry = scheduleDay(doc, day.ref, options).items.find((each) => each.ref === ref);
    if (entry === undefined || (entry.child && !entry.routeStop)) return edit;
    freed = entry.durationMin - (entry.routeStopsMin ?? 0) + (target.bufferAfterMin ?? 0);
    scheduledAfter = scheduleDay(edit.doc, day.ref, options).items;
  } catch {
    return edit;
  }
  if (freed <= 0) return edit;
  const original = itemsForDay(doc, day.ref, options);
  // Postój nie ma własnej chwili w dniu: jego godziny silnik nie używa, więc nie ma czego przesuwać.
  const stops = new Set(scheduledAfter.filter((each) => each.routeStop).map((each) => each.ref));
  const children = new Set(scheduledAfter.filter((each) => each.child).map((each) => each.ref));
  const following = original
    .slice(original.findIndex((each) => each.ref === ref) + 1)
    .map((each) => edit.doc.items.find((item) => item.ref === each.ref) ?? each)
    .filter((each) => !stops.has(each.ref));

  // Pierwszy punkt z godziną po usuniętym wyznacza, ile da się przesunąć; godzina trzymana — nic.
  const first = following.find((item) => !children.has(item.ref) && item.time !== undefined && 'start' in item.time);
  if (first?.time === undefined || !('start' in first.time) || heldTime(first)) return edit;
  // Kiedy punkt by się zaczął bez swojej godziny = koniec tego, co przed nim.
  const probe: Doc = { ...edit.doc, items: edit.doc.items.map((item) => (item.ref === first.ref ? { ...item, time: undefined } : item)) };
  let arrival: number | undefined;
  let previously: ReturnType<typeof scheduleDay>['items'][number] | undefined;
  try {
    arrival = scheduleDay(probe, day.ref, options).items.find((item) => item.ref === first.ref)?.start;
    previously = scheduleDay(doc, day.ref, options).items.find((item) => item.ref === first.ref);
  } catch {
    return edit;
  }
  if (arrival === undefined || previously === undefined) return edit;
  const stated = zonedToInstant(day.date, first.time.start, first.time.tz ?? day.tz);
  // Były postój usuniętego przejazdu nie miał własnej chwili w dniu, liczy się jego godzina.
  const started = previously.routeStop ? stated : previously.start;
  const landing = Math.max(arrival, stated - freed * MINUTE);
  // Godzina pierwszego punktu idzie do chwili dotarcia. Reszta dnia zyskuje tyle, ile ten punkt faktycznie:
  // gdy był spóźniony wobec swojej godziny, to więcej niż zmiana samej godziny.
  const firstShift = Math.max(0, Math.floor((stated - landing) / MINUTE));
  const shift = Math.min(freed, Math.floor((started - landing) / MINUTE));
  if (shift <= 0) return edit;

  const shifted: Item[] = [];
  for (const item of following.slice(following.indexOf(first))) {
    const time = item.time;
    if (heldTime(item)) break;
    if (time === undefined || !('start' in time)) continue;
    const by = item === first ? firstShift : shift;
    if (by === 0) continue;
    const start = minutesOfDay(time.start) - by;
    if (start < 0) break;
    const end = time.end === undefined ? undefined : minutesOfDay(time.end) - by;
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
