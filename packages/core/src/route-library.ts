import { isFootRouteItem, legEnds } from './item-route.ts';
import { pluralForm } from './format.ts';
import { type DayMap, formatMinutes, type MapPin } from './plan-info.ts';
import { decodePolyline, distanceM, encodePolyline, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { routeNameEnds, setTrackEnds, type TrackEndsEdit } from './track-ends.ts';

/**
 * „Trasy” wyjazdu: ślady piesze (GPX, link z mapy) i trasy autem (przebieg z OpenRouteService, „Jedź przez”,
 * własny link) jako elementy `tracks`, niezależne od punktów planu. Punkt wskazuje trasę (`activity.trackRef`
 * pieszo, `leg.trackRef` autem), więc usunięcie punktu jej nie kasuje, a jedną trasę można podpiąć do kilku
 * punktów albo zamienić na inny wariant tej samej drogi (te same końce).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Track = Doc['tracks'][number];
type Leg = NonNullable<Item['leg']>;
type RouteEnd = NonNullable<NonNullable<Track['route']>['from']>;

export type RouteKind = 'foot' | 'car';

export const ROUTE_KIND: Record<RouteKind, string> = { foot: 'pieszo', car: 'autem' };
export const ROUTE_ICON: Record<RouteKind, string> = { foot: '🥾', car: '🚗' };

const CAR = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);
/** Końce bliżej niż tyle: ta sama trasa, inny wariant przebiegu. */
const SAME_END_M = 1000;

/** Środek trasy; ślad bez `route` (GPX, link z mapy) to trasa piesza. */
export const routeKind = (track: Pick<Track, 'route'>): RouteKind => track.route?.mode ?? 'foot';

/** Trasa, którą punkt ma podpiętą. */
export const itemRouteRef = (item: Item): string | undefined => item.leg?.trackRef ?? item.activity?.trackRef;

/** Jaką trasę można podpiąć do punktu: autem do przejazdu autem (też taksówką), pieszo do aktywności i przejścia. */
export function routeKindFor(item: Item): RouteKind | undefined {
  if (item.kind === 'transport' && item.leg !== undefined && CAR.has(item.leg.mode)) return 'car';
  return isFootRouteItem(item) ? 'foot' : undefined;
}

/** Linia trasy ([lng, lat]). */
export function routeLine(track: Pick<Track, 'geojson'>): LngLat[] | undefined {
  const line = track.geojson?.coordinates.map((point): LngLat => [point[0]!, point[1]!]);
  return line !== undefined && line.length >= 2 ? line : undefined;
}

/** Początek i koniec trasy: zapisane końce, a bez nich końce linii. */
export function routeEnds(track: Pick<Track, 'route' | 'geojson'>): { from?: LngLat; to?: LngLat } {
  const line = routeLine(track);
  const at = (end: RouteEnd | undefined, fallback: LngLat | undefined): LngLat | undefined => (end === undefined ? fallback : [end.lng, end.lat]);
  return { from: at(track.route?.from, line?.[0]), to: at(track.route?.to, line?.at(-1)) };
}

const dayOrder = (doc: Doc) => new Map(doc.days.map((day, index) => [day.ref, index]));
const planOrder = (order: Map<string, number>) => (a: Item, b: Item) =>
  (order.get(a.dayRef ?? '') ?? Number.MAX_SAFE_INTEGER) - (order.get(b.dayRef ?? '') ?? Number.MAX_SAFE_INTEGER) || (a.sortKey ?? '').localeCompare(b.sortKey ?? '');

/** Punkty, do których trasa jest podpięta, w kolejności planu (pula na końcu). */
export function routeUsers(doc: Doc, trackRef: string): Item[] {
  return doc.items.filter((item) => itemRouteRef(item) === trackRef).sort(planOrder(dayOrder(doc)));
}

const close = (a: LngLat | undefined, b: LngLat | undefined) => a !== undefined && b !== undefined && distanceM(a, b) <= SAME_END_M;

/** Ta sama droga: ten sam środek, start i koniec blisko siebie. */
export function sameRoute(a: Pick<Track, 'route' | 'geojson'>, b: Pick<Track, 'route' | 'geojson'>): boolean {
  if (routeKind(a) !== routeKind(b)) return false;
  const one = routeEnds(a);
  const other = routeEnds(b);
  return close(one.from, other.from) && close(one.to, other.to);
}

export type RouteGroup = { kind: RouteKind; from?: string; to?: string; tracks: Track[] };

/**
 * Trasy pogrupowane w warianty tej samej drogi (`sameRoute`). Grupy w kolejności pierwszego użycia w planie,
 * nieużywane na końcu; w grupie najpierw podpięte.
 */
export function routeGroups(doc: Doc): RouteGroup[] {
  const order = dayOrder(doc);
  const sorted = [...doc.items].sort(planOrder(order));
  const firstUse = new Map<string, number>();
  sorted.forEach((item, index) => {
    const ref = itemRouteRef(item);
    if (ref !== undefined && !firstUse.has(ref)) firstUse.set(ref, index);
  });
  const rank = (track: Track) => firstUse.get(track.ref) ?? Number.MAX_SAFE_INTEGER;
  const groups: RouteGroup[] = [];
  for (const track of [...doc.tracks].sort((a, b) => rank(a) - rank(b))) {
    const group = groups.find((each) => sameRoute(each.tracks[0]!, track));
    if (group !== undefined) group.tracks.push(track);
    else groups.push({ kind: routeKind(track), tracks: [track] });
  }
  return groups.map((group) => {
    const named = group.tracks.find((track) => track.route?.from !== undefined || track.route?.to !== undefined)?.route;
    return { ...group, ...(named?.from ? { from: named.from.name } : {}), ...(named?.to ? { to: named.to.name } : {}) };
  });
}

export type RouteChoice = { track: Track; variant: boolean };

/**
 * Trasy do podpięcia przy punkcie: tego samego środka, bez obecnej; najpierw warianty tej samej drogi
 * (końce trasy przy „skąd” i „dokąd” punktu), potem reszta po nazwie.
 */
export function routeChoices(doc: Doc, item: Item): RouteChoice[] {
  const kind = routeKindFor(item);
  if (kind === undefined) return [];
  const current = itemRouteRef(item);
  const own = current === undefined ? undefined : doc.tracks.find((track) => track.ref === current);
  const ends = item.leg === undefined ? {} : legEnds(doc, item);
  const from = own === undefined ? (ends.from && ([ends.from.lng, ends.from.lat] as LngLat)) : routeEnds(own).from;
  const to = own === undefined ? (ends.to && ([ends.to.lng, ends.to.lat] as LngLat)) : routeEnds(own).to;
  return doc.tracks
    .filter((track) => track.ref !== current && routeKind(track) === kind)
    .map((track) => {
      const there = routeEnds(track);
      return { track, variant: close(from, there.from) && close(to, there.to) };
    })
    .sort((a, b) => Number(b.variant) - Number(a.variant) || a.track.name.localeCompare(b.track.name, 'pl'));
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function placeEnd(doc: Doc, ref: string | undefined): RouteEnd | undefined {
  const place = ref === undefined ? undefined : doc.places.find((each) => each.ref === ref);
  return place?.lat === undefined || place.lng === undefined ? undefined : { name: place.name, lat: place.lat, lng: place.lng };
}

export type CarRouteEdit = { doc: Doc; track: Track; created: boolean };

/**
 * Przebieg przejazdu autem jako trasa w „Trasach”: linia, „Jedź przez”, własny link, km i czas, końce z miejsc.
 * Trasa podpięta tylko do tego punktu się aktualizuje, wspólna z innymi zostaje, a punkt dostaje nową.
 * `null` = nie przejazd autem albo nic do zapisania (bez linii, punktów pośrednich i linku).
 */
export function carRouteFromItem(doc: Doc, itemRef: string, newRef: string): CarRouteEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined || routeKindFor(item) !== 'car') return null;
  const leg = item.leg!;
  const line = leg.geometry === undefined ? [] : decodePolyline(leg.geometry);
  if (line.length < 2 && (leg.via ?? []).length === 0 && leg.routeUrl === undefined) return null;
  const from = placeEnd(doc, leg.fromPlaceRef);
  const to = placeEnd(doc, leg.toPlaceRef ?? item.placeRef);
  const current = leg.trackRef === undefined ? undefined : doc.tracks.find((track) => track.ref === leg.trackRef);
  const shared = current !== undefined && doc.items.some((each) => each.ref !== itemRef && itemRouteRef(each) === current.ref);
  const reuse = current !== undefined && !shared && routeKind(current) === 'car';
  const fields = {
    ...(leg.distanceKm !== undefined ? { distanceKm: leg.distanceKm } : {}),
    ...(leg.durationMin !== undefined ? { durationMin: leg.durationMin } : {}),
    ...(leg.routeUrl !== undefined ? { url: leg.routeUrl } : {}),
    route: { mode: 'car' as const, ...(from ? { from } : {}), ...(to ? { to } : {}), ...((leg.via ?? []).length > 0 ? { via: leg.via } : {}) },
    ...(line.length >= 2 ? { geojson: { type: 'LineString' as const, coordinates: line.map((point) => [round(point[0]), round(point[1])]) } } : {}),
  };
  const track: Track = reuse
    ? { ref: current.ref, name: current.name, ...fields }
    : { ref: newRef, name: from !== undefined && to !== undefined ? `${from.name} → ${to.name}` : item.title, ...fields };
  const next: Item = { ...item, leg: { ...leg, trackRef: track.ref } };
  return {
    doc: {
      ...doc,
      tracks: reuse ? doc.tracks.map((each) => (each.ref === track.ref ? track : each)) : [...doc.tracks, track],
      items: doc.items.map((each) => (each.ref === itemRef ? next : each)),
    },
    track,
    created: !reuse,
  };
}

