/**
 * Czas lokalny ↔ chwila (ms od epoki, UTC) w strefie IANA — bez bibliotek, przez Intl, więc tak
 * samo w przeglądarce, na telefonie i w Deno. Silnik liczy na chwilach, a pokazuje czas lokalny:
 * tylko tak lot z Wrocławia do Kutaisi albo noc ze zmianą czasu dają poprawne długości.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let found = formatters.get(tz);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, found);
  }
  return found;
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/**
 * Zmiany stref nowsze niż baza stref części środowisk. Maroko (i Sahara Zachodnia) od
 * 20.09.2026 02:00 czasu lokalnego (01:00 UTC) jest na stałe w UTC+0 — tzdata 2026c; Node 24
 * ma 2026b i liczy UTC+1, telefony bez aktualizacji systemu też. Od tej chwili liczymy stałe
 * przesunięcie zamiast `Intl`, więc web, serwer i telefon dają ten sam plan (gdy środowisko ma
 * nowe dane, wynik jest identyczny). Nowy wpis — tylko po wydaniu tzdata, które zmianę zawiera.
 */
const FIXED_OFFSET_FROM: Record<string, { from: number; offsetMin: number }> = {
  'Africa/Casablanca': { from: Date.UTC(2026, 8, 20, 1), offsetMin: 0 },
  'Africa/El_Aaiun': { from: Date.UTC(2026, 8, 20, 1), offsetMin: 0 },
};

function partsAt(instant: number, tz: string): Parts {
  const fixed = FIXED_OFFSET_FROM[tz];
  if (fixed !== undefined && instant >= fixed.from) {
    const local = new Date(instant + fixed.offsetMin * MINUTE);
    return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
  }
  const values: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour! % 24,
    minute: values.minute!,
  };
}

export const MINUTE = 60_000;

/** Przesunięcie strefy względem UTC w danej chwili, w minutach (Warszawa latem: 120). */
export function offsetMinutes(instant: number, tz: string): number {
  const whole = Math.floor(instant / MINUTE) * MINUTE;
  const p = partsAt(whole, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - whole) / MINUTE);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Chwila dla daty i godziny lokalnej. Przy zmianie czasu godzina nieistniejąca (02:30 w marcu)
 * przesuwa się do przodu, a powtórzona (02:30 w październiku) bierze pierwsze wystąpienie.
 */
export function zonedToInstant(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMinutes(guess - 12 * 60 * MINUTE, tz);
  const after = offsetMinutes(guess + 12 * 60 * MINUTE, tz);

  const valid = [...new Set([before, after])]
    .map((offset) => guess - offset * MINUTE)
    .filter((instant) => offsetMinutes(instant, tz) * MINUTE === guess - instant)
    .sort((a, b) => a - b);
  // Brak trafienia = godzina wypada w dziurze wiosennej zmiany czasu: liczymy ją po starym czasie.
  return valid[0] ?? guess - before * MINUTE;
}

export function instantToZoned(instant: number, tz: string): { date: string; time: string } {
  const p = partsAt(instant, tz);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** „09:45” → 585. */
export function minutesOfDay(time: string): number {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}

/** 80 → „+1:20”, -15 → „−0:15”. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
}

/**
 * Zmiana czasu między początkiem dnia a południem następnego — czyli w nocy, która należy do tego
 * dnia planu (Chatka: noc 24/25.10, 3:00 → 2:00).
 */
export function dstChange(date: string, tz: string): { fromOffsetMin: number; toOffsetMin: number } | null {
  const from = offsetMinutes(zonedToInstant(date, '00:00', tz), tz);
  const to = offsetMinutes(zonedToInstant(addDays(date, 1), '12:00', tz), tz);
  return from === to ? null : { fromOffsetMin: from, toOffsetMin: to };
}
