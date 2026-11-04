import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { nowAndNext } from '../engine/now.ts';
import { proposeCuts, scheduleDay } from '../engine/schedule.ts';
import { dayMap, routeStopsLabel } from '../plan-info.ts';
import { moveToDay } from '../plan-edits.ts';
import { isRouteStop, routeStopTarget, setRouteStop } from '../route-stops.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { tripMemories } from '../trip-memories.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const DRIVE = 'd2-transfer';

/** Dzień Gruzji jak na zrzucie: przejazd 180 min z przerwą 20 min, potem zapora (40 min) i Hacwali (60 min). */
function mestia() {
  const base = fixture('gruzja');
  const drive = base.items.find((item) => item.dayRef === 'd2' && item.kind === 'transport')!;
  const items = base.items.map((item) => {
    if (item.ref === drive.ref) return { ...item, ref: DRIVE, durationMin: 180, stopsMin: 20, time: { precision: 'exact' as const, start: '09:00' } };
    if (item.ref === 'd2-zapora-inguri') return { ...item, durationMin: 40 };
    if (item.ref === 'd2-hacwali') return { ...item, durationMin: 60 };
    return item;
  });
  const doc = TripDocument.parse({ ...JSON.parse(JSON.stringify(base)), items: JSON.parse(JSON.stringify(items).replaceAll(`"${drive.ref}"`, `"${DRIVE}"`)) });
  const first = setRouteStop(doc, 'd2-zapora-inguri', true)!;
  const second = setRouteStop(first.doc, 'd2-hacwali', true)!;
  return { plain: doc, doc: TripDocument.parse(second.doc) };
}

const entry = (doc: TripDocument, ref: string, options = {}) => scheduleDay(doc, 'd2', options).items.find((item) => item.ref === ref)!;

