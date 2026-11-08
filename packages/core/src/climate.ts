import { addDays } from './engine/time.ts';
import { sunTimes } from './engine/sun.ts';
import { daysBetween } from './trip-reschedule.ts';
import { FORECAST_DAYS } from './weather.ts';

/**
 * Klimat dla terminu dalej niż horyzont prognozy (16 dni): średnie z archiwum Open-Meteo (reanaliza
 * ERA5) z tych samych dni kalendarza w ostatnich 10 latach — temperatura, opad, słońce — oraz długość
 * dnia liczona lokalnie (`sunTimes`). Warunki jak przy prognozie (docs/USLUGI.md §6: tylko
 * niekomercyjnie, CC BY 4.0); wywołuje przeglądarka, nic nie jest zapisywane. Jedno pobranie
 * obejmuje okno (np. całą ankietę terminu), a `climateFor` liczy z niego dowolny termin w środku.
 */

export const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
export const OPEN_METEO_GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
export const CLIMATE_ATTRIBUTION = 'Klimat: Open-Meteo.com (CC BY 4.0), ERA5 — Copernicus Climate Change Service';
/** Ile lat wstecz. */
export const CLIMATE_YEARS = 10;
/** Dni dookoła terminu, które też się liczą (krótki wyjazd = więcej próbek). */
export const CLIMATE_PAD = 3;
/** Najdłuższe okno jednego pobrania (ankieta terminu ma najwyżej 122 dni). */
export const CLIMATE_MAX_DAYS = 130;
/** Archiwum ERA5 ma ok. 5 dni opóźnienia. */
const ARCHIVE_LAG_DAYS = 7;

/** `geonames`: miejsce z geokodera Open-Meteo (wymaga dopisku „GeoNames”). */
export type ClimatePlace = { lat: number; lng: number; name: string; geonames?: boolean };

/** Jeden dzień z jednego roku: `offset` = dni od początku okna (`from`), tak samo w każdym roku. */
export type ClimateSample = { year: number; offset: number; tMax: number | null; tMin: number | null; precipMm: number | null; sunS: number | null };
export type ClimateSamples = { place: ClimatePlace; from: string; to: string; samples: ClimateSample[] };

export type Climate = {
  /** Średnie dziennych maksimów i minimów (°C). */
  tMax: number;
  tMin: number;
  /** Średni opad na dzień (mm) i odsetek dni z opadem ≥ 1 mm. */
  precipMm: number;
  wetShare: number;
  /** Średnie usłonecznienie (h na dzień); `null`, gdy archiwum go nie podało. */
  sunHours: number | null;
  /** Średnia długość dnia (wschód–zachód) w terminie, w minutach; `null` przy dniu/nocy polarnej. */
  daylightMin: number | null;
  /** Lata, z których są dane (np. 2016–2025). */
  firstYear: number;
  lastYear: number;
};

/** Termin poza horyzontem prognozy: klimat zamiast pogody. */
export const needsClimate = (start: string, today: string) => daysBetween(today, start) >= FORECAST_DAYS;

/** Ta sama data `years` lat wcześniej (29 lutego → 1 marca). */
export function yearsBack(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y - years, m - 1, d)).toISOString().slice(0, 10);
}

/** Przesunięcia w latach dla pobrania okna: najnowsze, którego koniec jest już w archiwum, i 9 wcześniejszych. */
export function climateYears(to: string, today: string): number[] {
  const last = addDays(today, -ARCHIVE_LAG_DAYS);
  let first = 1;
  while (yearsBack(addDays(to, CLIMATE_PAD), first) > last) first++;
  return Array.from({ length: CLIMATE_YEARS }, (_, index) => first + index);
}

export function climateUrl(place: ClimatePlace, start: string, end: string): string {
  return (
    `${OPEN_METEO_ARCHIVE}?latitude=${place.lat.toFixed(3)}&longitude=${place.lng.toFixed(3)}` +
    `&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&models=era5&timezone=auto`
  );
}

type Daily = { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[]; precipitation_sum: (number | null)[]; sunshine_duration?: (number | null)[] };

/**
 * Dane z archiwum dla okna `from`–`to` (z marginesem `CLIMATE_PAD`) w 10 latach: jedno zapytanie na rok,
 * równolegle. Rok, który się nie pobrał, jest pomijany; błąd tylko gdy nie ma żadnego.
 */
