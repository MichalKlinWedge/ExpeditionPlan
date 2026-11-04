import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { isFootRouteItem, routeLinkLabel, setItemRoute } from '../item-route.ts';
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

describe('trasa piesza punktu', () => {
  it('przejście pieszo: czas i dystans z mapy w przejściu, linia ORS znika, silnik liczy nowy czas', () => {
    const { doc, ref, dayRef } = withWalk();
    const edit = setItemRoute(doc, ref, 'id-nowy', { url: URL_A, distanceKm: 2.4, durationMin: 35, ascentM: 40 })!;
    expect(edit.trackCreated).toBe(true);
    expect(edit.track).toMatchObject({ ref: 'id-nowy', url: URL_A, distanceKm: 2.4, durationMin: 35, ascentM: 40 });
    expect(edit.item.activity).toMatchObject({ trackRef: 'id-nowy', ascentM: 40 });
    expect(edit.item.leg).toMatchObject({ mode: 'walk', durationMin: 35, distanceKm: 2.4 });
    expect(edit.item.leg?.routed).toBe(false);
    expect(legLabel(edit.item)).toBe('ok. 35 min, ok. 2,4 km (wpisane z mapy)');
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

  it('rozpoznaje punkty piesze i linki', () => {
    const { doc, ref } = withWalk();
    expect(isFootRouteItem(doc.items.find((item) => item.ref === ref)!)).toBe(true);
    expect(routeLinkLabel(URL_A)).toBe('Trasa na mapy.com');
    expect(routeLinkLabel('https://en.mapy.cz/s/abc')).toBe('Trasa na mapy.com');
    expect(routeLinkLabel('https://fakemapy.com/s/abc')).toBe('Trasa na mapie');
    expect(routeLinkLabel('https://www.komoot.com/tour/1')).toBe('Trasa na mapie');
  });
});
