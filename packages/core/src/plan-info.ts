import { decodePolyline, distanceM, type LngLat } from './polyline.ts';
import { isRouteStop } from './route-stops.ts';
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
  const label = legTimeLabel(item);
  return label === null || !item.stopsMin ? label : `${label} + postoje ${formatMinutes(item.stopsMin)}`;
}

/** Przejazd z postojami w trasie: „razem z postojami po drodze (1 h 40 min): 5 h”. */
export const routeStopsLabel = (item: { routeStopsMin?: number; durationMin: number }): string | null =>
  !item.routeStopsMin ? null : `razem z postojami po drodze (${formatMinutes(item.routeStopsMin)}): ${formatMinutes(item.durationMin)}`;

/** Czas postoju w trasie zamiast godzin w planie dnia. */
export const routeStopTime = (minutes: number): string => (minutes > 0 ? `postój ${formatMinutes(minutes)}` : 'bez czasu');

/** Postoje punktu, który nie ma opisu przejazdu (`legLabel` daje `null`). */
export const stopsLabel = (item: Item): string | null => (item.stopsMin ? `w tym postoje i przerwy: ${formatMinutes(item.stopsMin)}` : null);

function legTimeLabel(item: Item): string | null {
  const leg = item.leg;
  if (item.kind !== 'transport' || leg === undefined) return null;
  if (item.durationMin !== undefined) return `${formatMinutes(item.durationMin)} (wpisane ręcznie)`;
  if (leg.routed && leg.durationMin !== undefined) {
    const worse = leg.durationMaxMin !== undefined && leg.durationMaxMin > leg.durationMin ? `, w gorszym razie ${formatMinutes(leg.durationMaxMin)}` : '';
    return `${leg.distanceKm !== undefined ? `${km(leg.distanceKm)} · ` : ''}${formatMinutes(leg.durationMin)}${worse} (trasa z mapy)`;
  }
  const parts = [leg.durationMin === undefined ? null : `ok. ${formatMinutes(leg.durationMin)}`, leg.distanceKm === undefined ? null : `ok. ${km(leg.distanceKm)}`].filter((part) => part !== null);
  return parts.length === 0 ? null : `${parts.join(', ')} (${leg.routed === false ? 'z podanej trasy' : 'szacunek'})`;
}

/** Miejsce punktu bez współrzędnych — nie ma go na mapie, nie policzy się do niego trasy. */
export function missingOnMap(doc: Doc, item: Item): boolean {
  if (item.placeRef === undefined) return false;
  const place = doc.places.find((each) => each.ref === item.placeRef);
  return place !== undefined && (place.lat === undefined || place.lng === undefined);
}

/** Nocleg na koniec dnia — w planie jako ostatnia pozycja, na mapie jako baza (⌂). */
export type DayLodging = {
  placeRef?: string;
  name: string;
  /** Rezerwacja noclegu obejmująca tę noc (`kind: lodging` albo pakiet z noclegiem). */
  booking?: { ref: string; title: string; code?: string; checkInFrom?: string };
  /** Miejsce ma współrzędne — jest na mapie. */
  onMap: boolean;
};

export const LIVE_BOOKING = new Set(['to_book', 'booked', 'paid', 'unknown', 'not_required']);

/**
 * Nocleg dnia: baza dnia (`day.baseRef`) i rezerwacja noclegu na tę noc (start ≤ data < koniec).
 * Bez bazy — miejsce z rezerwacji. `null` = tej nocy nie ma noclegu (zwykle dzień powrotu).
 */
