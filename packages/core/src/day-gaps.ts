import type { DaySchedule } from './engine/schedule.ts';
import { instantToZoned } from './engine/time.ts';

/**
 * Wolny czas w planie dnia: przerwa między końcem wszystkiego, co już trwało (z podpunktami bloku i ścieżkami
 * części grupy), a początkiem następnego zwykłego punktu — zwykle przed punktem ze stałą albo podaną godziną
 * (zakwaterowanie od 16:00 po obiedzie do 15:15). Plan pokazuje ją linią „wolne 45 min” jako bufor albo czas
 * do zaplanowania; krótsze od `GAP_MIN_MIN` to zwykły luz i zostają bez znacznika.
 */
export type GapMark = {
  kind: 'gap';
  /** Początek przerwy (ms, UTC) — do kolejności ze znacznikami słońca. */
  at: number;
  /** Godziny w strefie dnia, HH:MM. */
  from: string;
  to: string;
  minutes: number;
  /** Wiersz planu (z `schedule.items`), po którym stoi znacznik. */
  afterItemRef: string;
};

export const GAP_MIN_MIN = 15;

export function dayGaps(schedule: DaySchedule, minMin = GAP_MIN_MIN): GapMark[] {
  const marks: GapMark[] = [];
  let reach: number | undefined;
  schedule.items.forEach((item, index) => {
    // Postoje w trasie i podpunkty bloku dzieją się w ramach swojego punktu: nie zaczynają przerwy.
    if (index > 0 && reach !== undefined && item.child !== true && item.routeStop !== true) {
      const minutes = Math.round((item.start - reach) / 60_000);
      if (minutes >= minMin) {
        marks.push({ kind: 'gap', at: reach, from: instantToZoned(reach, schedule.tz).time, to: item.startLocal, minutes, afterItemRef: schedule.items[index - 1]!.ref });
      }
    }
    reach = reach === undefined ? item.end : Math.max(reach, item.end);
  });
  return marks;
}
