import type { DaySchedule, ScheduledItem } from './schedule.ts';

/**
 * „Teraz / następny” w Pocket Guide: który punkt dnia trwa w tej chwili, a który jest następny.
 * Liczone na policzonym harmonogramie (z opóźnieniami i pominięciami), więc po „Zostajemy dłużej”
 * od razu przesuwa się także „następny”.
 */

export type NowAndNext = {
  /** Punkt, który trwa; przy nakładających się (podpunkty) — ten, który zaczął się najpóźniej. */
  current: ScheduledItem | null;
  next: ScheduledItem | null;
  /** Minuty do końca bieżącego punktu. */
  leftMin: number | null;
  /** Minuty do startu następnego. */
  untilNextMin: number | null;
};

const MINUTE = 60_000;

export function nowAndNext(schedule: DaySchedule, now: number): NowAndNext {
  let current: ScheduledItem | null = null;
  // Postój w trasie ma tylko przybliżoną chwilę: w tym czasie trwa przejazd.
  const steps = schedule.items.filter((item) => !item.routeStop);
  for (const item of steps) {
    if (item.start <= now && now < item.end && (current === null || item.start >= current.start)) current = item;
  }
  const next = steps.filter((item) => item.start > now).sort((a, b) => a.start - b.start)[0] ?? null;
  return {
    current,
    next,
    leftMin: current === null ? null : Math.ceil((current.end - now) / MINUTE),
    untilNextMin: next === null ? null : Math.ceil((next.start - now) / MINUTE),
  };
}