export function dayLodging(doc: Doc, dayRef: string): DayLodging | null {
  const day = doc.days.find((each) => each.ref === dayRef);
  if (day === undefined) return null;
  const nights = doc.bookings.filter(
    (booking) =>
      (booking.kind === 'lodging' || booking.lodging !== undefined) &&
      LIVE_BOOKING.has(booking.status) &&
      booking.start !== undefined &&
      booking.start.date <= day.date &&
      day.date < (booking.end?.date ?? booking.start.date),
  );
  const booking = nights.find((each) => day.baseRef !== undefined && (each.startPlaceRef === day.baseRef || each.endPlaceRef === day.baseRef)) ?? nights[0];
  // Rezerwacja mówi dokładniej niż baza dnia, gdzie śpimy.
  const placeRef = booking?.startPlaceRef ?? day.baseRef;
  if (placeRef === undefined && booking === undefined) return null;
  const place = placeRef === undefined ? undefined : doc.places.find((each) => each.ref === placeRef);
  return {
    ...(placeRef !== undefined ? { placeRef } : {}),
    name: place?.name ?? booking!.title,
    ...(booking !== undefined
      ? {
          booking: {
            ref: booking.ref,
            title: booking.title,
            ...(booking.confirmationCode ? { code: booking.confirmationCode } : {}),
            // Zameldowanie tylko pierwszej nocy rezerwacji.
            ...(booking.start!.date === day.date && (booking.checkInFrom ?? booking.start!.time) ? { checkInFrom: booking.checkInFrom ?? booking.start!.time } : {}),
          },
        }
      : {}),
    onMap: place?.lat !== undefined && place.lng !== undefined,
  };
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
  /** Cel przejazdu: numer przejazdu stoi przy jego starcie, więc cel może nie mieć własnego numeru. */
  arrival?: boolean;
  /** Własna pinezka użytkownika (`provider: 'user'`) — można ją przesunąć na mapie. */
  movable?: boolean;
  /** Miejsce tylko dojazdu albo powrotu (lotnisko w domu, start długiej drogi) — mapa może je ukryć. */
  transit?: boolean;
};

/** Kawałek linii dnia [lng, lat]: trasa po drogach z ORS (`routed`) albo prosta między miejscami. */
/** `track` — ślad GPX aktywności (rysowany jak trasa po drogach). */
/** `refs` — punkty dnia, które ta linia opisuje (podświetlenie po najechaniu na link do trasy). */
export type MapLine = { coordinates: LngLat[]; routed: boolean; transit?: boolean; track?: true; refs?: string[] };

/** Przejazd dłuższy niż tyle km to dojazd albo powrót, nie trasa dnia. */
const TRANSIT_KM = 250;

/**
 * Dojazd albo powrót: lot (rezerwacja lotu albo przejazd samolotem, także odprawa i przylot
 * z tą rezerwacją) albo przejazd dłuższy niż 250 km. Na mapie dnia można go ukryć — inaczej
 * skala całego kraju gubi szczegóły na miejscu.
 */
export function isTransit(doc: Doc, item: Item): boolean {
  if (item.bookingRef !== undefined && doc.bookings.find((booking) => booking.ref === item.bookingRef)?.kind === 'flight') return true;
  if (item.kind !== 'transport' || item.leg === undefined) return false;
  return item.leg.mode === 'flight' || (item.leg.distanceKm ?? 0) >= TRANSIT_KM;
}

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

