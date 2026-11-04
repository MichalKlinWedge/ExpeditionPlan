import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Trasa piesza punktu z zewnętrznej mapy: link (np. mapy.com/s/…) i liczby, które ta mapa pokazuje.
 * Zapisuje je w śladzie punktu (`tracks`, nowym albo z `activity.trackRef`), a czas przenosi do punktu —
 * od niego silnik liczy godziny dnia. Liczby wpisuje użytkownik albo dają je linia i statystyki z jego
 * własnego pliku GPX: regulamin Mapy.com zabrania przechowywania wyników ich API (docs/USLUGI.md).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Track = Doc['tracks'][number];

const FOOT = new Set(['walk', 'hike']);

/** Punkt, do którego można podpiąć trasę pieszą: aktywność albo przejście pieszo. */
export const isFootRouteItem = (item: Item) => item.kind === 'activity' || FOOT.has(item.leg?.mode ?? '');

const GOOGLE_ROUTE_LABEL = 'Trasa w Mapach Google';

/** Etykieta linku do trasy po adresie. */
export function routeLinkLabel(url: string): string {
  if (/(^|\/\/|\.)mapy\.(com|cz)(\/|$)/i.test(url)) return 'Trasa na mapy.com';
  return /\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|maps\.)?google\.[a-z.]+\/maps)/i.test(url) || /\/\/maps\.google\./i.test(url) ? GOOGLE_ROUTE_LABEL : 'Trasa na mapie';
}

const CAR = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);

/**
 * Link do trasy w Mapach Google dla przejazdu autem. Sam link, bez API: trasa liczy się dopiero po
 * otwarciu i nic z niej nie zapisujemy. Miejsce bez współrzędnych idzie adresem albo nazwą, a bez
 * miejsca startu Mapy Google liczą trasę od bieżącej pozycji. `null` = nie auto albo brak celu.
 */