export async function fetchClimate(place: ClimatePlace, from: string, to: string, today: string, fetchImpl: typeof fetch = fetch): Promise<ClimateSamples> {
  if (daysBetween(from, to) + 1 > CLIMATE_MAX_DAYS) throw new Error(`Klimat: okno dłuższe niż ${CLIMATE_MAX_DAYS} dni.`);
  const start = addDays(from, -CLIMATE_PAD);
  const end = addDays(to, CLIMATE_PAD);
  const years = climateYears(to, today);
  const results = await Promise.all(
    years.map(async (back) => {
      try {
        const response = await fetchImpl(climateUrl(place, yearsBack(start, back), yearsBack(end, back)));
        if (!response.ok) return null;
        const { daily } = (await response.json()) as { daily?: Daily };
        if (daily === undefined) return null;
        const year = Number(yearsBack(from, back).slice(0, 4));
        return daily.time.map((_, index) => ({
          year,
          offset: index - CLIMATE_PAD,
          tMax: daily.temperature_2m_max[index] ?? null,
          tMin: daily.temperature_2m_min[index] ?? null,
          precipMm: daily.precipitation_sum[index] ?? null,
          sunS: daily.sunshine_duration?.[index] ?? null,
        }));
      } catch {
        return null;
      }
    }),
  );
  const samples = results.flatMap((each) => each ?? []);
  if (samples.length === 0) throw new Error('Klimat: archiwum Open-Meteo nie odpowiedziało.');
  return { place, from, to, samples };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const present = (values: (number | null)[]) => values.filter((value): value is number => value !== null && Number.isFinite(value));

/** Klimat terminu `start`–`end` (w oknie pobranych danych), z marginesem `CLIMATE_PAD` dni. */
export function climateFor(data: ClimateSamples, start: string, end: string): Climate | null {
  const first = daysBetween(data.from, start) - CLIMATE_PAD;
  const last = daysBetween(data.from, end) + CLIMATE_PAD;
  const days = data.samples.filter((sample) => sample.offset >= first && sample.offset <= last);
  const tMax = present(days.map((day) => day.tMax));
  const tMin = present(days.map((day) => day.tMin));
  const precip = present(days.map((day) => day.precipMm));
  if (tMax.length === 0 || tMin.length === 0 || precip.length === 0) return null;
  const sun = present(days.map((day) => day.sunS));
  const years = days.map((day) => day.year);
  return {
    tMax: Math.round(mean(tMax)),
    tMin: Math.round(mean(tMin)),
    precipMm: Math.round(mean(precip) * 10) / 10,
    wetShare: Math.round((precip.filter((value) => value >= 1).length / precip.length) * 100),
    sunHours: sun.length === 0 ? null : Math.round((mean(sun) / 3600) * 10) / 10,
    daylightMin: daylight(start, end, data.place),
    firstYear: Math.min(...years),
    lastYear: Math.max(...years),
  };
}

/** Średnia długość dnia (minuty) w terminie, liczona lokalnie. */
export function daylight(start: string, end: string, place: { lat: number; lng: number }): number | null {
  const lengths: number[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const sun = sunTimes(date, place.lat, place.lng);
    if (sun.sunrise === null || sun.sunset === null) return null;
    lengths.push((sun.sunset - sun.sunrise) / 60_000);
  }
  return lengths.length === 0 ? null : Math.round(mean(lengths));
}

const decimal = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 1 });

/** „śr. 9–17°C · opad w 30% dni (śr. 1,8 mm) · słońce 6,2 h · dzień 10 h 05 min”. */
export function climateLine(climate: Climate): string {
  const parts = [`śr. ${climate.tMin}–${climate.tMax}°C`, `opad w ${climate.wetShare}% dni (śr. ${decimal(climate.precipMm)} mm)`];
  if (climate.sunHours !== null) parts.push(`słońce ${decimal(climate.sunHours)} h`);
  if (climate.daylightMin !== null) parts.push(`dzień ${Math.floor(climate.daylightMin / 60)} h ${String(climate.daylightMin % 60).padStart(2, '0')} min`);
  return parts.join(' · ');
}

/** „średnia z lat 2016–2025”. */
export const climateYearsText = (climate: Climate) => (climate.firstYear === climate.lastYear ? `z roku ${climate.firstYear}` : `średnia z lat ${climate.firstYear}–${climate.lastYear}`);

/**
 * Miejsce po nazwie (geokoder Open-Meteo, dane GeoNames CC BY) — gdy plan nie ma jeszcze miejsc ze
 * współrzędnymi, np. w kreatorze briefu. Tylko do klimatu: wynik nie jest zapisywany.
 */
export async function geocodeClimatePlace(query: string, options: { countryCode?: string; fetchImpl?: typeof fetch } = {}): Promise<ClimatePlace | null> {
  const name = query.trim();
  if (name.length < 2) return null;
  const country = options.countryCode && /^[A-Z]{2}$/i.test(options.countryCode) ? `&countryCode=${options.countryCode.toUpperCase()}` : '';
  const response = await (options.fetchImpl ?? fetch)(`${OPEN_METEO_GEOCODING}?name=${encodeURIComponent(name)}&count=1&language=pl&format=json${country}`);
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string }[] };
  const hit = body.results?.[0];
  return hit === undefined ? null : { lat: hit.latitude, lng: hit.longitude, name: hit.country ? `${hit.name} (${hit.country})` : hit.name, geonames: true };
}
