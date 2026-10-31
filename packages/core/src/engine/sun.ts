/**
 * Słońce i Księżyc dla dnia i miejsca, liczone lokalnie (SPECYFIKACJA §7, fakty dnia) — offline,
 * bez API. Dokładność rzędu minuty wystarcza: plan mówi „zachód ok. 18:35”, a nie co do sekundy.
 *
 * Wzory: równanie wschodu słońca (NOAA / Meeus w wersji uproszczonej) i średni miesiąc synodyczny.
 */

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545.0;
const DAY_MS = 86_400_000;

const toJulian = (instant: number) => instant / DAY_MS + J1970;
const fromJulian = (julian: number) => Math.round((julian - J1970) * DAY_MS);

export type SunTimes = {
  /** Chwile (ms, UTC). `null`, gdy słońce tego dnia nie wschodzi albo nie zachodzi. */
  sunrise: number | null;
  sunset: number | null;
  /** Początek i koniec zmierzchu cywilnego (słońce 6° pod horyzontem) — „od 18:20 ciemno”. */
  civilDawn: number | null;
  civilDusk: number | null;
  solarNoon: number;
};

/** Czasy słońca dla daty kalendarzowej (RRRR-MM-DD) i współrzędnych (długość wschodnia dodatnia). */
export function sunTimes(date: string, lat: number, lng: number): SunTimes {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const noonUtc = toJulian(Date.UTC(y, m - 1, d, 12));
  const n = Math.round(noonUtc - J2000 - 0.0008 + lng / 360);
  const meanSolar = n - lng / 360;

  const anomaly = (357.5291 + 0.98560028 * meanSolar) % 360;
  const center =
    1.9148 * Math.sin(anomaly * RAD) + 0.02 * Math.sin(2 * anomaly * RAD) + 0.0003 * Math.sin(3 * anomaly * RAD);
  const longitude = (anomaly + center + 180 + 102.9372) % 360;
  const transit = J2000 + meanSolar + 0.0053 * Math.sin(anomaly * RAD) - 0.0069 * Math.sin(2 * longitude * RAD);
  const declination = Math.asin(Math.sin(longitude * RAD) * Math.sin(23.4397 * RAD));

  const at = (altitude: number): [number | null, number | null] => {
    const cosHour =
      (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(declination)) /
      (Math.cos(lat * RAD) * Math.cos(declination));
    if (cosHour < -1 || cosHour > 1) return [null, null];
    const hour = Math.acos(cosHour) / RAD / 360;
    return [fromJulian(transit - hour), fromJulian(transit + hour)];
  };

  const [sunrise, sunset] = at(-0.833);
  const [civilDawn, civilDusk] = at(-6);
  return { sunrise, sunset, civilDawn, civilDusk, solarNoon: fromJulian(transit) };
}

const SYNODIC_DAYS = 29.530588853;
/** Nów odniesienia: 6.01.2000, 18:14 UTC. */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Oświetlona część tarczy Księżyca, 0–1 (Chatka: noc 24/25.10.2026 ≈ 0,98). */
export function moonIllumination(instant: number): number {
  const age = (((instant - NEW_MOON) / DAY_MS) % SYNODIC_DAYS + SYNODIC_DAYS) % SYNODIC_DAYS;
  return (1 - Math.cos((2 * Math.PI * age) / SYNODIC_DAYS)) / 2;
}
