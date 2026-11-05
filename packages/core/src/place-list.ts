import { distanceM } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Strona „Miejsca”: wszystkie miejsca planu z tym, co z nich korzysta. Miejsce jest wspólne, więc
 * nowe współrzędne albo nazwa obowiązują we wszystkich punktach, dniach i rezerwacjach, które je wskazują.
 */

type Doc = TripDocument;
type Place = Doc['places'][number];

export type PlaceUsage = {
  items: { ref: string; title: string }[];
  bookings: { ref: string; title: string }[];
  /** Dni z tym miejscem jako bazą. */
  days: number;
  /** Przejazdy spoza punktów (`doc.legs`). */
  legs: number;
  /** Uczestnicy, którzy tu zaczynają albo kończą. */
  travelers: number;
  /** Punkty, rezerwacje, dni, przejazdy i uczestnicy; źródła nie blokują usunięcia. */
  total: number;
};

export function placeUsage(doc: Doc, ref: string): PlaceUsage {
  const items = doc.items.filter((item) => item.placeRef === ref || item.leg?.fromPlaceRef === ref || item.leg?.toPlaceRef === ref).map((item) => ({ ref: item.ref, title: item.title }));
  const bookings = doc.bookings.filter((booking) => booking.startPlaceRef === ref || booking.endPlaceRef === ref).map((booking) => ({ ref: booking.ref, title: booking.title }));
  const days = doc.days.filter((day) => day.baseRef === ref).length;
  const legs = doc.legs.filter((leg) => leg.fromRef === ref || leg.toRef === ref).length;
  const travelers = doc.travelers.filter((traveler) => traveler.startPlaceRef === ref || traveler.endPlaceRef === ref).length;
  return { items, bookings, days, legs, travelers, total: items.length + bookings.length + days + legs + travelers };
}

export type PlaceEntry = {
  place: Place;
  usage: PlaceUsage;
  /** Numer pinezki na mapie; miejsce bez współrzędnych go nie ma. */
  n?: number;
};

const located = (place: Place) => place.lat !== undefined && place.lng !== undefined;

/** Najpierw miejsca bez współrzędnych (do uzupełnienia), potem reszta; w obu grupach po nazwie. */
export function placeList(doc: Doc): PlaceEntry[] {
  const byName = (a: Place, b: Place) => a.name.localeCompare(b.name, 'pl');
  const places = [...doc.places].sort((a, b) => Number(located(a)) - Number(located(b)) || byName(a, b));
  let n = 0;
  return places.map((place) => ({ place, usage: placeUsage(doc, place.ref), ...(located(place) ? { n: ++n } : {}) }));
}

export type PlaceRemovalWrite = {
  collection: 'sources' | 'places';
  element: { ref: string } & Record<string, unknown>;
  op: 'update' | 'remove';
};

/** Usuwa nieużywane miejsce (także z listy miejsc, których dotyczy źródło); `null`, gdy miejsca nie ma albo coś je wskazuje. */
export function removeUnusedPlace(doc: Doc, ref: string): { doc: Doc; writes: PlaceRemovalWrite[] } | null {
  const place = doc.places.find((each) => each.ref === ref);
  if (place === undefined || placeUsage(doc, ref).total > 0) return null;
  const writes: PlaceRemovalWrite[] = [];
  const sources = doc.sources.map((source) => {
    if (!source.appliesToRefs.includes(ref)) return source;
    const next = { ...source, appliesToRefs: source.appliesToRefs.filter((each) => each !== ref) };
    if (next.ref !== undefined) writes.push({ collection: 'sources', element: next as { ref: string } & Record<string, unknown>, op: 'update' });
    return next;
  });
  writes.push({ collection: 'places', element: place as { ref: string } & Record<string, unknown>, op: 'remove' });
  return { doc: { ...doc, places: doc.places.filter((each) => each.ref !== ref), sources }, writes };
}

const plainName = (name: string) =>
  name
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Ta sama nazwa dalej niż tyle to już raczej inne miejsce („Orle” w dwóch krajach). */
const SAME_NAME_M = 1000;

/**
 * Możliwe duplikaty: ta sama nazwa (chyba że współrzędne są daleko od siebie) albo te same współrzędne.
 * To podpowiedź przy liście, o scaleniu decyduje człowiek.
 */
export function similarPlaces(doc: Doc): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  const same = (a: Place, b: Place) => {
    const both = located(a) && located(b);
    if (both && a.lat === b.lat && a.lng === b.lng) return true;
    if (plainName(a.name) === '' || plainName(a.name) !== plainName(b.name)) return false;
    return !both || distanceM([a.lng!, a.lat!], [b.lng!, b.lat!]) <= SAME_NAME_M;
  };
  for (const place of doc.places) {
    const others = doc.places.filter((each) => each.ref !== place.ref && same(place, each)).map((each) => each.ref);
    if (others.length > 0) found[place.ref] = others;
  }
  return found;
}

