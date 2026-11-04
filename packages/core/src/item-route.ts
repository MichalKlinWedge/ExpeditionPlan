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

/** Etykieta linku do trasy po adresie. */
export function routeLinkLabel(url: string): string {
  return /(^|\/\/|\.)mapy\.(com|cz)(\/|$)/i.test(url) ? 'Trasa na mapy.com' : 'Trasa na mapie';
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

export function setItemRoute(doc: Doc, itemRef: string, newTrackRef: string, fields: ItemRouteFields): ItemRouteEdit | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const current = item.activity?.trackRef === undefined ? undefined : doc.tracks.find((each) => each.ref === item.activity!.trackRef);

  const { url: _url, ...rest } = current ?? { ref: newTrackRef, name: fields.name || item.title, url: undefined };
  const url = fields.url === undefined ? _url : (fields.url ?? undefined);
  const track = {
    ...rest,
    ...(url !== undefined ? { url } : {}),
    ...(fields.distanceKm !== undefined ? { distanceKm: fields.distanceKm } : {}),
    ...(fields.ascentM !== undefined ? { ascentM: fields.ascentM } : {}),
    ...(fields.descentM !== undefined ? { descentM: fields.descentM } : {}),
    ...(fields.durationMin !== undefined ? { durationMin: fields.durationMin } : {}),
    ...(fields.geojson !== undefined ? { geojson: fields.geojson } : {}),
  } as Track;

  let next: Item = {
    ...item,
    activity: {
      ...item.activity,
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
      tracks: current === undefined ? [...doc.tracks, track] : doc.tracks.map((each) => (each.ref === track.ref ? track : each)),
      items: doc.items.map((each) => (each.ref === item.ref ? next : each)),
    },
    item: next,
    track,
    trackCreated: current === undefined,
  };
}
