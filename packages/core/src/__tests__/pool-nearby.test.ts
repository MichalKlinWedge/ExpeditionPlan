import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemsForDay, scheduleDay } from '../engine/schedule.ts';
import { zonedToInstant } from '../engine/time.ts';
import { poolNearby } from '../pool-nearby.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
/** Przy Kutubijji w Marakeszu. */
const kutubia = { lat: 31.6237, lng: -7.9937 };

describe('z puli w pobliżu', () => {
  it('najbliższe z puli z dojściem; bez odrzuconych, niemieszczących się i bez współrzędnych', () => {
    const near = poolNearby(maroko, kutubia, { gapMin: 120 });
    expect(near.map((each) => each.item.ref)).toEqual(['pula-saadyci', 'pula-el-badi']);
    expect(near[0]).toMatchObject({ walkMin: expect.any(Number), stayMin: 45, fits: true });
    expect(near[0]!.km).toBeLessThan(1.5);
  });

  it('za mało czasu: na końcu listy i z fits = false; bez wolnego czasu — null', () => {
    expect(poolNearby(maroko, kutubia, { gapMin: 40 }).map((each) => each.fits)).toEqual([false, false]);
    expect(poolNearby(maroko, kutubia)[0]!.fits).toBeNull();
    expect(poolNearby(maroko, kutubia, { exclude: ['pula-saadyci'] }).map((each) => each.item.ref)).toEqual(['pula-el-badi']);
  });

  it('wstawiony w terenie punkt z puli wchodzi do dnia za wskazanym i przelicza godziny', () => {
    const day = itemsForDay(maroko, 'd1');
    const after = day[day.length - 2]!.ref;
    const pulled = [{ itemRef: 'pula-saadyci', dayRef: 'd1', afterRef: after }];
    const withPull = itemsForDay(maroko, 'd1', { pulled }).map((item) => item.ref);
    expect(withPull[withPull.indexOf(after) + 1]).toBe('pula-saadyci');
    expect(itemsForDay(maroko, 'd2', { pulled }).some((item) => item.ref === 'pula-saadyci')).toBe(false);
    const schedule = scheduleDay(maroko, 'd1', { pulled });
    expect(schedule.items.find((item) => item.ref === 'pula-saadyci')?.durationMin).toBe(45);

    // Wstawiony o 20:30 czasu Marakeszu: nie zaczyna się wcześniej.
    const late = scheduleDay(maroko, 'd1', { pulled: [{ ...pulled[0]!, at: zonedToInstant(maroko.days[0]!.date, '20:30', maroko.days[0]!.tz) }] });
    expect(late.items.find((item) => item.ref === 'pula-saadyci')!.startLocal >= '20:30').toBe(true);
  });
});
