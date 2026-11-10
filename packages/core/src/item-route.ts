import type { LatLng } from './coordinates.ts';
import { distanceM, type LngLat } from './polyline.ts';
import { isTransitItem } from './item-kind.ts';
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
const TRANSIT_ROUTE_LABEL = 'Trasa komunikacją w Mapach Google';

/** Serwis map, do którego prowadzi link trasy (ikona przy punkcie planu); `null` = inny. */
export function routeLinkSite(url: string): 'mapy' | 'google' | null {
  if (/(^|\/\/|\.)mapy\.(com|cz)(\/|$)/i.test(url)) return 'mapy';
  return /\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|maps\.)?google\.[a-z.]+\/maps)/i.test(url) || /\/\/maps\.google\./i.test(url) ? 'google' : null;
}

/** Etykieta linku do trasy po adresie. */
export function routeLinkLabel(url: string): string {
  const site = routeLinkSite(url);
  return site === 'mapy' ? MAPY_ROUTE_LABEL : site === 'google' ? GOOGLE_ROUTE_LABEL : 'Trasa na mapie';
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
  // „Jedź przez” z edytora przejazdu: udokumentowany parametr Maps URLs, punkty rozdzielone „|”.
  const waypoints = (leg.via ?? []).length === 0 ? '' : `&waypoints=${encodeURIComponent(leg.via!.map((point) => `${point.lat},${point.lng}`).join('|'))}`;
  return `https://www.google.com/maps/dir/?api=1${origin === undefined ? '' : `&origin=${encodeURIComponent(origin)}`}&destination=${encodeURIComponent(destination)}${waypoints}&travelmode=driving`;
}

/**
 * Skąd i dokąd jedzie punkt `transport`. Z `leg` (szkice AI je podają), a bez niego z sąsiadów
 * w dniu: skąd = miejsce poprzedniego punktu (na początku dnia baza), dokąd = miejsce następnego.
 * Miejsce samego przejazdu bywa i startem („Wyjazd z parkingu”), i celem („Przejazd do
 * Szybenika”), więc służy tylko wtedy, gdy po przejeździe nie ma już punktu z miejscem.
 * Sąsiedzi z tego samego wariantu — punkt wersji B nie jedzie z punktu wersji A.
 * Koniec wskazany w `leg`, ale bez współrzędnych, zostaje pusty: zgadnięty z sąsiadów dałby trasę
 * z innego miejsca niż to, które widać w „skąd” (start w domu, a 5 km od bazy dnia).
 */
export function legEnds(doc: Doc, item: Item): { from?: LatLng; to?: LatLng } {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const at = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : places.get(ref);
    return place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;
  };
  let from = at(item.leg?.fromPlaceRef);
  let to = at(item.leg?.toPlaceRef);
  const guessFrom = item.leg?.fromPlaceRef === undefined;
  const guessTo = item.leg?.toPlaceRef === undefined;
  if ((guessFrom || guessTo) && item.dayRef !== undefined) {
    const fits = (each: Item) => each.variantRefs.length === 0 || each.variantRefs.some((ref) => item.variantRefs.includes(ref));
    const day = doc.items
      .filter((each) => each.dayRef === item.dayRef && each.parentRef === undefined && (each.ref === item.ref || fits(each)))
      .sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
    const index = day.findIndex((each) => each.ref === item.ref);
    const arrival = (each: Item) => at(each.leg?.toPlaceRef ?? each.placeRef);
    if (guessFrom) {
      const previous = day.slice(0, index).reverse().find((each) => arrival(each) !== undefined);
      const base = doc.days.find((each) => each.ref === item.dayRef)?.baseRef;
      from = previous === undefined ? at(base) : arrival(previous);
    }
    if (guessTo) {
      const next = day.slice(index + 1).find((each) => at(each.leg?.fromPlaceRef ?? each.placeRef) !== undefined);
      to = next === undefined ? at(item.placeRef) : at(next.leg?.fromPlaceRef ?? next.placeRef);
    }
  }
  return { from, to };
}

/**
 * Link do trasy komunikacją w Mapach Google. Końce z `leg`, a bez nich z sąsiednich punktów dnia
 * (`legEnds`), bo przejazd metrem rzadko ma wpisane „skąd”. Mapy pokazują trasę na teraz: adres nie
 * przyjmuje godziny odjazdu. `null` = nie komunikacja albo brak celu.
 */