export type RouteAttach = { doc: Doc; item: Item; ends: TrackEndsEdit | null };

/** Górna granica czasu zostaje tylko, gdy nadal jest powyżej nowego czasu. */
const keepMax = (max: number | undefined, min: number) => (max !== undefined && max >= min ? { durationMaxMin: max } : {});

/**
 * Podpięcie trasy z „Tras” do punktu (zamiast obecnej, która zostaje w „Trasach”). Pieszo: punkt wskazuje ślad
 * i bierze jego km, czas i podejście. Autem: przejazd kopiuje linię, „Jedź przez”, link, km i czas. Brakujące
 * „skąd/dokąd” bierze z końców trasy (miejsce o tej nazwie albo obok, inaczej nowe — `setTrackEnds`).
 * Tekst = powód odmowy.
 */
export function attachRoute(doc: Doc, itemRef: string, trackRef: string, ids: { fromId: string; toId: string }): RouteAttach | string {
  const found = doc.items.find((each) => each.ref === itemRef);
  const track = doc.tracks.find((each) => each.ref === trackRef);
  if (found === undefined) return 'Tego punktu już nie ma — odśwież stronę.';
  if (track === undefined) return 'Tej trasy już nie ma — odśwież stronę.';
  const kind = routeKindFor(found);
  if (kind === undefined) return 'Do tego punktu nie da się podpiąć trasy: to nie przejazd autem, przejście ani aktywność.';
  if (kind !== routeKind(track)) return kind === 'car' ? 'To trasa piesza, a punkt jedzie autem.' : 'To trasa autem, a punkt idzie pieszo.';

  const line = routeLine(track);
  const named = track.route?.from !== undefined && track.route.to !== undefined ? `Trasa z ${track.route.from.name} do ${track.route.to.name}` : track.name;
  const ends = line === undefined ? null : setTrackEnds(doc, itemRef, ids, { name: named, coordinates: line });
  const base = ends?.doc ?? doc;
  const item = base.items.find((each) => each.ref === itemRef)!;
  let next: Item;
  if (kind === 'car') {
    const { trackRef: _ref, via: _via, routeUrl: _url, geometry: _geometry, routed: _routed, durationMaxMin, ...rest } = item.leg!;
    const duration = track.durationMin ?? rest.durationMin;
    const leg: Leg = {
      ...rest,
      trackRef: track.ref,
      ...(track.route?.via !== undefined ? { via: track.route.via } : {}),
      ...(track.url !== undefined ? { routeUrl: track.url } : {}),
      ...(line !== undefined ? { geometry: encodePolyline(line), routed: true } : {}),
      ...(track.distanceKm !== undefined ? { distanceKm: track.distanceKm } : {}),
      ...(track.durationMin !== undefined ? { durationMin: track.durationMin } : {}),
      ...(duration !== undefined ? keepMax(durationMaxMin, duration) : {}),
    };
    // Własny czas punktu (ma pierwszeństwo przed czasem przejazdu) też bierze się z trasy.
    next = { ...item, leg, ...(item.durationMin !== undefined && track.durationMin !== undefined ? { durationMin: track.durationMin } : {}) };
  } else {
    const { descentM: _descent, difficulty: _difficulty, waymarking: _waymarking, ...activity } = item.activity ?? {};
    next = {
      ...item,
      activity: {
        ...activity,
        trackRef: track.ref,
        ...(track.distanceKm !== undefined && item.leg === undefined ? { distanceKm: track.distanceKm } : {}),
        ...(track.ascentM !== undefined ? { ascentM: track.ascentM } : {}),
        ...(track.descentM !== undefined ? { descentM: track.descentM } : {}),
        ...(track.difficulty !== undefined ? { difficulty: track.difficulty } : {}),
        ...(track.waymarking !== undefined ? { waymarking: track.waymarking } : {}),
      },
    };
    const minutes = track.durationMin;
    if (minutes !== undefined && (item.leg === undefined || item.durationMin !== undefined)) {
      const { durationMaxMin, ...others } = next;
      next = { ...others, durationMin: minutes, ...keepMax(durationMaxMin, minutes) };
    }
    if (next.leg !== undefined) {
      // Czas i dystans są z trasy, nie z OpenRouteService (jak `setItemRoute`).
      const { routed: _routed, geometry: _geometry, durationMaxMin, ...leg } = next.leg;
      const duration = minutes ?? leg.durationMin;
      next = {
        ...next,
        leg: {
          ...leg,
          routed: false,
          ...(track.distanceKm !== undefined ? { distanceKm: track.distanceKm } : {}),
          ...(minutes !== undefined ? { durationMin: minutes } : {}),
          ...(duration !== undefined ? keepMax(durationMaxMin, duration) : durationMaxMin !== undefined ? { durationMaxMin } : {}),
        },
      };
    }
  }
  return { doc: { ...base, items: base.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next, ends };
}

/**
 * Odpięcie trasy od punktu: trasa zostaje w „Trasach”. Przejazd autem zachowuje skopiowany przebieg,
 * punkt pieszy — swoje km i czas (bez linii na mapie). `null` = punkt bez trasy.
 */
export function detachRoute(doc: Doc, itemRef: string): { doc: Doc; item: Item } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined || itemRouteRef(item) === undefined) return null;
  let next = item;
  if (next.leg?.trackRef !== undefined) {
    const { trackRef: _ref, ...leg } = next.leg;
    next = { ...next, leg };
  }
  if (next.activity?.trackRef !== undefined) {
    const { trackRef: _ref, ...activity } = next.activity;
    next = { ...next, activity };
  }
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next };
}

