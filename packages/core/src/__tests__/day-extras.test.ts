import { describe, expect, it } from 'vitest';

import {
  addExtraToPlan,
  applyExtraPicks,
  attractionType,
  corridorQueryLines,
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

  it('rodzaje i linki z tagów OSM', () => {
    expect(attractionType({ name: 'Tifoultoute', historic: 'castle', castle_type: 'kasbah' })).toEqual({ type: 'kasba', weight: 2 });
    expect(attractionType({ name: 'Meczet', amenity: 'place_of_worship', religion: 'muslim' })?.type).toBe('meczet');
    expect(attractionType({ historic: 'castle' })).toBeNull();
    expect(wikipediaUrl('en:Aït Benhaddou')).toBe('https://en.wikipedia.org/wiki/A%C3%AFt_Benhaddou');
  });
});
