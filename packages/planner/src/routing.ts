import type { TripDocument } from '@expeditionplan/core';

/**
 * Realne czasy przejazdów z OpenRouteService (docs/USLUGI.md: 2000 tras/dzień, 40/min, darmowy).
 * AI szacuje jazdę z pamięci — na Dinarze „Szybenik → Dinara 75 min” wobec realnej godziny.
 * Dla punktu `transport` autem, pieszo albo rowerem bierzemy współrzędne skąd/dokąd (z `leg`,
 * a gdy ich brak — miejsce poprzedniego i następnego punktu dnia, na początku dnia jego baza)
 * i zastępujemy szacunek trasą: czas optymistyczny = ORS, pesymistyczny = +30% (korki, parking,
 * postój), dystans z trasy. Lotów, promów, pociągów ORS nie liczy — zostają jak są.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Place = Doc['places'][number];
type LegMode = NonNullable<Item['leg']>['mode'];
export type LatLng = { lat: number; lng: number };
export type RouteProfile = 'driving-car' | 'foot-walking' | 'foot-hiking' | 'cycling-regular';
export type Route = { distanceKm: number; durationMin: number };
/** `null` = ORS nie zna trasy (punkt poza drogami, morze między). */
export type RouteLookup = (from: LatLng, to: LatLng, profile: RouteProfile) => Promise<Route | null>;

export const PROFILE: Partial<Record<LegMode, RouteProfile>> = {
  car: 'driving-car',
  rental_car: 'driving-car',
  taxi: 'driving-car',
  hired_driver: 'driving-car',
  walk: 'foot-walking',
  hike: 'foot-hiking',
  bike: 'cycling-regular',
};

/** Zapas na korki, parkowanie i postój w scenariuszu pesymistycznym. */
const PESSIMISTIC = 1.3;
/** Ile razy trasa może się różnić od dystansu z planu, zanim uznamy, że końce są złe. */
const MISMATCH = 2.5;
/** Najwięcej tras na jeden plan — dzienny limit ORS (2000) dzieli się na wszystkie plany. */
export const MAX_ROUTES = 60;

export type RouteResult = {
  ref: string;
  title: string;
  /** `mismatch` = trasa nie pasuje do dystansu z planu (pewnie złe końce) — nie zapisujemy. */
  status: 'routed' | 'no_coordinates' | 'not_found' | 'mismatch' | 'failed' | 'skipped_limit';
  /** Szacunek sprzed trasy i wynik ORS (minuty, km) — do raportu i porównania. */
  before?: { durationMin?: number; distanceKm?: number };
  after?: Route;
  error?: string;
};

const coords = (place: Place | undefined): LatLng | undefined =>
  place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;

/**
 * Skąd i dokąd jedzie punkt `transport`. Z `leg` (szkice AI je podają), a bez niego z sąsiadów
 * w dniu: skąd = miejsce poprzedniego punktu (na początku dnia baza), dokąd = miejsce następnego.
 * Miejsce samego przejazdu bywa i startem („Wyjazd z parkingu”), i celem („Przejazd do
 * Szybenika”), więc służy tylko wtedy, gdy po przejeździe nie ma już punktu z miejscem.
 * Sąsiedzi z tego samego wariantu — punkt wersji B nie jedzie z punktu wersji A.
 */
export function legEnds(doc: Doc, item: Item): { from?: LatLng; to?: LatLng } {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const at = (ref: string | undefined) => (ref === undefined ? undefined : coords(places.get(ref)));
  let from = at(item.leg?.fromPlaceRef);
  let to = at(item.leg?.toPlaceRef);
  if ((from === undefined || to === undefined) && item.dayRef !== undefined) {
    const fits = (each: Item) => each.variantRefs.length === 0 || each.variantRefs.some((ref) => item.variantRefs.includes(ref));
    const day = doc.items
      .filter((each) => each.dayRef === item.dayRef && each.parentRef === undefined && (each.ref === item.ref || fits(each)))
      .sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
    const index = day.findIndex((each) => each.ref === item.ref);
    const arrival = (each: Item) => at(each.leg?.toPlaceRef ?? each.placeRef);
    if (from === undefined) {
      const previous = day.slice(0, index).reverse().find((each) => arrival(each) !== undefined);
      const base = doc.days.find((each) => each.ref === item.dayRef)?.baseRef;
      from = previous === undefined ? at(base) : arrival(previous);
    }
    if (to === undefined) {
      const next = day.slice(index + 1).find((each) => at(each.leg?.fromPlaceRef ?? each.placeRef) !== undefined);
      to = next === undefined ? at(item.placeRef) : at(next.leg?.fromPlaceRef ?? next.placeRef);
    }
  }
  return { from, to };
}