describe('postoje w trasie', () => {
  it('przejazd trwa tyle, ile jazda, przerwy i postoje razem, a następny punkt idzie po tym czasie', () => {
    const { doc, plain } = mestia();
    const drive = entry(doc, DRIVE);
    expect(drive.durationMin).toBe(180 + 20 + 40 + 60);
    expect(drive.routeStopsMin).toBe(100);
    expect(drive.startLocal).toBe('09:00');
    expect(drive.endLocal).toBe('14:00');
    const plainDay = scheduleDay(plain, 'd2').items;
    const after = plainDay[plainDay.findIndex((item) => item.ref === 'd2-hacwali') + 1]!;
    const nextEntry = entry(doc, after.ref);
    expect(nextEntry.start).toBeGreaterThanOrEqual(drive.end);
  });

  it('postoje idą zaraz po przejeździe, w jego ramach, bez nakładania się, oznaczone jako szacunek położenia', () => {
    const { doc } = mestia();
    const day = scheduleDay(doc, 'd2').items;
    const at = day.findIndex((item) => item.ref === DRIVE);
    expect(day.slice(at, at + 3).map((item) => item.ref)).toEqual([DRIVE, 'd2-zapora-inguri', 'd2-hacwali']);
    const [drive, dam, cable] = day.slice(at, at + 3);
    expect(dam!.routeStop).toBe(true);
    expect(dam!.durationMin).toBe(40);
    expect(cable!.durationMin).toBe(60);
    expect(dam!.start).toBeGreaterThan(drive!.start);
    expect(cable!.start).toBeGreaterThanOrEqual(dam!.end);
    expect(cable!.end).toBeLessThanOrEqual(drive!.end);
    expect(drive!.routeStop).toBeUndefined();
    expect(routeStopsLabel(drive!)).toBe('razem z postojami po drodze (1 h 40 min): 5 h');
  });

  it('pominięty postój skraca przejazd; scenariusz pesymistyczny bierze górne granice; opóźnienie postoju wydłuża trasę', () => {
    const { doc } = mestia();
    expect(entry(doc, DRIVE, { skipRefs: ['d2-hacwali'] }).durationMin).toBe(240);
    const longer = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'd2-hacwali' ? { ...item, durationMaxMin: 90 } : item)) });
    expect(entry(longer, DRIVE, { scenario: 'pessimistic' }).durationMin).toBe(330);
    expect(entry(doc, DRIVE, { delays: [{ itemRef: 'd2-zapora-inguri', minutes: 15 }] }).durationMin).toBe(315);
  });

  it('postój bez czasu trwania nic nie dodaje', () => {
    const { doc } = mestia();
    const empty = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'd2-zapora-inguri' ? (({ durationMin: _d, ...rest }) => rest)(item) : item)) });
    expect(entry(empty, 'd2-zapora-inguri').durationMin).toBe(0);
    expect(entry(empty, DRIVE).durationMin).toBe(260);
    const none = TripDocument.parse({ ...empty, items: empty.items.map((item) => (item.ref === 'd2-hacwali' ? (({ durationMin: _d, ...rest }) => rest)(item) : item)) });
    expect(routeStopsLabel(entry(none, DRIVE))).toBeNull();
  });

  it('godzina z planu przy postoju nie przesuwa go ani nie daje ostrzeżenia o spóźnieniu', () => {
    const { doc } = mestia();
    const timed = TripDocument.parse({ ...doc, items: doc.items.map((item) => (item.ref === 'd2-hacwali' ? { ...item, time: { precision: 'exact' as const, start: '08:00' } } : item)) });
    const schedule = scheduleDay(timed, 'd2');
    expect(schedule.warnings.filter((warning) => warning.itemRef === 'd2-hacwali')).toEqual([]);
    expect(entry(timed, DRIVE).durationMin).toBe(300);
  });

  it('„teraz” i „następne” pomijają postoje: trwa przejazd, a następny jest punkt po nim', () => {
    const { doc } = mestia();
    const schedule = scheduleDay(doc, 'd2');
    const drive = schedule.items.find((item) => item.ref === DRIVE)!;
    const { current, next } = nowAndNext(schedule, drive.start + 150 * 60_000);
    expect(current?.ref).toBe(DRIVE);
    expect(next?.routeStop).toBeUndefined();
    expect(next?.start).toBeGreaterThanOrEqual(drive.end);
  });

  it('mapa: postój ma pinezkę z numerem, ale linia dnia nie zawraca do niego po dojechaniu', () => {
    const { doc } = mestia();
    const refs = scheduleDay(doc, 'd2').items.map((item) => item.ref);
    const map = dayMap(doc, refs);
    const dam = doc.items.find((item) => item.ref === 'd2-zapora-inguri')!;
    expect(map.pins.find((pin) => pin.placeRef === dam.placeRef)?.stops.map((stop) => stop.ref)).toContain('d2-zapora-inguri');
    expect(map.numbers['d2-zapora-inguri']).toBeDefined();
    const place = doc.places.find((each) => each.ref === dam.placeRef)!;
    if (place.lat !== undefined) {
      const onStraight = map.lines.filter((line) => !line.routed).some((line) => line.coordinates.some((point) => point[0] === place.lng && point[1] === place.lat));
      expect(onStraight).toBe(false);
    }
  });

  it('włączanie: tylko punkt tuż po przejeździe, bez noclegów i stałych godzin; wyjęcie wraca do zwykłego punktu', () => {
    const { doc, plain } = mestia();
    expect(routeStopTarget(plain, 'd2-zapora-inguri')?.ref).toBe(DRIVE);
    expect(routeStopTarget(plain, 'd2-hacwali')).toBeNull();
    expect(routeStopTarget(doc, 'd2-hacwali')).toBeNull();
    expect(routeStopTarget(plain, DRIVE)).toBeNull();
    const fixed = TripDocument.parse({ ...plain, items: plain.items.map((item) => (item.ref === 'd2-zapora-inguri' ? { ...item, isFixed: true } : item)) });
    expect(setRouteStop(fixed, 'd2-zapora-inguri', true)).toBeNull();
    const out = setRouteStop(doc, 'd2-zapora-inguri', false)!;
    expect(out.changed[0]!.parentRef).toBeUndefined();
    expect(isRouteStop(out.doc, out.changed[0]!)).toBe(false);
    expect(setRouteStop(out.doc, 'd2-zapora-inguri', false)).toBeNull();
    expect(setRouteStop(doc, 'nie-ma', true)).toBeNull();
  });

  it('przejazd przeniesiony do innego dnia zostawia postoje jako zwykłe punkty', () => {
    const { doc } = mestia();
    const edit = moveToDay(doc, DRIVE, 'd3')!;
    const dam = edit.doc.items.find((item) => item.ref === 'd2-zapora-inguri')!;
    expect(dam.parentRef).toBeUndefined();
    expect(edit.changed.map((item) => item.ref)).toEqual(expect.arrayContaining([DRIVE, 'd2-zapora-inguri', 'd2-hacwali']));
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });

  it('podpunkty bloku działają jak dotąd: równolegle i bez wydłużania rodzica', () => {
    const chatka = fixture('chatka');
    const child = chatka.items.find((item) => item.parentRef !== undefined)!;
    expect(isRouteStop(chatka, child)).toBe(false);
    const parent = scheduleDay(chatka, child.dayRef!).items.find((item) => item.ref === child.parentRef)!;
    expect(parent.routeStopsMin).toBeUndefined();
  });

  it('cięcia i pamiątka: postój to zwykły kandydat do cięcia i liczy się jak punkt wyjazdu', () => {
    const { doc, plain } = mestia();
    expect(() => proposeCuts(doc, 'd2')).not.toThrow();
    const field = { done: [], skipRefs: [] };
    expect(tripMemories(doc, field).planned).toBe(tripMemories(plain, field).planned);
  });
});
