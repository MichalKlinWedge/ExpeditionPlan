import { describe, expect, it } from 'vitest';

import {
  addExtraToPlan,
  applyExtraPicks,
  attractionType,
  corridorQueryLines,
  corridorTowns,
  dayCorridor,
  dayExtras,
  detourMinutes,
  extraCandidates,
  extraTimeText,
  itemExtras,
  setExtraDismissed,
  wikipediaUrl,
} from '../day-extras.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { encodePolyline, type LngLat } from '../polyline.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import type { OsmFeature } from '../track-pois.ts';

/** A — rynek, 7 km na wschód B — jezioro; przejazd autem A → B; w puli punkt tuż przy drodze. */
const doc = TripDocument.parse({
  schemaVersion: 1,
  trip: { title: 'Test', startDate: '2026-07-01', endDate: '2026-07-01', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
  places: [
    { ref: 'a', name: 'Rynek', lat: 50, lng: 20 },
    { ref: 'b', name: 'Jezioro', lat: 50, lng: 20.1 },
    { ref: 'p', name: 'Kapliczka na wzgórzu', lat: 50.001, lng: 20.05 },
  ],
  days: [{ ref: 'd1', date: '2026-07-01', tz: 'Europe/Warsaw' }],
  items: [
    { ref: 'rynek', dayRef: 'd1', sortKey: '10', kind: 'visit', title: 'Rynek', placeRef: 'a', durationMin: 60, time: { precision: 'exact', start: '09:00' } },
    { ref: 'jazda', dayRef: 'd1', sortKey: '20', kind: 'transport', title: 'Do jeziora', leg: { mode: 'car', fromPlaceRef: 'a', toPlaceRef: 'b', durationMin: 20 } },
    { ref: 'jezioro', dayRef: 'd1', sortKey: '30', kind: 'visit', title: 'Jezioro', placeRef: 'b', durationMin: 120 },
    { ref: 'kapliczka', kind: 'visit', title: 'Kapliczka na wzgórzu', placeRef: 'p', planStatus: 'candidate', durationMin: 15 },
  ],
});

const refs = scheduleDay(doc, 'd1').items.map((item) => item.ref);
const corridor = dayCorridor(doc, refs);

/** Dzień dojazdu z domu: 600 km autem po drogach (przez Brno), na miejscu spacer. */
const lerp = (a: LngLat, b: LngLat, n: number) => Array.from({ length: n }, (_, i): LngLat => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const road: LngLat[] = [...lerp([17.03, 51.1], [16.6, 49.2], 30), ...lerp([16.6, 49.2], [17.63, 47.68], 30), [17.63, 47.68]];
const drive = (mode: 'car' | 'bus') =>
  TripDocument.parse({
    schemaVersion: 1,
    trip: { title: 'Dojazd', startDate: '2027-03-25', endDate: '2027-03-25', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN' },
    places: [
      { ref: 'dom', name: 'Wrocław', lat: road[0]![1], lng: road[0]![0] },
      { ref: 'gyor', name: 'Győr', lat: road.at(-1)![1], lng: road.at(-1)![0] },
    ],
    days: [{ ref: 'd1', date: '2027-03-25', tz: 'Europe/Warsaw' }],
    items: [
      { ref: 'jazda', dayRef: 'd1', sortKey: '10', kind: 'transport', title: 'Przejazd', leg: { mode, fromPlaceRef: 'dom', toPlaceRef: 'gyor', durationMin: 344, distanceKm: 600, geometry: encodePolyline(road) } },
      { ref: 'spacer', dayRef: 'd1', sortKey: '20', kind: 'visit', title: 'Starówka', placeRef: 'gyor', durationMin: 90 },
    ],
  });

const features: OsmFeature[] = [
  { id: 'node/1', lat: 50.005, lng: 20.06, tags: { name: 'Zamek Wysoki', historic: 'castle', wikidata: 'Q1', wikipedia: 'pl:Zamek Wysoki' } },
  { id: 'node/2', lat: 50.002, lng: 20, tags: { name: 'Wieża widokowa', tourism: 'viewpoint' } },
  { id: 'node/3', lat: 50.1, lng: 20.5, tags: { name: 'Daleki zamek', historic: 'castle' } },
  // Miejsce, które plan już ma (pod nazwą z OSM).
  { id: 'way/4', lat: 50.0001, lng: 20.0001, tags: { name: 'Rynek Główny', tourism: 'attraction' } },
  { id: 'node/5', lat: 50.0005, lng: 20.03, tags: { amenity: 'bench' } },
];

describe('po drodze i w pobliżu', () => {
  it('korytarz: miejsca punktów i przejazd autem; zapytanie ma osobne pasy', () => {
    expect(corridor.spots.map((spot) => spot.ref)).toEqual(expect.arrayContaining(['rynek']));
    expect(corridor.paths).toEqual([expect.objectContaining({ mode: 'car', ref: 'jazda' })]);
    const lines = corridorQueryLines(corridor);
    expect(lines.car).toHaveLength(1);
    expect(lines.near.length).toBeGreaterThan(0);
  });

  it('kandydaci: pula pierwsza, bez dalekich, bez miejsc planu i bez nie-atrakcji; objazd z odległości', () => {
    const list = extraCandidates(doc, corridor, features);
    expect(list.map((each) => each.id)).toEqual(['pool:kapliczka', 'node/1', 'node/2']);
    const castle = list.find((each) => each.id === 'node/1')!;
    expect(castle).toMatchObject({ along: 'car', nearRef: 'jazda', type: 'zamek', wikipedia: 'https://pl.wikipedia.org/wiki/Zamek_Wysoki' });
    expect(castle.offM).toBeGreaterThan(500);
    expect(castle.detourMin).toBe(detourMinutes('car', castle.offM));
    const tower = list.find((each) => each.id === 'node/2')!;
    expect(tower).toMatchObject({ along: 'at', nearRef: 'rynek' });
    expect(tower.detourMin).toBe(Math.round((2 * tower.offM * 1.3) / 75));
    expect(extraCandidates(doc, corridor, features, new Set(['node/1'])).some((each) => each.id === 'node/1')).toBe(false);
  });

  it('wybór AI: „po drodze” tylko tuż przy trasie, zamiennik tylko z dnia, odrzucone zostają', () => {
    const candidates = extraCandidates(doc, corridor, features);
    const day = applyExtraPicks(doc, 'd1', candidates, [
      { id: 'node/1', title: 'Zamek Wysoki', why: 'Ruiny zamku nad drogą.', stayMin: 45, fit: 'pass', swapRef: 'nie-ma' },
      { id: 'node/2', title: 'Wieża', type: 'wieża widokowa', why: '', stayMin: 20, fit: 'stop', swapRef: 'jezioro', weather: 'outdoor' },
      { id: 'node/999', title: 'Wymyślone', why: 'x', stayMin: 10, fit: 'visit' },
    ], '2026-06-01')!;
    expect(day.extras!.items.map((each) => each.id)).toEqual(['node/1', 'node/2']);
    const [castle, tower] = day.extras!.items;
    expect(castle).toMatchObject({ fit: 'stop', stayMin: 45 });
    expect(castle!.swapRef).toBeUndefined();
    expect(tower).toMatchObject({ swapRef: 'jezioro', nearRef: 'rynek' });
    expect(extraTimeText(tower!)).toMatch(/^\+.* \(dojście .*, na miejscu 20 min\)$/);

    const withDay = { ...doc, days: [day] };
    expect(TripDocument.safeParse(withDay).success).toBe(true);
    const marks = itemExtras(withDay, 'd1');
    expect(marks.get('rynek')?.near.map((each) => each.id)).toEqual(['node/2']);
    expect(marks.get('jezioro')?.swaps.map((each) => each.id)).toEqual(['node/2']);

    const dismissed = setExtraDismissed(withDay, 'd1', 'node/2', true)!;
    expect(dayExtras(dismissed.doc, 'd1').dismissed.map((each) => each.id)).toEqual(['node/2']);
    // Nowe szukanie nie zastępuje odrzuconej.
    const again = applyExtraPicks(dismissed.doc, 'd1', candidates, [{ id: 'node/2', title: 'Wieża', why: '', stayMin: 20, fit: 'stop' }], '2026-06-02')!;
    expect(again.extras!.items).toEqual([expect.objectContaining({ id: 'node/2', status: 'dismissed' })]);
  });

  it('do planu: przy drodze przejazdu = postój w trasie; z puli — punkt przechodzi do dnia', () => {
    const candidates = extraCandidates(doc, corridor, features);
    const day = applyExtraPicks(doc, 'd1', candidates, [
      { id: 'node/1', title: 'Zamek Wysoki', why: 'Ruiny.', stayMin: 30, fit: 'stop' },
      { id: 'pool:kapliczka', title: 'Kapliczka', why: 'Z puli.', stayMin: 15, fit: 'stop' },
    ], '2026-06-01')!;
    const withDay = { ...doc, days: [day] };
    const castle = addExtraToPlan(withDay, 'd1', 'node/1', { itemId: '00000000-0000-7000-8000-000000000001', placeId: '00000000-0000-7000-8000-000000000002' })!;
    expect(castle.created).toMatchObject({ title: 'Zamek Wysoki', dayRef: 'd1', parentRef: 'jazda', durationMin: 30, planStatus: 'scheduled' });
    expect(castle.places?.[0]?.place).toMatchObject({ name: 'Zamek Wysoki', provider: 'osm' });
    expect(castle.others).toEqual([{ collection: 'days', element: expect.objectContaining({ ref: 'd1' }) }]);
    expect(TripDocument.safeParse(castle.doc).success).toBe(true);
    // Postój wydłuża przejazd.
    const drive = (edited: typeof doc) => scheduleDay(edited, 'd1').items.find((each) => each.ref === 'jazda')!;
    expect(drive(castle.doc).end - drive(withDay).end).toBe(30 * 60_000);
    expect(dayExtras(castle.doc, 'd1').open.map((each) => each.id)).toEqual(['pool:kapliczka']);

    const pooled = addExtraToPlan(withDay, 'd1', 'pool:kapliczka', { itemId: 'x', placeId: 'y' })!;
    expect(pooled.created).toBeUndefined();
    expect(pooled.changed.find((each) => each.ref === 'kapliczka')).toMatchObject({ dayRef: 'd1', parentRef: 'jazda' });
  });

  it('dojazd z domu własnym autem zostaje w korytarzu (długi: miasta po drodze), autobus — nie', () => {
    const car = drive('car');
    const carCorridor = dayCorridor(car, scheduleDay(car, 'd1').items.map((item) => item.ref));
    expect(carCorridor.paths.some((path) => path.mode === 'car' && path.ref === 'jazda')).toBe(true);
    const lines = corridorQueryLines(carCorridor);
    expect(lines.long).toHaveLength(1);
    expect(lines.car).toEqual([]);
    expect(lines.long[0]!.length).toBeLessThanOrEqual(250);
    const bus = drive('bus');
    expect(dayCorridor(bus, scheduleDay(bus, 'd1').items.map((item) => item.ref)).paths).toEqual([]);
  });

  it('miasto po drodze: atrakcja w nim, choć dalej niż pas przy drodze, dostaje miasto i zjazd autem', () => {
    const car = drive('car');
    const carCorridor = dayCorridor(car, scheduleDay(car, 'd1').items.map((item) => item.ref));
    // Brno ok. 6 km obok trasy, katedra w centrum.
    const features: OsmFeature[] = [
      { id: 'node/brno', lat: 49.2, lng: 16.68, tags: { place: 'city', name: 'Brno' } },
      { id: 'way/katedra', lat: 49.191, lng: 16.68, tags: { name: 'Katedrála sv. Petra a Pavla', building: 'cathedral', wikidata: 'Q1' } },
      { id: 'node/daleko', lat: 49.4, lng: 16.95, tags: { name: 'Zamek w polu', historic: 'castle' } },
    ];
    const towns = corridorTowns(carCorridor, features);
    expect(towns.map((town) => town.name)).toEqual(['Brno']);
    const candidates = extraCandidates(car, carCorridor, features, new Set(), { towns });
    const katedra = candidates.find((each) => each.id === 'way/katedra')!;
    expect(katedra).toMatchObject({ town: 'Brno', along: 'car' });
    expect(katedra.offM).toBeGreaterThan(2000);
    expect(candidates.some((each) => each.id === 'node/daleko' || each.id === 'node/brno')).toBe(false);
    // Tylko trasa przejazdu: punkty przy miejscach na miejscu odpadają.
    const spot = carCorridor.spots.find((each) => each.ref === 'spacer')!;
    const near: OsmFeature = { id: 'node/rynek', lat: spot.lat + 0.001, lng: spot.lng, tags: { name: 'Ratusz', historic: 'building', wikidata: 'Q2' } };
    expect(extraCandidates(car, carCorridor, [...features, near], new Set(), { towns, scope: 'route' }).some((each) => each.id === 'node/rynek')).toBe(false);
    expect(extraCandidates(car, carCorridor, [...features, near], new Set(), { towns, scope: 'city' }).map((each) => each.id)).toEqual(['way/katedra']);
  });

  it('szukanie zawężone dopisuje do listy, pełne — wymienia otwarte', () => {
    const at = corridor.spots[0]!;
    const one = extraCandidates(doc, corridor, [{ id: 'node/9', lat: at.lat + 0.002, lng: at.lng, tags: { name: 'Wieża', man_made: 'tower' } }]);
    const pick = (id: string) => ({ id, title: id, why: '', stayMin: 10, fit: 'stop' as const });
    const first = applyExtraPicks(doc, 'd1', one, [pick('node/9')], '2027-01-01')!;
    const withFirst = { ...doc, days: doc.days.map((each) => (each.ref === 'd1' ? first : each)) };
    const pool = extraCandidates(doc, corridor, []);
    expect(applyExtraPicks(withFirst, 'd1', pool, [pick(pool[0]!.id)], '2027-01-02', true)!.extras!.items.map((each) => each.id)).toEqual([pool[0]!.id, 'node/9']);
    expect(applyExtraPicks(withFirst, 'd1', pool, [pick(pool[0]!.id)], '2027-01-02')!.extras!.items.map((each) => each.id)).toEqual([pool[0]!.id]);
  });

  it('rodzaje i linki z tagów OSM', () => {
    expect(attractionType({ name: 'Tifoultoute', historic: 'castle', castle_type: 'kasbah' })).toEqual({ type: 'kasba', weight: 2 });
    expect(attractionType({ name: 'Meczet', amenity: 'place_of_worship', religion: 'muslim' })?.type).toBe('meczet');
    expect(attractionType({ historic: 'castle' })).toBeNull();
    expect(wikipediaUrl('en:Aït Benhaddou')).toBe('https://en.wikipedia.org/wiki/A%C3%AFt_Benhaddou');
  });
});