/** Usunięcie trasy z „Tras”: tylko nieużywanej. Tekst = powód odmowy. */
export function removeRoute(doc: Doc, trackRef: string): Doc | string {
  if (!doc.tracks.some((track) => track.ref === trackRef)) return 'Tej trasy już nie ma — odśwież stronę.';
  const users = routeUsers(doc, trackRef);
  if (users.length > 0) return `Trasa jest podpięta do: ${users.map((item) => `„${item.title}”`).join(', ')}. Najpierw ją odepnij.`;
  return { ...doc, tracks: doc.tracks.filter((track) => track.ref !== trackRef) };
}

/** Liczby trasy w jednej linii: km, czas, podejście, punkty „Jedź przez”. */
export function routeFacts(track: Track): string {
  const via = track.route?.via?.length ?? 0;
  return [
    track.distanceKm !== undefined ? `${track.distanceKm.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} km` : null,
    track.durationMin !== undefined ? `ok. ${formatMinutes(track.durationMin)}` : null,
    track.ascentM !== undefined ? `↑ ${track.ascentM} m` : null,
    via > 0 ? `przez ${via} ${pluralForm(via, ['punkt', 'punkty', 'punktów'])}` : null,
  ]
    .filter((each) => each !== null)
    .join(' · ');
}

export type NewRouteInput = {
  kind: RouteKind;
  name: string;
  url?: string;
  distanceKm?: number;
  durationMin?: number;
  ascentM?: number;
  descentM?: number;
  /** Linia z pliku GPX (`trackFromGpx`). */
  geojson?: NonNullable<Track['geojson']>;
  /** Miejsca wyjazdu ze współrzędnymi: początek i koniec trasy. */
  fromRef?: string;
  toRef?: string;
};

