import { decodePolyline, encodePolyline, legEnds, simplifyPath, type TripDocument } from '@expeditionplan/core';

import { HOME_COUNTRY, type Lookup, withCoordinates } from './ground.ts';
import { candidateQueries, skipReason } from './queries.ts';

/**
 * Realne czasy przejazdów z OpenRouteService (docs/USLUGI.md: 2000 tras/dzień, 40/min, darmowy).
 * AI szacuje jazdę z pamięci — na Dinarze „Szybenik → Dinara 75 min” wobec realnej godziny.
 * Dla punktu `transport` autem, pieszo albo rowerem bierzemy współrzędne skąd/dokąd (z `leg`,
 * a gdy ich brak — miejsce poprzedniego i następnego punktu dnia, na początku dnia jego baza)
 * i zastępujemy szacunek trasą: czas optymistyczny = ORS, pesymistyczny = +30% (korki, parking,
 * postój), dystans z trasy, a do mapy — uproszczona linia trasy (`leg.geometry`). Lotów, promów,
 * pociągów ORS nie liczy — zostają jak są.
 */

export { legEnds };

type Doc = TripDocument;
type Item = Doc['items'][number];
type Place = Doc['places'][number];
type LegMode = NonNullable<Item['leg']>['mode'];
export type LatLng = { lat: number; lng: number };
export type RouteProfile = 'driving-car' | 'foot-walking' | 'foot-hiking' | 'cycling-regular';
/** `geometry` = polilinia z ORS (format Google, precyzja 5), pełna — upraszcza ją `routeLegs`. */
export type Route = { distanceKm: number; durationMin: number; geometry?: string };
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
/** Ile linia trasy może odjechać od drogi po uproszczeniu — autem 25 m, pieszo 5 m (ścieżki się wiją). */
const SIMPLIFY_CAR_M = 25;
const SIMPLIFY_FOOT_M = 5;

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
 * Końce przejazdu wskazane w `leg`, ale bez współrzędnych, szukane po nazwie. Inaczej niż w
 * `groundPlaces` miejscowość jest dobrym trafieniem, a odległość od reszty planu nie wyklucza
 * wyniku: start bywa w domu, setki kilometrów od wyjazdu. Nazwę trafienia trzeba pokazać
 * użytkownikowi. Awaria wyszukiwarki = brak trafienia.
 */
export async function locateLegEnds(doc: Doc, item: Item, lookup: Lookup, countries: string[]): Promise<{ place: Place; foundAs: string }[]> {
  if (item.leg === undefined || PROFILE[item.leg.mode] === undefined) return [];
  const refs = new Set([item.leg.fromPlaceRef, item.leg.toPlaceRef]);
  const missing = doc.places.filter((place) => refs.has(place.ref) && coords(place) === undefined && skipReason(place) === null);
  const within = [...new Set([...countries.map((code) => code.toLowerCase()), HOME_COUNTRY])];
  const located: { place: Place; foundAs: string }[] = [];
  for (const place of missing) {
    for (const query of candidateQueries(place)) {
      const hit = await lookup(query, within).catch(() => null);
      if (hit === null) continue;
      located.push({ place: withCoordinates(place, hit), foundAs: hit.displayName });
      break;
    }
  }
  return located;
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
      leg: {
        ...item.leg,
        durationMin,
        durationMaxMin: Math.round(durationMin * PESSIMISTIC),
        distanceKm: Math.round(route.distanceKm * 10) / 10,
        routed: true,
        geometry: routeGeometry(route.geometry, profile),
      },
    });
    results.push({ ...base, status: 'routed', after: { durationMin, distanceKm: route.distanceKm } });
  }
  return { doc: { ...doc, items: doc.items.map((item) => changed.get(item.ref) ?? item) }, results };
}

/** Linia z ORS uproszczona do mapy; stara linia znika, gdy nowa trasa jej nie ma. */
function routeGeometry(encoded: string | undefined, profile: RouteProfile): string | undefined {
  if (encoded === undefined) return undefined;
  const points = decodePolyline(encoded);
  if (points.length < 2) return undefined;
  return encodePolyline(simplifyPath(points, profile === 'driving-car' ? SIMPLIFY_CAR_M : SIMPLIFY_FOOT_M));
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
    // Bez `geometry_format` ORS oddaje linię jako zakodowaną polilinię (precyzja 5).
    const body = (await response.json()) as { routes?: { summary?: { distance?: number; duration?: number }; geometry?: unknown }[] };
    const first = body.routes?.[0];
    const summary = first?.summary;
    if (summary?.distance === undefined || summary.duration === undefined) return null;
    const geometry = typeof first?.geometry === 'string' && first.geometry !== '' ? first.geometry : undefined;
    return { distanceKm: summary.distance / 1000, durationMin: summary.duration / 60, ...(geometry === undefined ? {} : { geometry }) };
  };
}
