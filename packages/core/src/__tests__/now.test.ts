import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { nowAndNext, scheduleDay, TripDocument, zonedToInstant } from '../index.ts';

const doc = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const day = doc.days[1]!;
const schedule = scheduleDay(doc, day.ref);
// Pierwszy punkt, który trwa (są też punkty bez czasu: „wyjście”, „zameldowanie”).
const lasting = schedule.items.find((item) => item.end - item.start >= 30 * 60_000)!;

describe('teraz / następny', () => {
  it('przed pierwszym punktem: nic nie trwa, następny to pierwszy', () => {
    const result = nowAndNext(schedule, schedule.items[0]!.start - 10 * 60_000);
    expect(result.current).toBeNull();
    expect(result.next?.ref).toBe(schedule.items[0]!.ref);
    expect(result.untilNextMin).toBe(10);
  });

  it('w trakcie punktu: bieżący, minuty do końca i następny', () => {
    const at = lasting.start + 5 * 60_000;
    const result = nowAndNext(schedule, at);
    expect(result.current?.ref).toBe(lasting.ref);
    expect(result.leftMin).toBe((lasting.end - at) / 60_000);
    expect(result.next!.start).toBeGreaterThan(at);
  });

  it('po ostatnim punkcie: nic', () => {
    const last = Math.max(...schedule.items.map((item) => item.end));
    expect(nowAndNext(schedule, last + 60_000)).toEqual({ current: null, next: null, leftMin: null, untilNextMin: null });
  });

  it('„Zostajemy dłużej” przesuwa następny punkt', () => {
    const at = zonedToInstant(day.date, lasting.startLocal, day.tz) + 60_000;
    const before = nowAndNext(schedule, at);
    const delayed = scheduleDay(doc, day.ref, { delays: [{ itemRef: before.current!.ref, minutes: 30 }] });
    const after = nowAndNext(delayed, at);
    expect(after.current?.ref).toBe(before.current?.ref);
    expect(after.leftMin).toBe(before.leftMin! + 30);
    expect(after.next!.start).toBeGreaterThanOrEqual(before.next!.start);
  });
});