const sameSpot = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;

/** Przejazdy dokumentu przeliczone trasami ORS; `refs` = tylko te punkty (domyślnie wszystkie). */
export async function routeLegs(doc: Doc, lookup: RouteLookup, refs?: ReadonlySet<string>): Promise<{ doc: Doc; results: RouteResult[] }> {
  const results: RouteResult[] = [];
  const changed = new Map<string, Item>();
  let used = 0;
  for (const item of doc.items) {
    if (item.kind !== 'transport' || item.leg === undefined || (refs !== undefined && !refs.has(item.ref))) continue;
    const profile = PROFILE[item.leg.mode];
    if (profile === undefined) continue;
    const before = { durationMin: item.durationMin ?? item.leg.durationMin, distanceKm: item.leg.distanceKm };
    const base = { ref: item.ref, title: item.title, before };
    const { from, to } = legEnds(doc, item);
    if (from === undefined || to === undefined || sameSpot(from, to)) {
      results.push({ ...base, status: 'no_coordinates' });
      continue;
    }
    if (used >= MAX_ROUTES) {
      results.push({ ...base, status: 'skipped_limit' });
      continue;
    }
    used += 1;
    let route: Route | null;
    try {
      route = await lookup(from, to, profile);
    } catch (error) {
      results.push({ ...base, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (route === null) {
      results.push({ ...base, status: 'not_found' });
      continue;
    }
    // Plan mówi „40 km”, a trasa wychodzi 3 km albo 200 km — końce odcinka zgadnięte źle.
    const stated = item.leg.distanceKm;
    if (stated !== undefined && stated > 0 && (route.distanceKm / stated > MISMATCH || stated / route.distanceKm > MISMATCH)) {
      results.push({ ...base, status: 'mismatch', after: route });
      continue;
    }
    const durationMin = Math.max(1, Math.round(route.durationMin));
    // Czas przejazdu idzie z trasy — pola punktu (szacunek AI) ustępują `leg`, który silnik czyta po nich.
    changed.set(item.ref, {
      ...item,
      durationMin: undefined,
      durationMaxMin: undefined,
      leg: { ...item.leg, durationMin, durationMaxMin: Math.round(durationMin * PESSIMISTIC), distanceKm: Math.round(route.distanceKm * 10) / 10, routed: true },
    });
    results.push({ ...base, status: 'routed', after: { durationMin, distanceKm: route.distanceKm } });
  }
  return { doc: { ...doc, items: doc.items.map((item) => changed.get(item.ref) ?? item) }, results };
}

const ENDPOINT = 'https://api.openrouteservice.org/v2/directions';
/** Promień dociągnięcia punktu do sieci dróg / ścieżek. */
const SNAP_CAR_M = 5000;
const SNAP_FOOT_M = 1000;
/** 40 zapytań/min z zapasem. */
const GAP_MS = 1600;

/** ORS Directions; klucz tylko po stronie serwera (nagłówek `Authorization`, nie w adresie). */
export function orsRoute(apiKey: string, fetchImpl: typeof fetch = fetch): RouteLookup {
  let queue: Promise<void> = Promise.resolve();
  const throttle = () => {
    const turn = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, GAP_MS)));
    queue = turn;
    return turn;
  };
  return async (from, to, profile) => {
    await throttle();
    // Domyślnie ORS szuka drogi 350 m od punktu — parking pod szczytem, szlak czy plaża bywają dalej.
    const snap = profile === 'driving-car' ? SNAP_CAR_M : SNAP_FOOT_M;
    const response = await fetchImpl(`${ENDPOINT}/${profile}`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]], radiuses: [snap, snap], instructions: false }),
    });
    // 404 = punkt poza siecią dróg (np. szczyt, środek jeziora) — trasy nie ma, to nie awaria.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OpenRouteService ${response.status}`);
    const body = (await response.json()) as { routes?: { summary?: { distance?: number; duration?: number } }[] };
    const summary = body.routes?.[0]?.summary;
    if (summary?.distance === undefined || summary.duration === undefined) return null;
    return { distanceKm: summary.distance / 1000, durationMin: summary.duration / 60 };
  };
}
