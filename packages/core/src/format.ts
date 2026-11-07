/**
 * Wspólne formatowanie napisów: odmiana po liczbie, dystans i daty kalendarzowe. Daty liczą się
 * w UTC z południa, bo to daty z planu (bez strefy), a nie chwile w czasie.
 */

/** Forma rzeczownika po liczbie: 1, 2–4 (22, 103…), 5+ (także 12–14 i 0). */
export function pluralForm(count: number, [one, few, many]: readonly [string, string, string]): string {
  const abs = Math.abs(count);
  const tens = abs % 100;
  const ones = abs % 10;
  if (abs === 1) return one;
  return ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? few : many;
}

/** Liczba z odmienionym rzeczownikiem: `plural(2, ["zmiana", "zmiany", "zmian"])` → „2 zmiany”. */
export const plural = (count: number, forms: readonly [string, string, string]): string => `${count} ${pluralForm(count, forms)}`;

/** „63,6 km”, „120 km”: poniżej 10 km jedno miejsce po przecinku, wyżej całe kilometry. */
export const formatKm = (value: number): string => `${value.toLocaleString('pl-PL', { maximumFractionDigits: value < 10 ? 1 : 0 })} km`;

const planDate = (date: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('pl-PL', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** Pierwsza litera wielka: dla etykiety stojącej na początku wiersza. */
export const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** „sobota, 5 grudnia”. */
export const dayLabel = (date: string): string => planDate(date, { weekday: 'long', day: 'numeric', month: 'long' });

/** „sob., 5 grudnia”. */
export const dayLabelShort = (date: string): string => planDate(date, { weekday: 'short', day: 'numeric', month: 'long' });

/** „sob., 5.12”: krótka etykieta dnia na chipach i w listach wyboru. */
export const dayChip = (date: string): string => planDate(date, { weekday: 'short', day: 'numeric', month: 'numeric' });

/** „5 grudnia”. */
export const dayMonth = (date: string): string => planDate(date, { day: 'numeric', month: 'long' });

/** „5 gru”. */
export const shortDate = (date: string): string => planDate(date, { day: 'numeric', month: 'short' });
