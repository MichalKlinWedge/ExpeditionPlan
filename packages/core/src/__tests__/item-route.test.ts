import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { drivingRouteUrl, footRouteUrl, isFootRouteItem, legRouteLink, routeLinkLabel, setItemRoute } from '../item-route.ts';
import { legLabel } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const URL_A = 'https://mapy.com/s/abcdef';

/** Plan z przejściem pieszym po ORS: linia i czas z routingu, żeby było co nadpisać. */
function withWalk() {
  const doc = fixture('barcelona');
  const walk = doc.items.find((item) => item.dayRef !== undefined && item.leg !== undefined && item.planStatus === 'scheduled')!;
  const leg = { ...walk.leg!, mode: 'walk' as const, durationMin: 10, durationMaxMin: 15, distanceKm: 0.8, routed: true, geometry: 'abc' };
  const { durationMin: _min, durationMaxMin: _max, ...rest } = walk;
  const item = { ...rest, leg };
  return { doc: TripDocument.parse({ ...doc, items: doc.items.map((each) => (each.ref === walk.ref ? item : each)) }), ref: walk.ref, dayRef: walk.dayRef! };
}

describe('link do trasy pieszej na mapy.com', () => {
  const places = [
    { ref: 'a', name: 'Start', lat: 50.8277, lng: 15.5228, provider: 'user' as const, links: [] },
    { ref: 'b', name: 'Szczyt', lat: 50.8476, lng: 15.4927, provider: 'user' as const, links: [] },
    { ref: 'c', name: 'Bez współrzędnych', provider: 'unknown' as const, links: [] },
  ];
  const tracks: unknown[] = [];
  const doc = { places, tracks, items: [], days: [] } as unknown as TripDocument;
  const item = (mode: string, leg: object = { fromPlaceRef: 'a', toPlaceRef: 'b' }, extra: object = {}) => ({ kind: 'transport', variantRefs: [], leg: { mode, links: [], ...leg }, ...extra }) as unknown as TripDocument['items'][number];

  it('z końców, w trybie turystycznym albo spacerowym', () => {
    expect(footRouteUrl(doc, item('hike'))).toBe('https://mapy.com/fnc/v1/route?mapset=outdoor&start=15.5228,50.8277&end=15.4927,50.8476&routeType=foot_hiking');
    expect(footRouteUrl(doc, item('walk'))).toContain('routeType=foot_fast');
    expect(legRouteLink(doc, item('hike'))?.label).toBe('Trasa na mapy.com');
  });

  it('auto, koniec bez współrzędnych i ten sam punkt nie mają linku', () => {
    expect(footRouteUrl(doc, item('car'))).toBeNull();
    expect(footRouteUrl(doc, item('hike', { fromPlaceRef: 'a', toPlaceRef: 'c' }))).toBeNull();
    expect(footRouteUrl(doc, item('hike', { fromPlaceRef: 'a', toPlaceRef: 'a' }))).toBeNull();
  });

  it('aktywność bez śladu ma tylko miejsce, a nie trasę od sąsiadów', () => {
    expect(footRouteUrl(doc, { kind: 'activity', variantRefs: [], placeRef: 'a' } as unknown as TripDocument['items'][number])).toBeNull();
  });

  // Prosty ślad na wschód: 0,01° długości na tej szerokości to ok. 700 m.
  const line = (points: number) => ({ type: 'LineString', coordinates: Array.from({ length: points }, (_, index) => [15 + index * 0.01, 50]) });
  const withTrack = (geojson: object, url?: string) => {
    const trackDoc = { ...doc, tracks: [{ ref: 't', name: 'Ślad', geojson, ...(url ? { url } : {}) }] } as unknown as TripDocument;
    return { trackDoc, walk: { kind: 'activity', variantRefs: [], activity: { trackRef: 't' } } as unknown as TripDocument['items'][number] };
  };

  it('ślad idzie swoim przebiegiem, co najwyżej przez 15 punktów pośrednich', () => {
    const short = withTrack(line(2));
    const shortUrl = footRouteUrl(short.trackDoc, short.walk)!;
    expect(shortUrl).toContain('start=15,50&end=15.01,50');
    expect(shortUrl).toContain('&waypoints=');
    expect(shortUrl.split('waypoints=')[1]!.split(';')).toHaveLength(1);
    const long = withTrack(line(200));
    expect(footRouteUrl(long.trackDoc, long.walk)!.split('waypoints=')[1]!.split(';')).toHaveLength(15);
  });

  it('rzadka linia po uproszczeniu nie powtarza punktów pośrednich', () => {
    const sparse = withTrack({ type: 'LineString', coordinates: [[15, 50], [15.1, 50]] });
    const via = footRouteUrl(sparse.trackDoc, sparse.walk)!.split('waypoints=')[1]!.split(';');
    expect(via.length).toBeGreaterThan(10);
    expect(new Set(via).size).toBe(via.length);
    expect(via).not.toContain('15.1,50');
  });

  it('pętla ze śladem ma link, bo prowadzą ją punkty pośrednie', () => {
    const loop = withTrack({ type: 'LineString', coordinates: [[15, 50], [15.02, 50], [15, 50]] });
    expect(footRouteUrl(loop.trackDoc, loop.walk)).toContain('waypoints=');
  });

  it('link zapisany w śladzie ma pierwszeństwo: bez drugiego linku', () => {
    const saved = withTrack(line(3), URL_A);
    expect(legRouteLink(saved.trackDoc, saved.walk)).toBeNull();
  });
});

