import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dayStatistics, dayVariantLabels, moveLine, stayLine, tripStatistics } from '../day-stats.ts';
import { activeVariants, scheduleDay } from '../engine/schedule.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const maroko = load('maroko');

describe('statystyki dnia', () => {
  it('przejazdy, pobyt i wolny czas z silnika; kilometry z planu', () => {
    const day = maroko.days.find((each) => each.date === '2026-12-26')!;
    const schedule = scheduleDay(maroko, day.ref);
    const stats = dayStatistics(maroko, schedule)!;
    expect(stats.start).toBe(schedule.items[0]!.startLocal);
    expect(stats.points).toBe(schedule.items.filter((row) => !row.child && !row.routeStop).length);
    const drive = stats.moves.find((move) => move.kind === 'drive')!;
    expect(drive.km).toBeGreaterThan(200);
    expect(moveLine(drive)).toMatch(/^246 km · 2 h 52 min · 1 odcinek$/);
    expect(stats.moves.map((move) => move.kind)).toEqual(['drive', 'flight']);
    expect(stats.moves.find((move) => move.kind === 'flight')!.noKm).toBe(1);
    expect(stats.stays.map((each) => each.kind)).toEqual(['sights', 'meals', 'other']);
    expect(stats.freeMin).toBeGreaterThan(0);
  });

  it('pusty dzień bez statystyk, opisy liczb', () => {
    expect(dayStatistics(maroko, { ...scheduleDay(maroko, maroko.days[0]!.ref), items: [] })).toBeNull();
    expect(moveLine({ kind: 'foot', count: 2, km: 12.4, noKm: 1, minutes: 190, stopsMin: 30, ascentM: 650, descentM: 600 })).toBe('12 km · 3 h 10 min · ↑ 650 m ↓ 600 m · 2 odcinki (1 bez km) · postoje 30 min');
    expect(stayLine({ kind: 'sights', count: 6, minutes: 320, untimed: 2 })).toBe('6 punktów (2 bez czasu) · 5 h 20 min');
    expect(stayLine({ kind: 'meals', count: 2, minutes: 0, untimed: 2 })).toBe('2 punkty (bez czasu w planie)');
  });

  it('liczą się tylko punkty wybranych wariantów, a karta je nazywa', () => {
    const group = maroko.variantGroups.find((each) => each.dayRef !== undefined && maroko.variants.filter((variant) => variant.groupRef === each.ref).length > 2)!;
    const [full, , , radical] = maroko.variants.filter((variant) => variant.groupRef === group.ref);
    const count = (variantRef: string) => dayStatistics(maroko, scheduleDay(maroko, group.dayRef!, { activeVariants: { [group.ref]: variantRef } }))!.points;
    expect(count(full!.ref)).toBeGreaterThan(count(radical!.ref));
    expect(dayVariantLabels(maroko, group.dayRef!, activeVariants(maroko, { [group.ref]: radical!.ref }))).toContain(`${group.title}: ${radical!.label}`);
  });

  it('cały wyjazd: suma dni i dni z rekordami', () => {
    const schedules = maroko.days.map((day) => scheduleDay(maroko, day.ref));
    const days = schedules.map((schedule) => dayStatistics(maroko, schedule)!);
    const trip = tripStatistics(maroko, schedules)!;
    expect(trip.days).toBe(maroko.days.length);
    expect(trip.points).toBe(days.reduce((sum, day) => sum + day.points, 0));
    const driveKm = days.reduce((sum, day) => sum + (day.moves.find((move) => move.kind === 'drive')?.km ?? 0), 0);
    expect(trip.moves.find((move) => move.kind === 'drive')!.km).toBeCloseTo(driveKm, 1);
    expect(trip.longestDay!.spanMin).toBe(Math.max(...days.map((day) => day.spanMin)));
    expect(trip.movingMin).toBe(trip.moves.reduce((sum, move) => sum + move.minutes, 0));
    expect(tripStatistics(maroko, [])).toBeNull();
  });

  it('lot bez dystansu w planie: odległość po łuku między lotniskami', () => {
    const barcelona = load('barcelona');
    const flight = barcelona.items.find((item) => item.leg?.mode === 'flight')!;
    expect(flight.leg!.distanceKm).toBeUndefined();
    const stats = dayStatistics(barcelona, scheduleDay(barcelona, flight.dayRef!))!;
    const km = stats.moves.find((move) => move.kind === 'flight')!;
    expect(km.noKm).toBe(0);
    expect(km.km).toBeGreaterThan(1500);
    expect(km.km).toBeLessThan(1800);
  });
});
