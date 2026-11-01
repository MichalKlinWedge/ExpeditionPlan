import { describe, expect, it } from 'vitest';

import { moonIllumination, sunTimes } from '../engine/sun.ts';
import { dstChange, formatOffset, instantToZoned, offsetMinutes, zonedToInstant } from '../engine/time.ts';

const local = (instant: number | null, tz: string) => (instant === null ? null : instantToZoned(instant, tz).time);
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
/** Różnica dwóch godzin „GG:MM” w minutach. */
const gap = (a: string | null, b: string) => Math.abs(minutes(a ?? '00:00') - minutes(b));

describe('czas lokalny i strefy', () => {
  it('przelicza czas lokalny na chwilę i z powrotem', () => {
    const instant = zonedToInstant('2027-08-04', '15:40', 'Europe/Warsaw');

    expect(new Date(instant).toISOString()).toBe('2027-08-04T13:40:00.000Z');
    expect(instantToZoned(instant, 'Asia/Tbilisi')).toEqual({ date: '2027-08-04', time: '17:40' });
  });

  it('zna przesunięcia stref z planów', () => {
    // Maroko od 20.09.2026 na stałe UTC+0 (tzdata 2026c) — wcześniej cały rok +1.
    expect(offsetMinutes(Date.UTC(2026, 11, 26), 'Africa/Casablanca')).toBe(0);
    expect(offsetMinutes(Date.UTC(2027, 7, 4), 'Asia/Tbilisi')).toBe(240);
    expect(offsetMinutes(Date.UTC(2026, 6, 1), 'Europe/Warsaw')).toBe(120);
  });

  it('noc 24/25.10.2026 (Chatka): zmiana czasu 3:00 → 2:00', () => {
    expect(dstChange('2026-10-24', 'Europe/Warsaw')).toEqual({ fromOffsetMin: 120, toOffsetMin: 60 });
    expect(dstChange('2026-10-26', 'Europe/Warsaw')).toBeNull();
    // Maroko od 20.09.2026 stale na UTC+0 — w grudniu żadnej zmiany.
    expect(dstChange('2026-12-26', 'Africa/Casablanca')).toBeNull();
  });

  it('godzina powtórzona jesienią bierze pierwsze wystąpienie, nieistniejąca wiosną przesuwa się naprzód', () => {
    expect(new Date(zonedToInstant('2026-10-25', '02:30', 'Europe/Warsaw')).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(instantToZoned(zonedToInstant('2026-03-29', '02:30', 'Europe/Warsaw'), 'Europe/Warsaw').time).toBe('03:30');
  });

  it('formatuje przesunięcia względne jak we wzorze', () => {
    expect(formatOffset(80)).toBe('+1:20');
    expect(formatOffset(540)).toBe('+9:00');
  });
});

describe('Maroko od 20.09.2026 na stałe UTC+0 (tzdata 2026c)', () => {
  it('grudzień 2026: UTC+0 niezależnie od bazy stref środowiska', () => {
    expect(offsetMinutes(Date.UTC(2026, 11, 26, 12), 'Africa/Casablanca')).toBe(0);
    expect(zonedToInstant('2026-12-26', '04:10', 'Africa/Casablanca')).toBe(Date.UTC(2026, 11, 26, 4, 10));
    expect(instantToZoned(Date.UTC(2026, 11, 26, 3, 10), 'Africa/Casablanca').time).toBe('03:10');
  });

  it('noc zmiany 19/20.09.2026: z +1 na 0; latem 2026 nadal +1', () => {
    expect(offsetMinutes(Date.UTC(2026, 6, 1, 12), 'Africa/Casablanca')).toBe(60);
    expect(dstChange('2026-09-19', 'Africa/Casablanca')).toEqual({ fromOffsetMin: 60, toOffsetMin: 0 });
  });
});

describe('słońce i Księżyc (dokładność ±5 min wobec planów)', () => {
  it('Chatka, Przełęcz Spalona 24.10.2026: wschód 7:31, zachód 17:45, ciemno ok. 18:20', () => {
    const sun = sunTimes('2026-10-24', 50.2767, 16.5373);

    expect(gap(local(sun.sunrise, 'Europe/Warsaw'), '07:31')).toBeLessThanOrEqual(5);
    expect(gap(local(sun.sunset, 'Europe/Warsaw'), '17:45')).toBeLessThanOrEqual(5);
    expect(gap(local(sun.civilDusk, 'Europe/Warsaw'), '18:20')).toBeLessThanOrEqual(5);
  });

  it('Chatka 25.10.2026, już czas zimowy: wschód 6:32, zachód 16:43', () => {
    const sun = sunTimes('2026-10-25', 50.2767, 16.5373);

    expect(gap(local(sun.sunrise, 'Europe/Warsaw'), '06:32')).toBeLessThanOrEqual(5);
    expect(gap(local(sun.sunset, 'Europe/Warsaw'), '16:43')).toBeLessThanOrEqual(5);
  });

  it('Marakesz koniec grudnia 2026: zachód ok. 17:35 (UTC+0 od 20.09.2026, nie 18:35 z planu)', () => {
    const sun = sunTimes('2026-12-27', 31.6295, -7.9811);

    expect(gap(local(sun.sunset, 'Africa/Casablanca'), '17:35')).toBeLessThanOrEqual(5);
    expect(gap(local(sun.sunrise, 'Africa/Casablanca'), '07:30')).toBeLessThanOrEqual(10);
  });

  it('noc polarna nie ma wschodu ani zachodu', () => {
    const sun = sunTimes('2026-12-21', 69.65, 18.96);

    expect(sun.sunrise).toBeNull();
    expect(sun.sunset).toBeNull();
  });

  it('Księżyc w nocy 24/25.10.2026 oświetlony w ok. 98%', () => {
    expect(moonIllumination(Date.UTC(2026, 9, 24, 22))).toBeGreaterThan(0.93);
  });
});