/**
 * Trasa dodana ręcznie w „Trasach”, bez punktu planu: nazwa, środek, link, liczby, plik GPX i końce. Końce z miejsc
 * wyjazdu, a bez nich z nazwy pliku „Trasa z A do B” i końców jego linii — po nich trasa trafia do wariantów tej
 * samej drogi. Tekst = powód odmowy.
 */
export function newRoute(doc: Doc, ref: string, input: NewRouteInput): { doc: Doc; track: Track } | string {
  const name = input.name.trim();
  if (name === '') return 'Trasa musi mieć nazwę.';
  const line = input.geojson === undefined ? undefined : routeLine(input);
  const typed = routeNameEnds(name, doc.places);
  const end = (placeRef: string | undefined, typedName: string | undefined, point: LngLat | undefined): RouteEnd | undefined => {
    const place = placeEnd(doc, placeRef);
    if (place !== undefined) return place;
    return typedName !== undefined && point !== undefined ? { name: typedName, lat: round(point[1]), lng: round(point[0]) } : undefined;
  };
  const from = end(input.fromRef, typed.from, line?.[0]);
  const to = end(input.toRef, typed.to, line?.at(-1));
  if (line === undefined && input.url === undefined && (from === undefined || to === undefined)) return 'Podaj plik GPX, link do trasy albo skąd i dokąd.';
  const track: Track = {
    ref,
    name,
    ...(input.distanceKm !== undefined ? { distanceKm: input.distanceKm } : {}),
    ...(input.ascentM !== undefined && input.kind === 'foot' ? { ascentM: input.ascentM } : {}),
    ...(input.descentM !== undefined && input.kind === 'foot' ? { descentM: input.descentM } : {}),
    ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    route: { mode: input.kind, ...(from ? { from } : {}), ...(to ? { to } : {}) },
    ...(input.geojson !== undefined ? { geojson: input.geojson } : {}),
  };
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, track };
}