describe('link do trasy autem', () => {
  const places = [
    { ref: 'a', name: 'Start', lat: 42.5, lng: 41.87, provider: 'user' as const, links: [] },
    { ref: 'b', name: 'Mestia, plac', provider: 'unknown' as const, links: [] },
  ];
  const doc = { places } as unknown as TripDocument;
  const item = (mode: string, extra: object = {}) => ({ kind: 'transport', leg: { mode, fromPlaceRef: 'a', toPlaceRef: 'b', links: [] }, ...extra }) as unknown as TripDocument['items'][number];

  it('współrzędne startu, cel bez nich po nazwie, tryb jazdy autem', () => {
    expect(drivingRouteUrl(doc, item('rental_car'))).toBe('https://www.google.com/maps/dir/?api=1&origin=42.5%2C41.87&destination=Mestia%2C%20plac&travelmode=driving');
  });

  it('bez miejsca startu sam cel, a cel może być miejscem punktu', () => {
    const noOrigin = { kind: 'transport', placeRef: 'a', leg: { mode: 'car', links: [] } } as unknown as TripDocument['items'][number];
    expect(drivingRouteUrl(doc, noOrigin)).toBe('https://www.google.com/maps/dir/?api=1&destination=42.5%2C41.87&travelmode=driving');
  });

  it('własny link wygrywa z liczonym, także przy pociągu', () => {
    const own = (mode: string, routeUrl: string) => item(mode, { leg: { mode, fromPlaceRef: 'a', toPlaceRef: 'b', links: [], routeUrl } });
    expect(legRouteLink(doc, own('car', 'https://maps.app.goo.gl/AbC'))).toEqual({ url: 'https://maps.app.goo.gl/AbC', label: 'Trasa w Mapach Google' });
    expect(legRouteLink(doc, own('train', 'https://example.com/trasa'))).toEqual({ url: 'https://example.com/trasa', label: 'Trasa na mapie' });
    expect(legRouteLink(doc, item('car'))?.label).toBe('Trasa w Mapach Google');
    expect(legRouteLink(doc, item('train'))).toBeNull();
  });

  it('nie dla innych środków transportu ani bez celu', () => {
    expect(drivingRouteUrl(doc, item('train'))).toBeNull();
    expect(drivingRouteUrl(doc, item('hike'))).toBeNull();
    expect(drivingRouteUrl(doc, { kind: 'transport', leg: { mode: 'car', links: [] } } as unknown as TripDocument['items'][number])).toBeNull();
  });
});

