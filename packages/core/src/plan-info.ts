import { decodePolyline, distanceM, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Co plan wie o mapie: skąd czas przejazdu (trasa czy szacunek), dystans, które miejsca mają
 * współrzędne. Ten sam opis na webie i w telefonie — bez tego wyniki „Przelicz przejazdy”
 * i „Uzupełnij współrzędne” widać tylko po przesuniętych godzinach.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

/** Tryby, dla których umiemy policzyć trasę (auto, pieszo, rower) — reszta to rozkład jazdy. */
export const ROUTABLE_MODES: ReadonlySet<string> = new Set(['car', 'rental_car', 'taxi', 'hired_driver', 'walk', 'hike', 'bike']);

/** 84 → „1 h 24 min”, 45 → „45 min”, 120 → „2 h”. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const km = (value: number) => `${value.toLocaleString('pl-PL', { maximumFractionDigits: value < 10 ? 1 : 0 })} km`;

/**
 * Opis przejazdu: „63,6 km · 1 h 24 min, w gorszym razie 1 h 49 min (trasa z mapy)” albo
 * „ok. 75 min, ok. 70 km (szacunek)”. Czas wpisany w punkt (edycja ręczna) wygrywa z `leg`
 * tak samo jak w silniku. `null` = punkt nie jest przejazdem albo nie ma czego pokazać.
 */
export function legLabel(item: Item): string | null {
  const leg = item.leg;
  if (item.kind !== 'transport' || leg === undefined) return null;
  if (item.durationMin !== undefined) return `${formatMinutes(item.durationMin)} (wpisane ręcznie)`;
  if (leg.routed && leg.durationMin !== undefined) {
    const worse = leg.durationMaxMin !== undefined && leg.durationMaxMin > leg.durationMin ? `, w gorszym razie ${formatMinutes(leg.durationMaxMin)}` : '';
    return `${leg.distanceKm !== undefined ? `${km(leg.distanceKm)} · ` : ''}${formatMinutes(leg.durationMin)}${worse} (trasa z mapy)`;
  }
  const parts = [leg.durationMin === undefined ? null : `ok. ${formatMinutes(leg.durationMin)}`, leg.distanceKm === undefined ? null : `ok. ${km(leg.distanceKm)}`].filter((part) => part !== null);
  return parts.length === 0 ? null : `${parts.join(', ')} (szacunek)`;
}

/** Miejsce punktu bez współrzędnych — nie ma go na mapie, nie policzy się do niego trasy. */
export function missingOnMap(doc: Doc, item: Item): boolean {
  if (item.placeRef === undefined) return false;
  const place = doc.places.find((each) => each.ref === item.placeRef);
  return place !== undefined && (place.lat === undefined || place.lng === undefined);
}

export type MapCoverage = {
  /** Miejsca użyte w planie (punkty, bazy dni, końce przejazdów) — ile ma współrzędne. */
  places: { onMap: number; total: number };
  /** Przejazdy autem/pieszo/rowerem — ile ma czas z trasy. */
  legs: { routed: number; routable: number };
};

export function mapCoverage(doc: Doc): MapCoverage {
  const used = new Set<string>();
  for (const item of doc.items) {
    for (const ref of [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]) if (ref !== undefined) used.add(ref);
  }
  for (const day of doc.days) if (day.baseRef !== undefined) used.add(day.baseRef);
  const places = doc.places.filter((place) => used.has(place.ref));
  const routable = doc.items.filter((item) => item.kind === 'transport' && item.leg !== undefined && ROUTABLE_MODES.has(item.leg.mode));
  return {
    places: { onMap: places.filter((place) => place.lat !== undefined && place.lng !== undefined).length, total: places.length },
    legs: { routed: routable.filter((item) => item.leg!.routed === true && item.durationMin === undefined).length, routable: routable.length },
  };
}

/** Pinezka mapy dnia: jedno miejsce, a przy nim punkty dnia z numerami kolejności. */
export type MapPin = {
  placeRef: string;
  name: string;
  lat: number;
  lng: number;
  stops: { ref: string; n: number; title: string }[];
  /** Baza (nocleg) dnia. */
  base?: boolean;
  /** Punkty z puli w tym miejscu (bez numeru — poza dniem). */
  pool?: { ref: string; title: string }[];
  /** Własna pinezka użytkownika (`provider: 'user'`) — można ją przesunąć na mapie. */
  movable?: boolean;
};

/** Kawałek linii dnia [lng, lat]: trasa po drogach z ORS (`routed`) albo prosta między miejscami. */
export type MapLine = { coordinates: LngLat[]; routed: boolean };

export type DayMap = {
  pins: MapPin[];
  /** Linia dnia po kolei: trasy przejazdów, gdy są zapisane, a między resztą miejsc — proste. */
  lines: MapLine[];
  /** Numer punktu na mapie (tylko punkty z miejscem ze współrzędnymi). */
  numbers: Record<string, number>;
};

/** Pieszo trasa dociąga się do ścieżki z 1 km, autem do drogi z 5 km (`routing.ts`). */
const FOOT_MODES: ReadonlySet<string> = new Set(['walk', 'hike', 'bike']);
const SNAP_FOOT_M = 1_000;
const SNAP_CAR_M = 5_000;

/**
 * Mapa dnia z kolejności podanej przez silnik (`refs` = punkty dnia po wariantach i pominięciach).
 * Przejazd zaczyna się w miejscu „skąd” i kończy w „dokąd” — numer dostaje cel. Kilka punktów
 * w tym samym miejscu (powrót do noclegu) to jedna pinezka z kilkoma numerami.
 * Przejazd z zapisaną linią trasy (`leg.geometry`) rysuje się po drogach — o ile jej końce
 * pasują do sąsiednich miejsc; po przestawieniu punktu stara trasa ustępuje linii prostej.
 */
export function dayMap(doc: Doc, refs: readonly string[], options: { baseRef?: string; pool?: boolean } = {}): DayMap {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const pins = new Map<string, MapPin>();
  const pin = (ref: string | undefined): MapPin | undefined => {
    if (ref === undefined) return undefined;
    const place = places.get(ref);
    if (place?.lat === undefined || place.lng === undefined) return undefined;
    let found = pins.get(ref);
    if (found === undefined) {
      found = { placeRef: ref, name: place.name, lat: place.lat, lng: place.lng, stops: [] };
      if (place.provider === 'user') found.movable = true;
      pins.set(ref, found);
    }
    return found;
  };
  const at = (found: MapPin): LngLat => [found.lng, found.lat];
  const lines: MapLine[] = [];
  let cursor: LngLat | undefined;
  const straightTo = (point: LngLat) => {
    if (cursor !== undefined && (cursor[0] !== point[0] || cursor[1] !== point[1])) {
      const last = lines.at(-1);
      const end = last?.coordinates.at(-1);
      if (last !== undefined && !last.routed && end?.[0] === cursor[0] && end[1] === cursor[1]) last.coordinates.push(point);
      else lines.push({ coordinates: [cursor, point], routed: false });
    }
    cursor = point;
  };
  /** Gdzie zaczyna się następny punkt dnia ze współrzędnymi — tam kończy się trasa przejazdu bez „dokąd”. */
  const nextStart = (index: number): LngLat | undefined => {
    for (const ref of refs.slice(index + 1)) {
      const item = items.get(ref);
      const place = item === undefined ? undefined : places.get(item.leg?.fromPlaceRef ?? item.placeRef ?? '');
      if (place?.lat !== undefined && place.lng !== undefined) return [place.lng, place.lat];
    }
    return undefined;
  };
  const numbers: Record<string, number> = {};
  refs.forEach((ref, index) => {
    const item = items.get(ref);
    if (item === undefined) return;
    const leg = item.kind === 'transport' ? item.leg : undefined;
    const from = pin(leg?.fromPlaceRef);
    if (from !== undefined) straightTo(at(from));
    const target = pin(leg === undefined ? item.placeRef : (leg.toPlaceRef ?? item.placeRef));
    const route = leg === undefined ? null : routeLine(leg, cursor, [target === undefined ? undefined : at(target), nextStart(index)]);
    if (route !== null) {
      straightTo(route[0]!);
      lines.push({ coordinates: route, routed: true });
      cursor = route.at(-1);
    } else if (target !== undefined) {
      straightTo(at(target));
    }
    if (target === undefined) return;
    const n = Object.keys(numbers).length + 1;
    numbers[ref] = n;
    target.stops.push({ ref, n, title: item.title });
  });
  const base = pin(options.baseRef);
  if (base !== undefined) base.base = true;
  if (options.pool) {
    for (const item of doc.items) {
      if (item.dayRef !== undefined) continue;
      const found = pin(item.placeRef);
      if (found !== undefined) (found.pool ??= []).push({ ref: item.ref, title: item.title });
    }
  }
  return { pins: [...pins.values()], lines, numbers };
}

/**
 * Linia trasy przejazdu, jeśli pasuje do planu: początek przy miejscu, z którego się wyjeżdża,
 * koniec przy celu albo przy następnym punkcie. Inaczej `null` — trasa jest z innej kolejności.
 */
function routeLine(leg: NonNullable<Item['leg']>, start: LngLat | undefined, ends: (LngLat | undefined)[]): LngLat[] | null {
  if (leg.geometry === undefined) return null;
  const route = decodePolyline(leg.geometry);
  if (route.length < 2) return null;
  const snap = FOOT_MODES.has(leg.mode) ? SNAP_FOOT_M : SNAP_CAR_M;
  if (start !== undefined && distanceM(start, route[0]!) > snap) return null;
  const known = ends.filter((end) => end !== undefined);
  if (known.length > 0 && !known.some((end) => distanceM(end, route.at(-1)!) <= snap)) return null;
  return route;
}
