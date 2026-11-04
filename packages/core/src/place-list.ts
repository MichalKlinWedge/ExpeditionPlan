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
  /** Punkty, rezerwacje, dni i przejazdy; źródła nie blokują usunięcia. */
  total: number;
};

export function placeUsage(doc: Doc, ref: string): PlaceUsage {
  const items = doc.items.filter((item) => item.placeRef === ref || item.leg?.fromPlaceRef === ref || item.leg?.toPlaceRef === ref).map((item) => ({ ref: item.ref, title: item.title }));
  const bookings = doc.bookings.filter((booking) => booking.startPlaceRef === ref || booking.endPlaceRef === ref).map((booking) => ({ ref: booking.ref, title: booking.title }));
  const days = doc.days.filter((day) => day.baseRef === ref).length;
  const legs = doc.legs.filter((leg) => leg.fromRef === ref || leg.toRef === ref).length;
  return { items, bookings, days, legs, total: items.length + bookings.length + days + legs };
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