export function drivingRouteUrl(doc: Doc, item: Item): string | null {
  const leg = item.leg;
  if (item.kind !== 'transport' || leg === undefined || !CAR.has(leg.mode)) return null;
  const point = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : doc.places.find((each) => each.ref === ref);
    if (place === undefined) return undefined;
    return place.lat !== undefined && place.lng !== undefined ? `${place.lat},${place.lng}` : (place.address ?? place.searchName ?? place.name);
  };
  const destination = point(leg.toPlaceRef ?? item.placeRef);
  if (destination === undefined) return null;
  const origin = point(leg.fromPlaceRef);
  return `https://www.google.com/maps/dir/?api=1${origin === undefined ? '' : `&origin=${encodeURIComponent(origin)}`}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

/** Link do trasy przejazdu: własny albo liczony ze „skąd” i „dokąd” dla auta. */
export function legRouteLink(doc: Doc, item: Item): { url: string; label: string } | null {
  if (item.kind !== 'transport') return null;
  if (item.leg?.routeUrl !== undefined) return { url: item.leg.routeUrl, label: routeLinkLabel(item.leg.routeUrl) };
  const url = drivingRouteUrl(doc, item);
  return url === null ? null : { url, label: GOOGLE_ROUTE_LABEL };
}

export type ItemRouteFields = {
  /** `null` — usuwa link; brak pola — zostawia. */
  url?: string | null;
  distanceKm?: number;
  durationMin?: number;
  ascentM?: number;
  descentM?: number;
  /** Linia z pliku GPX. */
  geojson?: NonNullable<Track['geojson']>;
  /** Nazwa z pliku GPX: tylko dla nowego śladu, istniejący zachowuje swoją. */
  name?: string | null;
};

export type ItemRouteEdit = { doc: Doc; item: Item; track: Track; trackCreated: boolean };

/** Górna granica czasu zostaje tylko, gdy nadal jest powyżej nowego czasu. */
const keepMax = (max: number | undefined, min: number) => (max !== undefined && max >= min ? { durationMaxMin: max } : {});

/** Liczby, które punkt ma sam (formularz pokazuje je jako aktualne) — nie liczby całego wspólnego śladu. */
function itemNumbers(item: Item) {
  const distanceKm = item.leg?.distanceKm ?? item.activity?.distanceKm;
  const durationMin = item.durationMin ?? item.leg?.durationMin;
  const ascentM = item.activity?.ascentM;
  return {
    ...(distanceKm !== undefined ? { distanceKm } : {}),
    ...(durationMin !== undefined ? { durationMin } : {}),
    ...(ascentM !== undefined ? { ascentM } : {}),
  };
}

/**
 * Ślad bywa wspólny dla kilku punktów (wyjście i zejście tą samą drogą). Nowy link albo nowa linia to
 * wtedy inna trasa tego punktu: dostaje własny ślad, bez linii i liczb starego, a pozostałe punkty
 * zostają przy starym. Same liczby (np. inny czas zejścia) zapisują się tylko w punkcie.
 */
export function setItemRoute(doc: Doc, itemRef: string, newTrackRef: string, fields: ItemRouteFields): ItemRouteEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const current = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);
  const shared = current !== undefined && doc.items.some((each) => each.ref !== itemRef && each.activity?.trackRef === current.ref);
  const otherRoute = fields.geojson !== undefined || (fields.url !== undefined && (fields.url ?? undefined) !== current?.url);
  const forked = shared && otherRoute;

  const { url: _url, ...rest } = forked || current === undefined ? { ref: newTrackRef, name: fields.name || item.title, url: undefined, ...(forked ? itemNumbers(item) : {}) } : current;
  const url = fields.url === undefined ? (forked ? undefined : _url) : (fields.url ?? undefined);
  const track = (
    shared && !otherRoute
      ? current
      : {
          ...rest,
          ...(url !== undefined ? { url } : {}),
          ...(fields.distanceKm !== undefined ? { distanceKm: fields.distanceKm } : {}),
          ...(fields.ascentM !== undefined ? { ascentM: fields.ascentM } : {}),
          ...(fields.descentM !== undefined ? { descentM: fields.descentM } : {}),
          ...(fields.durationMin !== undefined ? { durationMin: fields.durationMin } : {}),
          ...(fields.geojson !== undefined ? { geojson: fields.geojson } : {}),
        }
  ) as Track;

  // Zejścia, trudności i oznakowania starej trasy formularz nie pokazuje, więc przy innej trasie nie mogą zostać po cichu.
  const { descentM: _descent, difficulty: _difficulty, waymarking: _waymarking, ...activity } = item.activity ?? {};
  let next: Item = {
    ...item,
    activity: {
      ...(forked ? activity : item.activity),
      trackRef: track.ref,
      ...(fields.distanceKm !== undefined && item.leg === undefined ? { distanceKm: fields.distanceKm } : {}),
      ...(fields.ascentM !== undefined ? { ascentM: fields.ascentM } : {}),
      ...(fields.descentM !== undefined ? { descentM: fields.descentM } : {}),
    },
  };

  const minutes = fields.durationMin;
  if (minutes !== undefined && (item.leg === undefined || item.durationMin !== undefined)) {
    const { durationMaxMin, ...others } = next;
    next = { ...others, durationMin: minutes, ...keepMax(durationMaxMin, minutes) };
  }
  if (next.leg !== undefined && (minutes !== undefined || fields.distanceKm !== undefined)) {
    // Czas i dystans są już z podanej trasy, nie z OpenRouteService: linia ORS znika, a „Przelicz przejazdy” omija punkt (`user_locked`).
    // `routed: false` odróżnia je od szacunku (`legLabel`).
    const { routed: _routed, geometry: _geometry, durationMaxMin, ...leg } = next.leg;
    const duration = minutes ?? leg.durationMin;
    next = {
      ...next,
      leg: {
        ...leg,
        routed: false,
        ...(fields.distanceKm !== undefined ? { distanceKm: fields.distanceKm } : {}),
        ...(minutes !== undefined ? { durationMin: minutes } : {}),
        ...(duration !== undefined ? keepMax(durationMaxMin, duration) : durationMaxMin !== undefined ? { durationMaxMin } : {}),
      },
    };
  }

  return {
    doc: {
      ...doc,
      tracks: forked || current === undefined ? [...doc.tracks, track] : doc.tracks.map((each) => (each.ref === track.ref ? track : each)),
      items: doc.items.map((each) => (each.ref === item.ref ? next : each)),
    },
    item: next,
    track,
    trackCreated: forked || current === undefined,
  };
}