/** Pola edycji trasy: wartość zmienia, `null` czyści, brak pola zostawia. */
export type RouteEditFields = {
  name?: string;
  url?: string | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  ascentM?: number | null;
  descentM?: number | null;
  difficulty?: string | null;
  waymarking?: string | null;
  routeNotes?: string | null;
  /** Nowa linia z pliku GPX albo `null` = bez linii. */
  geojson?: NonNullable<Track['geojson']> | null;
  /** Miejsce wyjazdu ze współrzędnymi; `null` = bez końca. */
  fromRef?: string | null;
  toRef?: string | null;
};

export type RouteEditResult = { doc: Doc; track: Track; items: Item[]; places: { place: Doc['places'][number]; created: boolean }[] };

/**
 * Edycja trasy w „Trasach”. Z `updateUsers` podpięte punkty biorą od nowa jej przebieg i liczby (`attachRoute`), tak
 * jak po podpięciu — inaczej zostaje w nich kopia sprzed zmiany (ślad pieszy i tak rysuje się z trasy).
 * `ids` daje klucze nowych miejsc końców. Tekst = powód odmowy.
 */
export function editRoute(doc: Doc, trackRef: string, fields: RouteEditFields, options: { updateUsers: boolean; ids: () => { fromId: string; toId: string } }): RouteEditResult | string {
  const current = doc.tracks.find((track) => track.ref === trackRef);
  if (current === undefined) return 'Tej trasy już nie ma — odśwież stronę.';
  const name = fields.name === undefined ? current.name : fields.name.trim();
  if (name === '') return 'Trasa musi mieć nazwę.';
  const kind = routeKind(current);
  const apply = <K extends keyof Track>(track: Track, key: K, value: Track[K] | null | undefined): Track => {
    if (value === undefined) return track;
    const { [key]: _old, ...rest } = track;
    return (value === null || value === '' ? rest : { ...rest, [key]: value }) as Track;
  };
  let track: Track = { ...current, name };
  track = apply(track, 'url', fields.url);
  track = apply(track, 'distanceKm', fields.distanceKm);
  track = apply(track, 'durationMin', fields.durationMin);
  track = apply(track, 'ascentM', kind === 'foot' ? fields.ascentM : fields.ascentM === undefined ? undefined : null);
  track = apply(track, 'descentM', kind === 'foot' ? fields.descentM : fields.descentM === undefined ? undefined : null);
  track = apply(track, 'difficulty', fields.difficulty?.trim() ?? fields.difficulty);
  track = apply(track, 'waymarking', fields.waymarking?.trim() ?? fields.waymarking);
  track = apply(track, 'routeNotes', fields.routeNotes?.trim() ?? fields.routeNotes);
  if (fields.geojson !== undefined) {
    // Nowa linia albo jej brak: woda i schroniska dotyczyły starej.
    const { pois: _pois, ...rest } = apply(track, 'geojson', fields.geojson);
    track = rest;
  }
  const end = (value: string | null | undefined, old: RouteEnd | undefined) => (value === undefined ? old : value === null ? undefined : (placeEnd(doc, value) ?? old));
  const from = end(fields.fromRef, current.route?.from);
  const to = end(fields.toRef, current.route?.to);
  const { from: _from, to: _to, ...route } = current.route ?? { mode: kind };
  track = { ...track, route: { ...route, ...(from ? { from } : {}), ...(to ? { to } : {}) } };
  if (routeLine(track) === undefined && track.url === undefined && (track.route?.from === undefined || track.route.to === undefined)) {
    return 'Trasa musi mieć linię z pliku GPX, link albo skąd i dokąd.';
  }

  let next: Doc = { ...doc, tracks: doc.tracks.map((each) => (each.ref === trackRef ? track : each)) };
  const items: Item[] = [];
  const places = new Map<string, { place: Doc['places'][number]; created: boolean }>();
  if (options.updateUsers) {
    for (const user of routeUsers(next, trackRef)) {
      const attached = attachRoute(next, user.ref, trackRef, options.ids());
      if (typeof attached === 'string') continue;
      next = attached.doc;
      items.push(attached.item);
      for (const each of attached.ends?.places ?? []) places.set(each.place.ref, { place: each.place, created: each.created || places.get(each.place.ref)?.created === true });
    }
  }
  return { doc: next, track, items: items.map((item) => next.items.find((each) => each.ref === item.ref)!), places: [...places.values()] };
}

/** Mapa jednej trasy: linia i pinezki początku i końca (bez numerów punktów planu). */
export function routeMap(track: Track): DayMap {
  const line = routeLine(track);
  const ends = routeEnds(track);
  const pin = (key: string, name: string | undefined, point: LngLat | undefined): MapPin[] => (point === undefined ? [] : [{ placeRef: key, name: name ?? (key === 'trasa-start' ? 'Start' : 'Koniec'), lat: point[1], lng: point[0], stops: [] }]);
  const same = ends.from !== undefined && ends.to !== undefined && distanceM(ends.from, ends.to) < 30;
  return {
    pins: [...pin('trasa-start', track.route?.from?.name, ends.from), ...(same ? [] : pin('trasa-koniec', track.route?.to?.name, ends.to))],
    lines: line === undefined ? [] : [{ coordinates: line, routed: true, ...(routeKind(track) === 'foot' ? { track: true as const } : {}) }],
    numbers: {},
  };
}