/** Klucz noclegu dnia w `DayMap.numbers` i `MapPin.stops`: nocleg nie jest punktem planu, ale ma numer na końcu dnia. */
export const LODGING_STOP = 'nocleg';

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
  /** Miejsca punktów poza dojazdem i powrotem — reszta pinezek to `transit`. */
  const local = new Set<string>();
  let cursor: LngLat | undefined;
  /** Kursor stoi na końcu śladu GPX, który rzadko trafia co do metra w pinezkę. */
  let afterTrack = false;
  const straightTo = (point: LngLat, transit = false) => {
    const arrived = afterTrack && cursor !== undefined && distanceM(cursor, point) <= SNAP_FOOT_M;
    afterTrack = false;
    if (arrived) {
      cursor = point;
      return;
    }
    if (cursor !== undefined && (cursor[0] !== point[0] || cursor[1] !== point[1])) {
      const last = lines.at(-1);
      const end = last?.coordinates.at(-1);
      if (last !== undefined && !last.routed && (last.transit ?? false) === transit && end?.[0] === cursor[0] && end[1] === cursor[1]) last.coordinates.push(point);
      else lines.push({ coordinates: [cursor, point], routed: false, ...(transit ? { transit } : {}) });
    }
    cursor = point;
  };
  /** Gdzie zaczyna się następny punkt dnia ze współrzędnymi — tam kończy się trasa przejazdu bez „dokąd”. */
  const nextStart = (index: number): LngLat | undefined => {
    for (const ref of refs.slice(index + 1)) {
      const item = items.get(ref);
      if (item !== undefined && isRouteStop(doc, item)) continue;
      const place = item === undefined ? undefined : places.get(item.leg?.fromPlaceRef ?? item.placeRef ?? '');
      if (place?.lat !== undefined && place.lng !== undefined) return [place.lng, place.lat];
    }
    return undefined;
  };
  const numbers: Record<string, number> = {};
  const tracks = new Map(doc.tracks.map((track) => [track.ref, track]));
  const drawn = new Map<string, MapLine>();
  let previousPin: MapPin | undefined;
  refs.forEach((ref, index) => {
    const item = items.get(ref);
    if (item === undefined) return;
    // Postój w trasie: pinezka i numer, ale linia dnia biegnie przejazdem, bez powrotu do niego.
    if (isRouteStop(doc, item)) {
      const stop = pin(item.placeRef);
      if (stop === undefined) return;
      local.add(stop.placeRef);
      const stopNumber = Object.keys(numbers).length + 1;
      numbers[ref] = stopNumber;
      stop.stops.push({ ref, n: stopNumber, title: item.title });
      return;
    }
    // Ślad GPX aktywności — raz na dzień, choćby kilka punktów szło tą samą trasą.
    const track = item.activity?.trackRef === undefined ? undefined : tracks.get(item.activity.trackRef);
    const leg = item.kind === 'transport' ? item.leg : undefined;
    const transit = isTransit(doc, item);
    const from = pin(leg?.fromPlaceRef);
    if (from !== undefined) straightTo(at(from), transit);
    const target = pin(leg === undefined ? item.placeRef : (leg.toPlaceRef ?? item.placeRef));
    // Miejsce używane tylko przez dojazd i powrót (np. lotnisko w domu) jest `transit`.
    if (!transit) for (const found of [from, target]) if (found !== undefined) local.add(found.placeRef);
    const route = leg === undefined ? null : routeLine(leg, cursor, [target === undefined ? undefined : at(target), nextStart(index)]);
    if (track?.geojson !== undefined) {
      // Ślad zastępuje linię prostą do celu; kreska tylko wtedy, gdy zaczyna się z dala od poprzedniego miejsca.
      const known = drawn.get(track.ref);
      if (known !== undefined) {
        known.refs!.push(ref);
        cursor = target === undefined ? cursor : at(target);
      } else {
        const coordinates = track.geojson.coordinates.map((point) => [point[0]!, point[1]!] as LngLat);
        if (cursor !== undefined && distanceM(cursor, coordinates[0]!) > SNAP_FOOT_M) straightTo(coordinates[0]!, transit);
        const line: MapLine = { coordinates, routed: true, track: true, refs: [ref] };
        drawn.set(track.ref, line);
        lines.push(line);
        cursor = coordinates.at(-1);
        afterTrack = true;
      }
    } else if (route !== null) {
      straightTo(route[0]!, transit);
      lines.push({ coordinates: route, routed: true, refs: [ref], ...(transit ? { transit } : {}) });
      cursor = route.at(-1);
    } else if (target !== undefined) {
      straightTo(at(target), transit);
    }
    // Numer przejazdu stoi tam, skąd się rusza: przy „skąd”, a bez niego przy poprzednim miejscu dnia.
    const numbered = leg === undefined ? target : (from ?? previousPin ?? target);
    if (leg !== undefined && target !== undefined) target.arrival = true;
    previousPin = target ?? from ?? previousPin;
    if (numbered === undefined) return;
    const n = Object.keys(numbers).length + 1;
    numbers[ref] = n;
    numbered.stops.push({ ref, n, title: item.title });
  });
  const base = pin(options.baseRef);
  if (base !== undefined) {
    base.base = true;
    // Koniec dnia: z ostatniego miejsca do noclegu, który dostaje ostatni numer.
    straightTo(at(base));
    const n = Object.keys(numbers).length + 1;
    numbers[LODGING_STOP] = n;
    base.stops.push({ ref: LODGING_STOP, n, title: `Nocleg: ${base.name}` });
  }
  if (options.pool) {
    for (const item of doc.items) {
      if (item.dayRef !== undefined) continue;
      const found = pin(item.placeRef);
      if (found !== undefined) (found.pool ??= []).push({ ref: item.ref, title: item.title });
    }
  }
  for (const found of pins.values()) if (!local.has(found.placeRef) && !found.base && found.pool === undefined) found.transit = true;
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