export type PlaceMergeWrite = {
  collection: 'travelers' | 'items' | 'days' | 'bookings' | 'legs' | 'sources' | 'places';
  element: { ref: string } & Record<string, unknown>;
  op: 'update' | 'remove';
};

/** Zostaje `keep`; z `drop` bierze tylko to, czego `keep` nie ma. Współrzędne i ich źródło tylko razem. */
function mergedPlace(keep: Place, drop: Place): Place {
  const merged: Place = { ...drop, ...Object.fromEntries(Object.entries(keep).filter(([, value]) => value !== undefined)) } as Place;
  const coordinates = located(keep) ? keep : located(drop) ? drop : keep;
  const notes = [...new Set([keep.notes, drop.notes].filter((note) => note !== undefined && note !== ''))];
  return {
    ...merged,
    ref: keep.ref,
    provider: coordinates.provider,
    links: [...keep.links, ...drop.links.filter((link) => !keep.links.some((each) => each.url === link.url))],
    ...(notes.length > 0 ? { notes: notes.join('\n') } : {}),
    ...(coordinates.lat !== undefined && coordinates.lng !== undefined ? { lat: coordinates.lat, lng: coordinates.lng } : {}),
  };
}

/**
 * Scala dwa miejsca: wszystko, co wskazywało `drop`, wskazuje `keep`, a `drop` znika. Nowe pole wskazujące
 * miejsce trzeba obsłużyć tutaj; test na fixture'ach pilnuje, że żadne odwołanie nie zostaje.
 */
export function mergePlaces(doc: Doc, keepRef: string, dropRef: string): { doc: Doc; writes: PlaceMergeWrite[] } | null {
  const keep = doc.places.find((each) => each.ref === keepRef);
  const drop = doc.places.find((each) => each.ref === dropRef);
  if (keep === undefined || drop === undefined || keepRef === dropRef) return null;

  const writes: PlaceMergeWrite[] = [];
  const to = (ref: string | undefined) => (ref === dropRef ? keepRef : ref);
  const swap = <T extends { ref?: string | undefined }>(collection: PlaceMergeWrite['collection'], list: T[], change: (each: T) => T, uses: (each: T) => boolean): T[] =>
    list.map((each) => {
      if (!uses(each)) return each;
      const next = change(each);
      if (next.ref !== undefined) writes.push({ collection, element: next as { ref: string } & Record<string, unknown>, op: 'update' });
      return next;
    });

  const travelers = swap(
    'travelers',
    doc.travelers,
    (traveler) => ({
      ...traveler,
      ...(traveler.startPlaceRef === dropRef ? { startPlaceRef: keepRef } : {}),
      ...(traveler.endPlaceRef === dropRef ? { endPlaceRef: keepRef } : {}),
    }),
    (traveler) => traveler.startPlaceRef === dropRef || traveler.endPlaceRef === dropRef,
  );
  const items = swap(
    'items',
    doc.items,
    (item) => ({
      ...item,
      ...(item.placeRef === dropRef ? { placeRef: keepRef } : {}),
      ...(item.leg !== undefined ? { leg: { ...item.leg, ...(item.leg.fromPlaceRef === dropRef ? { fromPlaceRef: keepRef } : {}), ...(item.leg.toPlaceRef === dropRef ? { toPlaceRef: keepRef } : {}) } } : {}),
    }),
    (item) => item.placeRef === dropRef || item.leg?.fromPlaceRef === dropRef || item.leg?.toPlaceRef === dropRef,
  );
  const days = swap('days', doc.days, (day) => ({ ...day, baseRef: keepRef }), (day) => day.baseRef === dropRef);
  const bookings = swap(
    'bookings',
    doc.bookings,
    (booking) => ({
      ...booking,
      ...(booking.startPlaceRef === dropRef ? { startPlaceRef: keepRef } : {}),
      ...(booking.endPlaceRef === dropRef ? { endPlaceRef: keepRef } : {}),
    }),
    (booking) => booking.startPlaceRef === dropRef || booking.endPlaceRef === dropRef,
  );
  const legs = swap('legs', doc.legs, (leg) => ({ ...leg, fromRef: to(leg.fromRef)!, toRef: to(leg.toRef)! }), (leg) => leg.fromRef === dropRef || leg.toRef === dropRef);
  const sources = swap(
    'sources',
    doc.sources,
    (source) => ({ ...source, appliesToRefs: [...new Set(source.appliesToRefs.map((each) => to(each)!))] }),
    (source) => source.appliesToRefs.includes(dropRef),
  );

  const merged = mergedPlace(keep, drop);
  writes.push({ collection: 'places', element: merged as { ref: string } & Record<string, unknown>, op: 'update' });
  writes.push({ collection: 'places', element: drop as { ref: string } & Record<string, unknown>, op: 'remove' });
  return { doc: { ...doc, travelers, items, days, bookings, legs, sources, places: doc.places.filter((each) => each.ref !== dropRef).map((each) => (each.ref === keepRef ? merged : each)) }, writes };
}
