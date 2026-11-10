import type { DaySchedule } from './engine/schedule.ts';
import { instantToZoned } from './engine/time.ts';

/**
 * Wschód i zachód słońca w planie dnia: symboliczna linia między punktami („☀ 19:51 zachód słońca”).
 * Słońce liczy silnik (`facts.sun`: baza dnia, a bez niej pierwszy punkt ze współrzędnymi), tu tylko
 * decydujemy, czy wypada w godzinach planu — od początku pierwszego do końca ostatniego punktu — i po
 * którym wierszu go wstawić.
 */
export type SunMark = {
  kind: 'sunrise' | 'sunset';
  /** Chwila (ms, UTC). */
  at: number;
  /** Godzina w strefie dnia, HH:MM. */
  time: string;
  /** Wiersz planu (z `schedule.items`), po którym stoi znacznik. */
  afterItemRef: string;
};

export function daySunMarks(schedule: DaySchedule): SunMark[] {
  const sun = schedule.facts.sun;
  const items = schedule.items;
  if (sun === null || items.length === 0) return [];
  const first = Math.min(...items.map((item) => item.start));
  const last = Math.max(...items.map((item) => item.end));
  const marks: SunMark[] = [];
  for (const [kind, at] of [['sunrise', sun.sunrise], ['sunset', sun.sunset]] as const) {
    if (at === null || at < first || at > last) continue;
    // Przed pierwszym zwykłym punktem, który zaczyna się później. Postoje w trasie i podpunkty bloku
    // nie są granicą: znacznik nie rozdziela punktu i jego podpunktów.
    const next = items.findIndex((item, index) => index > 0 && item.child !== true && item.routeStop !== true && item.start > at);
    const after = items[(next === -1 ? items.length : next) - 1]!;
    marks.push({ kind, at, time: instantToZoned(at, schedule.tz).time, afterItemRef: after.ref });
  }
  return marks;
}
