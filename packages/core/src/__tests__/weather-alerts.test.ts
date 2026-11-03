import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { goNoGoReminders, isOutdoor, weatherAlerts } from '../weather-alerts.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import type { DayWeather } from '../weather.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const sky = (date: string, rain: number): DayWeather => ({ date, tMin: 8, tMax: 14, precipMm: rain, precipProb: rain > 0 ? 80 : 10, windKmh: 15, code: rain > 0 ? 63 : 1 });

describe('go / no-go', () => {
  const maroko = load('maroko');
  const outdoorDays = maroko.days.filter((day) => maroko.items.some((item) => item.dayRef === day.ref && isOutdoor(item)));

  it('zła prognoza w najbliższych dwóch dniach i punkty pod gołym niebem → alert', () => {
    const rainy = Object.fromEntries(maroko.days.map((day) => [day.ref, sky(day.date, 8)]));
    const alerts = weatherAlerts(maroko, rainy, '2026-12-26');
    const expected = outdoorDays.filter((day) => day.date <= '2026-12-28').map((day) => day.ref);
    expect(alerts.map((alert) => alert.dayRef)).toEqual(expected);
    expect(alerts[0]!.outdoor.length).toBeGreaterThan(0);
    expect(alerts[0]!.line).toContain('deszcz 8 mm');
  });

  it('ładna pogoda albo dzień poza horyzontem — cisza', () => {
    const sunny = Object.fromEntries(maroko.days.map((day) => [day.ref, sky(day.date, 0)]));
    expect(weatherAlerts(maroko, sunny, '2026-12-26')).toEqual([]);
    const rainy = Object.fromEntries(maroko.days.map((day) => [day.ref, sky(day.date, 8)]));
    expect(weatherAlerts(maroko, rainy, '2026-12-31')).toEqual([]);
  });

  it('przypomnienie o 19:00 dwa dni przed dniem pod gołym niebem (przed wyjazdem — czas domowy)', () => {
    const reminders = goNoGoReminders(maroko, Date.UTC(2026, 10, 3));
    expect(reminders.map((each) => each.key)).toEqual(outdoorDays.map((day) => `weather:${day.ref}`));
    const first = reminders.find((each) => each.key === 'weather:d1');
    if (first) expect(first.at).toBe(Date.UTC(2026, 11, 24, 18));
    expect(reminders[0]!.title).toMatch(/^Pogoda na \S+ \d+\.12: go \/ no-go$/);
    expect(goNoGoReminders(maroko, Date.UTC(2027, 0, 1))).toEqual([]);
  });
});
