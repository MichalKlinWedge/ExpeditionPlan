import { lineTravelers, toBase, type WalletExpense } from './budget.ts';
import { instantToZoned } from './engine/time.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Budżet w trakcie wyjazdu (Etap 9): plan „do wydania” kontra wydatki z portfela — dzień po dniu
 * i w kategoriach — oraz tempo wydawania z prognozą na koniec. Plan dnia = pozycje budżetu
 * przypięte do punktu tego dnia + równa część pozycji bez dnia (jedzenie, paliwo, bilety).
 * Pozycje zapłacone przed wyjazdem nie wchodzą: porównujemy to, co wydaje się na miejscu.
 * Kwoty w walucie bazowej; waluta bez kursu trafia do `unconverted`.
 */

type Doc = TripDocument;

/** Wydatek z portfela z datą zapłaty (ISO) i — gdy jest — punktem planu. */
export type PaceExpense = WalletExpense & { paidAt: string; itemRef?: string };

export type DayPace = {
  dayRef: string;
  date: string;
  /** Plan dnia: pozycje tego dnia + część wspólna, oszczędnie … wygodnie. */
  plannedLowMinor: number;
  plannedHighMinor: number;
  spentMinor: number;
  /** Wydane więcej niż wygodny wariant planu dnia. */
  over: boolean;
};

export type CategoryPace = { category: string; plannedLowMinor: number; plannedHighMinor: number; spentMinor: number; over: boolean };

export type BudgetPace = {
  currency: string;
  days: DayPace[];
  categories: CategoryPace[];
  plannedLowMinor: number;
  plannedHighMinor: number;
  spentMinor: number;
  /** Wydane przed pierwszym albo po ostatnim dniu planu. */
  outsideMinor: number;
  /** Dni planu do dziś włącznie (w strefie dnia). */
  elapsedDays: number;
  /** Prognoza wydatków na koniec przy obecnym tempie; `null` przed pierwszym dniem. */
  forecastMinor: number | null;
  unconverted: Record<string, number>;
};

export function budgetPace(doc: Doc, expenses: readonly PaceExpense[], today: string): BudgetPace {
  const days = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const dayOfItem = new Map(doc.items.map((item) => [item.ref, item.dayRef]));
  const unconverted: Record<string, number> = {};
  const assigned = new Map<string, { low: number; high: number }>();
  const categories = new Map<string, CategoryPace>();
  const category = (key: string) => {
    const found = categories.get(key) ?? { category: key, plannedLowMinor: 0, plannedHighMinor: 0, spentMinor: 0, over: false };
    categories.set(key, found);
    return found;
  };
  let sharedLow = 0;
  let sharedHigh = 0;

  for (const line of doc.budgetLines) {
    if (line.status === 'paid') continue;
    const times = line.perPerson ? Math.max(lineTravelers(doc, line).length, 1) : 1;
    const low = toBase(doc, line.lowMinor * times, line.currency);
    const high = toBase(doc, line.highMinor * times, line.currency);
    if (low === null || high === null) {
      unconverted[line.currency] = (unconverted[line.currency] ?? 0) + line.highMinor * times;
      continue;
    }
    const target = category(line.category);
    target.plannedLowMinor += low;
    target.plannedHighMinor += high;
    const dayRef = line.itemRef === undefined ? undefined : dayOfItem.get(line.itemRef);
    if (dayRef === undefined) {
      sharedLow += low;
      sharedHigh += high;
    } else {
      const sum = assigned.get(dayRef) ?? { low: 0, high: 0 };
      assigned.set(dayRef, { low: sum.low + low, high: sum.high + high });
    }
  }

  const share = (amount: number) => (days.length === 0 ? 0 : amount / days.length);
  const pace: DayPace[] = days.map((day) => ({
    dayRef: day.ref,
    date: day.date,
    plannedLowMinor: Math.round((assigned.get(day.ref)?.low ?? 0) + share(sharedLow)),
    plannedHighMinor: Math.round((assigned.get(day.ref)?.high ?? 0) + share(sharedHigh)),
    spentMinor: 0,
    over: false,
  }));
  const byRef = new Map(pace.map((each) => [each.dayRef, each]));
  const byDate = new Map<string, DayPace>();
  for (const [i, day] of days.entries()) if (!byDate.has(day.date)) byDate.set(day.date, pace[i]!);

  let spent = 0;
  let outside = 0;
  for (const expense of expenses) {
    const base = toBase(doc, expense.amountMinor, expense.currency);
    if (base === null) {
      unconverted[expense.currency] = (unconverted[expense.currency] ?? 0) + expense.amountMinor;
      continue;
    }
    spent += base;
    category(expense.category ?? 'other').spentMinor += base;
    const fromItem = expense.itemRef === undefined ? undefined : byRef.get(dayOfItem.get(expense.itemRef) ?? '');
    const paidAt = Date.parse(expense.paidAt);
    const day = fromItem ?? (Number.isNaN(paidAt) ? undefined : byDate.get(instantToZoned(paidAt, doc.trip.primaryTz).date));
    if (day === undefined) outside += base;
    else day.spentMinor += base;
  }

  for (const day of pace) day.over = day.plannedHighMinor > 0 && day.spentMinor > day.plannedHighMinor;
  for (const each of categories.values()) each.over = each.plannedHighMinor > 0 && each.spentMinor > each.plannedHighMinor;

  const elapsed = pace.filter((day) => day.date <= today).length;
  const inDays = spent - outside;
  return {
    currency: doc.trip.baseCurrency,
    days: pace,
    categories: [...categories.values()].sort((a, b) => Math.max(b.plannedHighMinor, b.spentMinor) - Math.max(a.plannedHighMinor, a.spentMinor)),
    plannedLowMinor: Math.round(sharedLow + [...assigned.values()].reduce((sum, each) => sum + each.low, 0)),
    plannedHighMinor: Math.round(sharedHigh + [...assigned.values()].reduce((sum, each) => sum + each.high, 0)),
    spentMinor: spent,
    outsideMinor: outside,
    elapsedDays: elapsed,
    forecastMinor: elapsed === 0 ? null : Math.round(spent + (inDays / elapsed) * (pace.length - elapsed)),
    unconverted,
  };
}
