import { distanceM, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Start i koniec przejścia z pliku GPX, żeby nie wskazywać ich ręcznie. Mapy.com nazywa eksport
 * „Trasa z A do B”, więc najpierw liczy się ta nazwa, potem miejsce tuż obok końca śladu. Koniec już
 * ustawiony zostaje, a gdy leży daleko od śladu, użytkownik dostaje ostrzeżenie.
 */

type Doc = TripDocument;
type Place = Doc['places'][number];

/** Ta sama nazwa, a dalej niż tyle: inne miejsce o tej samej nazwie. */
const SAME_NAME_M = 1500;
/** Plik bez rozpoznanej nazwy końca: miejsce tak blisko to ten koniec. */
const NEAR_M = 150;
/** Nazwa z pliku nie pasuje do niczego: inne miejsce musi leżeć praktycznie w tym samym punkcie, żeby ją zastąpić. */
const NEAR_NAMED_M = 60;
/** Ustawiony koniec dalej niż tyle od śladu: ostrzeżenie. */
const FAR_M = 500;

const normal = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Nazwy równe albo jedna zawiera drugą: „Muzeum Picassa w Barcelonie” i „Muzeum Picassa”. */
function sameName(place: Place, typed: string): boolean {
  const wanted = normal(typed);
  return [place.name, place.searchName].some((name) => {
    if (name === undefined) return false;
    const have = normal(name);
    return have === wanted || (Math.min(have.length, wanted.length) >= 4 && (have.includes(wanted) || wanted.includes(have)));
  });
}

/**
 * Nazwy końców z nazwy pliku: „Trasa z A do B”, „Route from A to B”. Nazwa miejsca sama może mieć „do”
 * („Droga do Lasu”), więc wygrywa podział, którego części są znanymi miejscami (dokładna nazwa liczy się mocniej), a przy remisie pierwszy.
 */
export function routeNameEnds(name: string | null | undefined, places: readonly Place[] = []): { from?: string; to?: string } {
  const body = /^\s*(?:trasa|route)\s+(?:ze?|from)\s+(.+?)\s*$/iu.exec(name ?? '')?.[1];
  if (body === undefined) return {};
  const known = (typed: string) => (places.some((place) => normal(place.name) === normal(typed)) ? 2 : places.some((place) => sameName(place, typed)) ? 1 : 0);
  let best: { from: string; to: string; score: number } | undefined;
  for (const separator of body.matchAll(/\s(?:do|to)\s/giu)) {
    const from = body.slice(0, separator.index).trim();
    const to = body.slice(separator.index + separator[0].length).trim();
    if (from === '' || to === '') continue;
    const score = known(from) + known(to);
    if (best === undefined || score > best.score) best = { from, to, score };
  }
  return best === undefined ? {} : { from: best.from, to: best.to };
}

const at = (place: Place): LngLat | undefined => (place.lat !== undefined && place.lng !== undefined ? [place.lng, place.lat] : undefined);
/** 6 miejsc po przecinku ≈ 10 cm. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

type Found = { place: Place; created: boolean; pinned: boolean };

/** Miejsce końca śladu: po nazwie blisko, tuż obok, po nazwie bez współrzędnych (dostaje je ze śladu), a na końcu nowe z nazwą z pliku. */
function endPlace(places: readonly Place[], point: LngLat, typed: string | undefined, newRef: string): Found | undefined {
  const placed = places.flatMap((place) => {
    const where = at(place);
    return where === undefined ? [] : [{ place, distance: distanceM(where, point) }];
  });
  placed.sort((a, b) => a.distance - b.distance);
  const named = typed === undefined ? undefined : placed.find(({ place, distance }) => distance <= SAME_NAME_M && sameName(place, typed));
  if (named !== undefined) return { place: named.place, created: false, pinned: false };
  const nearest = placed[0];
  if (nearest !== undefined && nearest.distance <= (typed === undefined ? NEAR_M : NEAR_NAMED_M)) return { place: nearest.place, created: false, pinned: false };
  if (typed === undefined) return undefined;
  const coords = { lat: round(point[1]), lng: round(point[0]) };
  const unpinned = places.find((place) => at(place) === undefined && normal(place.name) === normal(typed));
  if (unpinned !== undefined) return { place: { ...unpinned, ...coords, provider: 'user' }, created: false, pinned: true };
  return { place: { ref: newRef, name: typed, ...coords, provider: 'user', links: [] }, created: true, pinned: false };
}

export type TrackEndsEdit = {
  doc: Doc;
  /** Miejsca do zapisania: nowe albo z dopisanymi współrzędnymi. */
  places: { place: Place; created: boolean }[];
  /** Ustawione tym wgraniem. */
  from?: { name: string; created: boolean };
  to?: { name: string; created: boolean };
  /** Koniec bez miejsca: ani nazwy w pliku, ani miejsca obok. */
  missing: ('from' | 'to')[];
  /** Końce ustawione wcześniej, a leżące daleko od śladu. */
  far: { end: 'from' | 'to'; name: string; km: number }[];
};

/** `null` = punkt bez odcinka (`leg`): nie ma skąd i dokąd. Linia ma co najmniej dwa punkty. */
export function setTrackEnds(doc: Doc, itemRef: string, ids: { fromId: string; toId: string }, track: { name: string | null; coordinates: readonly (readonly number[])[] }): TrackEndsEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item?.leg === undefined || track.coordinates.length < 2) return null;
  const point = (raw: readonly number[]): LngLat => [raw[0]!, raw[1]!];
  const ends = { from: point(track.coordinates[0]!), to: point(track.coordinates.at(-1)!) };
  const typed = routeNameEnds(track.name, doc.places);

  let places: Place[] = [...doc.places];
  const changed = new Map<string, { place: Place; created: boolean }>();
  const missing: TrackEndsEdit['missing'] = [];
  const far: TrackEndsEdit['far'] = [];
  const settled: Partial<Record<'from' | 'to', { ref: string; name: string; created: boolean }>> = {};
  const current = { from: item.leg.fromPlaceRef, to: item.leg.toPlaceRef ?? item.placeRef };

  for (const end of ['from', 'to'] as const) {
    const ref = current[end];
    if (ref !== undefined) {
      const place = places.find((each) => each.ref === ref);
      const where = place === undefined ? undefined : at(place);
      if (place !== undefined && where !== undefined && distanceM(where, ends[end]) > FAR_M) far.push({ end, name: place.name, km: Math.round(distanceM(where, ends[end]) / 100) / 10 });
      continue;
    }
    const found = endPlace(places, ends[end], typed[end], `id-${end === 'from' ? ids.fromId : ids.toId}`);
    if (found === undefined) {
      missing.push(end);
      continue;
    }
    if (found.created) places = [...places, found.place];
    if (found.pinned) places = places.map((each) => (each.ref === found.place.ref ? found.place : each));
    if (found.created || found.pinned) changed.set(found.place.ref, { place: found.place, created: found.created || changed.get(found.place.ref)?.created === true });
    settled[end] = { ref: found.place.ref, name: found.place.name, created: found.created };
  }

  const toRef = settled.to?.ref;
  const next = {
    ...item,
    leg: { ...item.leg, ...(settled.from !== undefined ? { fromPlaceRef: settled.from.ref } : {}), ...(toRef !== undefined ? { toPlaceRef: toRef } : {}) },
    ...(toRef !== undefined ? { placeRef: toRef } : {}),
  };
  return {
    doc: { ...doc, places, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) },
    places: [...changed.values()],
    ...(settled.from !== undefined ? { from: { name: settled.from.name, created: settled.from.created } } : {}),
    ...(settled.to !== undefined ? { to: { name: settled.to.name, created: settled.to.created } } : {}),
    missing,
    far,
  };
}

const END_LABEL = { from: 'początku', to: 'końca' } as const;

/** Co wgranie zrobiło z końcami, do komunikatu po zapisie. Pusty tekst, gdy nic nie trzeba mówić. */
export function trackEndsNote(edit: TrackEndsEdit): string {
  const set = (label: string, end: { name: string; created: boolean } | undefined) => (end === undefined ? [] : [`${label}: ${end.name}${end.created ? ' (nowe miejsce)' : ''}.`]);
  return [
    ...set('Start', edit.from),
    ...set('Koniec', edit.to),
    ...edit.far.map((each) => `Uwaga: „${each.name}” leży ${each.km.toLocaleString('pl-PL')} km od ${END_LABEL[each.end]} śladu.`),
    ...edit.missing.map((end) => `Nie rozpoznano ${END_LABEL[end]} śladu: wskaż „${end === 'from' ? 'Skąd' : 'Dokąd'}” w nagłówku punktu.`),
  ].join(' ');
}
