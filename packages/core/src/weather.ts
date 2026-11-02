import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Prognoza pogody dla dni wyjazdu: Open-Meteo (docs/USLUGI.md — tylko niekomercyjnie, CC BY 4.0,
 * horyzont do 16 dni). Jedno zapytanie dla wszystkich miejsc (lista współrzędnych). Wywołuje
 * przeglądarka i telefon — limit liczy się per IP. Dzień ma miejsce: bazę noclegową, inaczej
 * pierwsze miejsce dnia ze współrzędnymi, inaczej miejsce z dnia poprzedniego.
 */

type Doc = TripDocument;
export type DayWeather = { date: string; tMin: number; tMax: number; precipMm: number; precipProb: number | null; windKmh: number; code: number };
export type WeatherPoint = { dayRef: string; date: string; lat: number; lng: number };

export const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
export const WEATHER_ATTRIBUTION = 'Pogoda: Open-Meteo.com (CC BY 4.0)';
/** Open-Meteo prognozuje do 16 dni naprzód (dziś + 15). */
export const FORECAST_DAYS = 16;

export function weatherPoints(doc: Doc): WeatherPoint[] {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const located = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : places.get(ref);
    return place?.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : undefined;
  };
  const points: WeatherPoint[] = [];
  let last: { lat: number; lng: number } | undefined;
  for (const day of [...doc.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const items = doc.items.filter((item) => item.dayRef === day.ref).sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
    const here = located(day.baseRef) ?? items.map((item) => located(item.placeRef)).find((each) => each !== undefined) ?? last;
    if (here === undefined) continue;
    last = here;
    points.push({ dayRef: day.ref, date: day.date, lat: here.lat, lng: here.lng });
  }
  return points;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Daily = {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: (number | null)[];
  wind_speed_10m_max: number[];
  weather_code: number[];
};

/** Prognoza dla dni w horyzoncie (od `today` do `today + 15`); dni dalsze nie są w wyniku. */
export async function fetchWeather(points: readonly WeatherPoint[], today: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, DayWeather>> {
  const last = addDays(today, FORECAST_DAYS - 1);
  const wanted = points.filter((point) => point.date >= today && point.date <= last);
  if (wanted.length === 0) return {};
  // Jedno miejsce = jedna lokalizacja w zapytaniu (współrzędne do ok. 1 km).
  const key = (point: WeatherPoint) => `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
  const locations = [...new Set(wanted.map(key))];
  const start = wanted.map((point) => point.date).sort()[0]!;
  const end = wanted.map((point) => point.date).sort().at(-1)!;
  const url =
    `${OPEN_METEO}?latitude=${locations.map((each) => each.split(',')[0]).join(',')}&longitude=${locations.map((each) => each.split(',')[1]).join(',')}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code' +
    `&timezone=auto&start_date=${start}&end_date=${end}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Pogoda: HTTP ${response.status}`);
  const body = (await response.json()) as { daily: Daily } | { daily: Daily }[];
  const series = Array.isArray(body) ? body : [body];
  const result: Record<string, DayWeather> = {};
  for (const point of wanted) {
    const daily = series[locations.indexOf(key(point))]?.daily;
    const at = daily?.time.indexOf(point.date) ?? -1;
    if (daily === undefined || at < 0 || daily.temperature_2m_max[at] == null) continue;
    result[point.dayRef] = {
      date: point.date,
      tMin: Math.round(daily.temperature_2m_min[at]!),
      tMax: Math.round(daily.temperature_2m_max[at]!),
      precipMm: Math.round((daily.precipitation_sum[at] ?? 0) * 10) / 10,
      precipProb: daily.precipitation_probability_max[at] ?? null,
      windKmh: Math.round(daily.wind_speed_10m_max[at] ?? 0),
      code: daily.weather_code[at] ?? 0,
    };
  }
  return result;
}

/** Ikona z kodu WMO (0 bezchmurnie … 95+ burza). */
export function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️';
  if (code <= 77 || code === 85 || code === 86) return '🌨️';
  return '⛈️';
}

/** „☀️ 17–24°C · deszcz 2 mm (60%) · wiatr 30 km/h”. */
export function weatherLine(weather: DayWeather): string {
  const rain = weather.precipMm >= 0.5 || (weather.precipProb ?? 0) >= 30 ? ` · deszcz ${weather.precipMm.toLocaleString('pl-PL')} mm${weather.precipProb !== null ? ` (${weather.precipProb}%)` : ''}` : '';
  const wind = weather.windKmh >= 30 ? ` · wiatr ${weather.windKmh} km/h` : '';
  return `${weatherIcon(weather.code)} ${weather.tMin}–${weather.tMax}°C${rain}${wind}`;
}

/** Deszczowo albo wietrznie: opad ≥ 2 mm albo szansa ≥ 60%, albo wiatr ≥ 50 km/h. */
export const badWeather = (weather: DayWeather) => weather.precipMm >= 2 || (weather.precipProb ?? 0) >= 60 || weather.windKmh >= 50;

/**
 * Podpowiedź planu B: dzień z grupą wariantów zależną od pogody, a prognoza zła — wskazuje wariant
 * inny niż pierwszy (pierwszy to plan główny, jak w łatce `add_variant`).
 */
export function weatherVariantHint(doc: Doc, dayRef: string, weather: DayWeather | undefined): { group: string; variant: string; variantRef: string; groupRef: string } | null {
  if (weather === undefined || !badWeather(weather)) return null;
  const group = doc.variantGroups.find((each) => each.dayRef === dayRef && each.conditionKind === 'weather');
  if (group === undefined) return null;
  const alternative = doc.variants.filter((variant) => variant.groupRef === group.ref)[1];
  return alternative === undefined ? null : { group: group.title, variant: alternative.label, variantRef: alternative.ref, groupRef: group.ref };
}
