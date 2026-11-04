import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { legLabel, stopsLabel } from '../plan-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const doc = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/barcelona/plan.json', import.meta.url)), 'utf8')));
const base = doc.items.find((item) => item.dayRef !== undefined && item.leg !== undefined && item.planStatus === 'scheduled' && item.parentRef === undefined)!;

/** Przejazd 60 min (w gorszym razie 90) z podanymi postojami. */
describe('czas wpisany w przejazd tam i z powrotem', () => {
  const ref = base.ref;
  const build = (patch: object) => {
    const { durationMin: _d, durationMaxMin: _m, stopsMin: _s, ...rest } = base;
    const item = { ...rest, leg: { ...base.leg!, durationMin: 120, durationMaxMin: 150, roundTrip: true }, ...patch };
    return TripDocument.parse({ ...doc, items: doc.items.map((each) => (each.ref === ref ? item : each)) });
  };
  const minutes = (document: TripDocument, scenario: 'optimistic' | 'pessimistic' = 'optimistic') => {
    const entry = scheduleDay(document, base.dayRef!, { scenario }).items.find((each) => each.ref === ref)!;
    return Math.round((entry.end - entry.start) / 60_000);
  };

  it('wpisany czas to cały czas punktu, także w scenariuszu pesymistycznym', () => {
    const typed = build({ durationMin: 60 });
    expect(minutes(typed)).toBe(60);
    expect(minutes(typed, 'pessimistic')).toBe(60);
    expect(legLabel(typed.items.find((each) => each.ref === ref)!)).toBe('1 h (wpisane ręcznie)');
  });

  it('czas z trasy liczy się dwa razy i opis to mówi', () => {
    const plain = build({});
    expect(minutes(plain)).toBe(240);
    expect(minutes(plain, 'pessimistic')).toBe(300);
    expect(legLabel(plain.items.find((each) => each.ref === ref)!)).toContain('tam i z powrotem: 4 h');
  });
});

function span(patch: { stopsMin?: number; roundTrip?: boolean }, scenario?: 'pessimistic') {
  const { durationMin: _min, durationMaxMin: _max, ...rest } = base;
  const item = { ...rest, leg: { ...base.leg!, durationMin: 60, durationMaxMin: 90, ...(patch.roundTrip ? { roundTrip: true } : {}) }, ...(patch.stopsMin !== undefined ? { stopsMin: patch.stopsMin } : {}) };
  const next = TripDocument.parse({ ...doc, items: doc.items.map((each) => (each.ref === base.ref ? item : each)) });
  return scheduleDay(next, base.dayRef!, scenario === undefined ? {} : { scenario }).items.find((each) => each.ref === base.ref)!.durationMin;
}

describe('postoje i przerwy punktu', () => {
  it('wydłużają czas przejazdu w obu scenariuszach', () => {
    expect(span({})).toBe(60);
    expect(span({ stopsMin: 30 })).toBe(90);
    expect(span({ stopsMin: 30 }, 'pessimistic')).toBe(120);
  });

  it('w trasie tam i z powrotem liczą się raz', () => {
    expect(span({ stopsMin: 30, roundTrip: true })).toBe(150);
  });

  it('opis punktu pokazuje je obok czasu drogi', () => {
    const { durationMin: _min, durationMaxMin: _max, ...rest } = base;
    const { durationMaxMin: _legMax, distanceKm: _km, ...leg } = base.leg!;
    const plain = { ...rest, kind: 'transport' as const, leg: { ...leg, durationMin: 60, routed: true } };
    const item = { ...plain, stopsMin: 30 };
    expect(legLabel(item)).toBe('1 h (trasa z mapy) + postoje 30 min');
    expect(stopsLabel(plain)).toBeNull();
    expect(stopsLabel(item)).toBe('w tym postoje i przerwy: 30 min');
  });
});
