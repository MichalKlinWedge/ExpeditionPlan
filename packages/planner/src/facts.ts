import { dstChange, instantToZoned, sunTimes } from '@expeditionplan/core';

/**
 * Fakty dnia liczone kodem, nie przez AI (SPECYFIKACJA §4, zasada 3): słońce w bazie dnia,
 * zmiana czasu, święta państwowe. Idą do etapu 2 jako wejście — model ich nie zgaduje.
 */

/** Strefa czasowa kraju wyjazdu (kraje z planów wzorcowych; nowy kraj = nowy wpis). */
export const COUNTRY_TZ: Record<string, string> = {
  MA: 'Africa/Casablanca',
  GE: 'Asia/Tbilisi',
  ES: 'Europe/Madrid',
  PL: 'Europe/Warsaw',
  HR: 'Europe/Zagreb',
  IT: 'Europe/Rome',
  AT: 'Europe/Vienna',
  SK: 'Europe/Bratislava',
  CZ: 'Europe/Prague',
  DE: 'Europe/Berlin',
  SI: 'Europe/Ljubljana',
  ME: 'Europe/Podgorica',
  FR: 'Europe/Paris',
  PT: 'Europe/Lisbon',
  GR: 'Europe/Athens',
  NO: 'Europe/Oslo',
};

/** Kraj ze strefy wyjazdu — gdy plan nie ma briefu z listą krajów (import, plan pisany ręcznie). */
export function countryOfTz(tz: string): string | undefined {
  return Object.entries(COUNTRY_TZ).find(([, zone]) => zone === tz)?.[0];
}

export type Holiday = { date: string; localName: string; name: string; countryCode: string };

/**
 * Święta z Nager.Date. Uwaga z docs/USLUGI.md: Maroko bez świąt islamskich — te trzeba dopisać
 * z innego źródła. `fetchImpl` — do testów.
 */
export async function fetchHolidays(country: string, year: number, fetchImpl: typeof fetch = fetch): Promise<Holiday[]> {
  const response = await fetchImpl(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
  if (!response.ok) throw new Error(`Nager.Date ${response.status} dla ${country}-${year}`);
  return (await response.json()) as Holiday[];
}

export type DayFact = {
  date: string;
  base: string;
  tz: string;
  sunrise?: string;
  sunset?: string;
  civilDusk?: string;
  dst?: string;
  holidays: string[];
};

export function dayFact(
  day: { date: string; base: string },
  tz: string,
  coords: { lat: number; lng: number } | undefined,
  dayHolidays: Holiday[],
): DayFact {
  const fact: DayFact = { date: day.date, base: day.base, tz, holidays: dayHolidays.map((h) => `${h.localName} (${h.name})`) };
  if (coords !== undefined) {
    const sun = sunTimes(day.date, coords.lat, coords.lng);
    const local = (instant: number | null) => (instant === null ? undefined : instantToZoned(instant, tz).time);
    const sunrise = local(sun.sunrise);
    const sunset = local(sun.sunset);
    const civilDusk = local(sun.civilDusk);
    if (sunrise) fact.sunrise = sunrise;
    if (sunset) fact.sunset = sunset;
    if (civilDusk) fact.civilDusk = civilDusk;
  }
  const change = dstChange(day.date, tz);
  if (change !== null) fact.dst = `w nocy po tym dniu zmiana czasu: UTC${sign(change.fromOffsetMin)} → UTC${sign(change.toOffsetMin)}`;
  return fact;
}

const sign = (minutes: number) => `${minutes >= 0 ? '+' : '−'}${Math.abs(minutes) / 60}`;
