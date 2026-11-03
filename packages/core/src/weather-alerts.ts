import { addDays, zonedToInstant } from './engine/time.ts';
import type { Reminder } from './reminders.ts';
import type { TripDocument } from './schemas/trip-document.ts';
import { badWeather, type DayWeather, weatherLine, weatherVariantHint } from './weather.ts';

/**
 * „Go / no-go” (Etap 10): dzień w najbliższych dwóch dniach z punktami pod gołym niebem i złą
 * prognozą → alert z listą tych punktów i planem B (wariant pogodowy), gdy plan go ma. Dwa dni
 * przed takim dniem telefon przypomina wieczorem, żeby sprawdzić prognozę (powiadomienie lokalne —
 * prognozę liczy dopiero aplikacja po otwarciu).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

/** Pod gołym niebem: oznaczone `outdoor`, a bez oznaczenia — aktywność (szlak, kajak, plaża). */
export const isOutdoor = (item: Item) => item.weather === 'outdoor' || (item.weather === undefined && item.kind === 'activity');

export type WeatherAlert = {
  dayRef: string;
  date: string;
  line: string;
  /** Tytuły punktów pod gołym niebem tego dnia. */
  outdoor: string[];
  hint: ReturnType<typeof weatherVariantHint>;
};

const outdoorTitles = (doc: Doc, dayRef: string) => doc.items.filter((item) => item.dayRef === dayRef && isOutdoor(item)).map((item) => item.title);

/** Alerty dla dni od `today` do `today + horizonDays` (daty dni planu, w ich strefach). */
export function weatherAlerts(doc: Doc, weather: Record<string, DayWeather>, today: string, horizonDays = 2): WeatherAlert[] {
  const last = addDays(today, horizonDays);
  return [...doc.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((day) => {
      const sky = weather[day.ref];
      if (sky === undefined || day.date < today || day.date > last || !badWeather(sky)) return [];
      const outdoor = outdoorTitles(doc, day.ref);
      return outdoor.length === 0 ? [] : [{ dayRef: day.ref, date: day.date, line: weatherLine(sky), outdoor, hint: weatherVariantHint(doc, day.ref, sky) }];
    });
}

const WEEKDAY = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const dayName = (date: string) => `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(date.slice(8))}.${date.slice(5, 7)}`;

/** Przypomnienia „go / no-go” o 19:00 dwa dni przed każdym dniem z punktami pod gołym niebem. */
export function goNoGoReminders(doc: Doc, now: number): Reminder[] {
  return doc.days.flatMap((day) => {
    const outdoor = outdoorTitles(doc, day.ref);
    if (outdoor.length === 0) return [];
    const date = addDays(day.date, -2);
    // Przed wyjazdem — w strefie domowej, w trakcie — w strefie dnia.
    const at = zonedToInstant(date, '19:00', date < doc.trip.startDate ? doc.trip.homeTz : day.tz);
    if (at <= now) return [];
    const list = outdoor.length > 3 ? `${outdoor.slice(0, 3).join(', ')} i ${outdoor.length - 3} więcej` : outdoor.join(', ');
    return [{ key: `weather:${day.ref}`, title: `Pogoda na ${dayName(day.date)}: go / no-go`, body: `Pod gołym niebem: ${list}. Otwórz aplikację — sprawdzę prognozę i plan B.`, at }];
  });
}