export function transitRouteUrl(doc: Doc, item: Item): string | null {
  const leg = item.leg;
  if (!isTransitItem(item) || leg === undefined) return null;
  const named = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : doc.places.find((each) => each.ref === ref);
    if (place === undefined) return undefined;
    return place.lat !== undefined && place.lng !== undefined ? `${place.lat},${place.lng}` : (place.address ?? place.searchName ?? place.name);
  };
  const ends = legEnds(doc, item);
  const at = (point: { lat: number; lng: number } | undefined) => (point === undefined ? undefined : `${point.lat},${point.lng}`);
  const destination = named(leg.toPlaceRef) ?? at(ends.to) ?? named(item.placeRef);
  if (destination === undefined) return null;
  const origin = named(leg.fromPlaceRef) ?? at(ends.from);
  if (origin === destination) return null;
  return `https://www.google.com/maps/dir/?api=1${origin === undefined ? '' : `&origin=${encodeURIComponent(origin)}`}&destination=${encodeURIComponent(destination)}&travelmode=transit`;
}

const MAPY_ROUTE_LABEL = 'Trasa na mapy.com';
/** Limit adresu mapy.com i gęstość punktów: krótki spacer nie potrzebuje piętnastu. */
const MAPY_MAX_WAYPOINTS = 15;
const WAYPOINT_EVERY_M = 500;

const mapyPoint = (point: LngLat) => `${Math.round(point[0] * 1e5) / 1e5},${Math.round(point[1] * 1e5) / 1e5}`;

/** Punkty pośrednie równo po długości śladu, także w środku długiego odcinka uproszczonej linii: mapy.com odtwarza przez nie przebieg. */
function waypointsAlong(line: readonly LngLat[]): LngLat[] {
  const lengths = [0];
  for (let i = 1; i < line.length; i += 1) lengths.push(lengths[i - 1]! + distanceM(line[i - 1]!, line[i]!));
  const total = lengths.at(-1)!;
  const count = Math.min(MAPY_MAX_WAYPOINTS, Math.floor(total / WAYPOINT_EVERY_M));
  return Array.from({ length: count }, (_, index) => {
    const wanted = (total * (index + 1)) / (count + 1);
    const after = lengths.findIndex((length) => length >= wanted);
    const a = line[after - 1]!;
    const b = line[after]!;
    const share = (wanted - lengths[after - 1]!) / (lengths[after]! - lengths[after - 1]!);
    return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share];
  });
}

/**
 * Link do trasy pieszej na mapy.com: udokumentowany adres `fnc/v1/route`, bez klucza. Sam link, trasa liczy
 * się dopiero po otwarciu i nic z niej nie zapisujemy (`docs/USLUGI.md` §5). Punkt ze śladem idzie przebiegiem
 * śladu, a przejście bez śladu od startu do końca. Aktywność bez śladu nie ma trasy, tylko miejsce. `null` = brak końców.
 */
export function footRouteUrl(doc: Doc, item: Item): string | null {
  if (!isFootRouteItem(item)) return null;
  const line = doc.tracks.find((track) => track.ref === item.activity?.trackRef)?.geojson?.coordinates.map((point): LngLat => [point[0]!, point[1]!]);
  let start: LngLat | undefined;
  let end: LngLat | undefined;
  let waypoints: LngLat[] = [];
  if (line !== undefined && line.length >= 2) {
    start = line[0];
    end = line.at(-1);
    waypoints = waypointsAlong(line);
  } else if (item.leg !== undefined) {
    const { from, to } = legEnds(doc, item);
    start = from && [from.lng, from.lat];
    end = to && [to.lng, to.lat];
  }
  if (start === undefined || end === undefined) return null;
  if (waypoints.length === 0 && mapyPoint(start) === mapyPoint(end)) return null;
  const via = waypoints.length === 0 ? '' : `&waypoints=${waypoints.map(mapyPoint).join(';')}`;
  return `https://mapy.com/fnc/v1/route?mapset=outdoor&start=${mapyPoint(start)}&end=${mapyPoint(end)}&routeType=${item.leg?.mode === 'walk' ? 'foot_fast' : 'foot_hiking'}${via}`;
}

/** Link do trasy punktu: własny, a bez niego liczony z końców (autem i komunikacją Mapy Google, pieszo mapy.com). Link zapisany w śladzie ma własne miejsce. */
export function legRouteLink(doc: Doc, item: Item): { url: string; label: string } | null {
  if (item.kind === 'transport' && item.leg?.routeUrl !== undefined) return { url: item.leg.routeUrl, label: routeLinkLabel(item.leg.routeUrl) };
  const driving = drivingRouteUrl(doc, item);
  if (driving !== null) return { url: driving, label: GOOGLE_ROUTE_LABEL };
  const transit = transitRouteUrl(doc, item);
  if (transit !== null) return { url: transit, label: TRANSIT_ROUTE_LABEL };
  if (!isFootRouteItem(item) || doc.tracks.find((track) => track.ref === item.activity?.trackRef)?.url !== undefined) return null;
  const foot = footRouteUrl(doc, item);
  return foot === null ? null : { url: foot, label: MAPY_ROUTE_LABEL };
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