describe('trasa piesza punktu', () => {
  it('przejście pieszo: czas i dystans z mapy w przejściu, linia ORS znika, silnik liczy nowy czas', () => {
    const { doc, ref, dayRef } = withWalk();
    const edit = setItemRoute(doc, ref, 'id-nowy', { url: URL_A, distanceKm: 2.4, durationMin: 35, ascentM: 40 })!;
    expect(edit.trackCreated).toBe(true);
    expect(edit.track).toMatchObject({ ref: 'id-nowy', url: URL_A, distanceKm: 2.4, durationMin: 35, ascentM: 40 });
    expect(edit.item.activity).toMatchObject({ trackRef: 'id-nowy', ascentM: 40 });
    expect(edit.item.leg).toMatchObject({ mode: 'walk', durationMin: 35, distanceKm: 2.4 });
    expect(edit.item.leg?.routed).toBe(false);
    expect(legLabel(edit.item)).toBe('ok. 35 min, ok. 2,4 km (z podanej trasy)');
    expect(edit.item.leg?.geometry).toBeUndefined();
    // Górna granica 15 min jest już poniżej nowego czasu.
    expect(edit.item.leg?.durationMaxMin).toBeUndefined();
    const parsed = TripDocument.parse(edit.doc);
    const span = (document: TripDocument) => {
      const entry = scheduleDay(document, dayRef).items.find((each) => each.ref === ref)!;
      return Math.round((entry.end - entry.start) / 60_000);
    };
    expect(span(doc)).toBe(10);
    expect(span(parsed)).toBe(35);
  });

  it('aktywność: czas w punkcie, górna granica zostaje, gdy nadal wyższa; istniejący ślad bez duplikatu i z zachowaną linią', () => {
    const doc = fixture('dinara');
    const item = doc.items.find((each) => each.activity?.trackRef === 'trasa-dinara-ferrata')!;
    const before = doc.tracks.length;
    const longer = setItemRoute(TripDocument.parse({ ...doc, items: doc.items.map((each) => (each.ref === item.ref ? { ...item, durationMin: 500, durationMaxMin: 600 } : each)) }), item.ref, 'id-x', { durationMin: 540 })!;
    expect(longer.trackCreated).toBe(false);
    expect(longer.doc.tracks).toHaveLength(before);
    expect(longer.item).toMatchObject({ durationMin: 540, durationMaxMin: 600 });
    // Link z planu użytkownika zostaje, gdy formularz go nie zmienia.
    expect(longer.track.url).toBe('https://mapy.com/s/pemapunanu');
    expect(TripDocument.safeParse(longer.doc).success).toBe(true);
  });

  it('link: null usuwa, sam link nie rusza czasu ani linii przejazdu', () => {
    const { doc, ref } = withWalk();
    const linked = setItemRoute(doc, ref, 'id-nowy', { url: URL_A })!;
    expect(linked.item.leg).toMatchObject({ durationMin: 10, durationMaxMin: 15, routed: true, geometry: 'abc' });
    const removed = setItemRoute(linked.doc, ref, 'id-inny', { url: null })!;
    expect(removed.track.ref).toBe('id-nowy');
    expect(removed.track.url).toBeUndefined();
    expect(setItemRoute(doc, 'nie-ma', 'id-x', {})).toBeNull();
  });

  it('plik GPX: linia i liczby nadpisują wpisane, link zostaje, nazwa pliku tylko dla nowego śladu', () => {
    const { doc, ref, dayRef } = withWalk();
    const geojson = { type: 'LineString' as const, coordinates: [[16.5, 50.2, 700], [16.6, 50.3, 820]] as [number, number, number][] };
    const typed = setItemRoute(doc, ref, 'id-nowy', { url: URL_A, distanceKm: 2, durationMin: 45 })!;
    const fromFile = setItemRoute(typed.doc, ref, 'id-inny', { geojson, name: 'Z pliku', distanceKm: 3.1, durationMin: 70, ascentM: 120, descentM: 15 })!;
    expect(fromFile.trackCreated).toBe(false);
    expect(fromFile.track).toMatchObject({ ref: 'id-nowy', url: URL_A, geojson, distanceKm: 3.1, durationMin: 70, ascentM: 120, descentM: 15 });
    expect(fromFile.track.name).toBe(typed.track.name);
    expect(fromFile.item.activity).toMatchObject({ ascentM: 120, descentM: 15 });
    expect(fromFile.item.leg).toMatchObject({ durationMin: 70, distanceKm: 3.1, routed: false });
    const parsed = TripDocument.parse(fromFile.doc);
    const entry = scheduleDay(parsed, dayRef).items.find((each) => each.ref === ref)!;
    expect(Math.round((entry.end - entry.start) / 60_000)).toBe(70);
    expect(setItemRoute(doc, ref, 'id-nowy', { geojson, name: 'Z pliku' })!.track.name).toBe('Z pliku');
    expect(setItemRoute(doc, ref, 'id-nowy', { geojson, name: null })!.track.name).toBe(doc.items.find((item) => item.ref === ref)!.title);
  });

  describe('ślad wspólny dla kilku punktów (Jagodna: wyjście, zejście, wariant skrócony)', () => {
    const doc = fixture('chatka');
    const shared = doc.tracks.find((track) => track.ref === 'trasa-jagodna')!;
    const unchanged = (edit: { doc: TripDocument }) => {
      expect(edit.doc.tracks.find((track) => track.ref === shared.ref)).toEqual(shared);
      expect(edit.doc.items.find((item) => item.ref === 'jagodna-wejscie')).toEqual(doc.items.find((item) => item.ref === 'jagodna-wejscie'));
    };

    it('nowy link: własny ślad z liczbami punktu, bez linii i liczb całego starego śladu', () => {
      const edit = setItemRoute(doc, 'jagodna-zejscie', 'id-zejscie', { url: URL_A, ascentM: 40 })!;
      expect(edit.trackCreated).toBe(true);
      expect(edit.doc.tracks).toHaveLength(doc.tracks.length + 1);
      expect(edit.track).toEqual({ ref: 'id-zejscie', name: 'Zejście tą samą drogą', url: URL_A, distanceKm: 4.2, durationMin: 75, ascentM: 40 });
      expect(edit.item.activity).toEqual({ trackRef: 'id-zejscie', distanceKm: 4.2, ascentM: 40 });
      unchanged(edit);
      expect(TripDocument.safeParse(edit.doc).success).toBe(true);
    });

    it('plik GPX: własny ślad z linią i nazwą z pliku', () => {
      const geojson = { type: 'LineString' as const, coordinates: [[16.5, 50.2, 700], [16.6, 50.3, 820]] as [number, number, number][] };
      const edit = setItemRoute(doc, 'jagodna-zejscie', 'id-zejscie', { geojson, name: 'Zejście przez Wójtowice', distanceKm: 5.1, durationMin: 95 })!;
      expect(edit.trackCreated).toBe(true);
      expect(edit.track).toMatchObject({ ref: 'id-zejscie', name: 'Zejście przez Wójtowice', geojson, distanceKm: 5.1, durationMin: 95 });
      expect(edit.track.url).toBeUndefined();
      unchanged(edit);
    });

    it('usunięcie linku odpina tylko ten punkt', () => {
      const linked = TripDocument.parse({ ...doc, tracks: doc.tracks.map((track) => (track.ref === shared.ref ? { ...track, url: URL_A } : track)) });
      const edit = setItemRoute(linked, 'jagodna-zejscie', 'id-zejscie', { url: null })!;
      expect(edit.track.url).toBeUndefined();
      expect(edit.doc.tracks.find((track) => track.ref === shared.ref)?.url).toBe(URL_A);
    });

    it('same liczby albo ten sam link: tylko punkt, bez nowego śladu', () => {
      const edit = setItemRoute(doc, 'jagodna-zejscie', 'id-zejscie', { durationMin: 60, distanceKm: 4 })!;
      expect(edit.trackCreated).toBe(false);
      expect(edit.track).toEqual(shared);
      expect(edit.item).toMatchObject({ durationMin: 60, activity: { trackRef: shared.ref, distanceKm: 4 } });
      unchanged(edit);
      const linked = TripDocument.parse({ ...doc, tracks: doc.tracks.map((track) => (track.ref === shared.ref ? { ...track, url: URL_A } : track)) });
      expect(setItemRoute(linked, 'jagodna-zejscie', 'id-zejscie', { url: URL_A })!.trackCreated).toBe(false);
    });
  });

  it('rozpoznaje punkty piesze i linki', () => {
    const { doc, ref } = withWalk();
    expect(isFootRouteItem(doc.items.find((item) => item.ref === ref)!)).toBe(true);
    expect(routeLinkLabel(URL_A)).toBe('Trasa na mapy.com');
    expect(routeLinkLabel('https://en.mapy.cz/s/abc')).toBe('Trasa na mapy.com');
    expect(routeLinkLabel('https://fakemapy.com/s/abc')).toBe('Trasa na mapie');
    expect(routeLinkLabel('https://www.komoot.com/tour/1')).toBe('Trasa na mapie');
  });
});
