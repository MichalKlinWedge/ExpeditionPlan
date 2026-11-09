import { instantToZoned, zonedToInstant } from './engine/time.ts';

/**
 * Kolejność i przepinanie wpisów dziennika. Kolejność to `taken_at` (tak czytają ją dziennik, pokaz i film), więc
 * „wyżej / niżej” przesuwa czas wpisu tuż przed albo za sąsiada, a przepięcie na inny dzień zostawia godzinę
 * i zmienia datę. Wspólne dla webu i telefonu.
 */

const MINUTE = 60_000;

/**
 * Nowy `taken_at` wpisu `index` przesuniętego o jedno miejsce (`-1` wyżej, `1` niżej) wśród `times` (ISO, rosnąco,
 * wpisy jednego dnia). Minutę przed / za sąsiadem, a gdy za nim stoi kolejny wpis bliżej — w połowie odstępu.
 * `null`, gdy nie ma dokąd przesunąć.
 */
export function journalMovedTime(times: readonly string[], index: number, direction: -1 | 1): string | null {
  const neighbour = times[index + direction];
  if (neighbour === undefined || index < 0 || index >= times.length) return null;
  const at = Date.parse(neighbour);
  const beyond = times[index + 2 * direction];
  let moved = at + direction * MINUTE;
  if (beyond !== undefined && (Date.parse(beyond) - moved) * direction <= 0) moved = (at + Date.parse(beyond)) / 2;
  return new Date(Math.round(moved)).toISOString();
}

/** `taken_at` po przepięciu na dzień `day`: ta sama godzina (w strefie dotychczasowego dnia), data i strefa nowego. */
export function journalRedated(takenAt: string, fromTz: string, day: { date: string; tz: string }): string {
  const { time } = instantToZoned(Date.parse(takenAt), fromTz);
  return new Date(zonedToInstant(day.date, time, day.tz)).toISOString();
}

/** `taken_at` z wpisanej godziny „HH:MM” w dniu; `null` przy złej godzinie. */
export function journalTimeAt(day: { date: string; tz: string }, time: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (match === null || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return new Date(zonedToInstant(day.date, `${match[1]!.padStart(2, '0')}:${match[2]}`, day.tz)).toISOString();
}
