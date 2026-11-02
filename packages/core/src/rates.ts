import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Kursy walut wyjazdu: Frankfurter API v2 (docs/USLUGI.md — kursy „blended” banków centralnych,
 * MAD i GEL dostępne, bez klucza; v1 ma tylko kursy EBC). `rateToBase` = ile waluty bazowej za
 * 1 jednostkę obcej („1 MAD = 0,40 zł”), tak jak `trip.fx` w dokumencie.
 */

type Doc = TripDocument;
export type FxRate = Doc['trip']['fx'][number];

export const FRANKFURTER = 'https://api.frankfurter.dev/v2/rates';

/** Waluty obce wyjazdu: z budżetu, rezerwacji, kursów w planie i z wydatków (`extra`). */
export function tripCurrencies(doc: Doc, extra: readonly string[] = []): string[] {
  const all = [
    ...doc.budgetLines.map((line) => line.currency),
    ...doc.bookings.flatMap((booking) => [booking.price?.currency, booking.paid?.currency]),
    ...doc.trip.fx.map((rate) => rate.currency),
    ...extra,
  ];
  return [...new Set(all.filter((currency): currency is string => currency !== undefined && currency !== doc.trip.baseCurrency))].sort();
}

/** Aktualne kursy z Frankfurtera dla `currencies` względem `base`. */
export async function fetchRates(base: string, currencies: readonly string[], fetchImpl: typeof fetch = fetch): Promise<FxRate[]> {
  if (currencies.length === 0) return [];
  const response = await fetchImpl(`${FRANKFURTER}?base=${base}&quotes=${currencies.join(',')}`);
  if (!response.ok) throw new Error(`Kursy walut: HTTP ${response.status}`);
  const rows = (await response.json()) as { date: string; quote: string; rate: number }[];
  // Odpowiedź: 1 waluta bazowa = `rate` waluty obcej — w planie trzymamy odwrotność.
  return rows.filter((row) => row.rate > 0).map((row) => ({ currency: row.quote, rateToBase: Number((1 / row.rate).toPrecision(6)), date: row.date }));
}

/** Nowe kursy zastępują stare dla tych samych walut; pozostałe zostają. */
export function mergeRates(current: readonly FxRate[], fresh: readonly FxRate[]): FxRate[] {
  const byCurrency = new Map(current.map((rate) => [rate.currency, rate]));
  for (const rate of fresh) byCurrency.set(rate.currency, rate);
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Waluty bez kursu albo z kursem starszym niż `maxAgeDays` (względem `today`, RRRR-MM-DD). */
export function staleCurrencies(fx: readonly FxRate[], currencies: readonly string[], today: string, maxAgeDays = 7): string[] {
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
  return currencies.filter((currency) => {
    const rate = fx.find((each) => each.currency === currency);
    return rate === undefined || rate.date === undefined || rate.date < limit;
  });
}
