import type { TripDocument } from './schemas/trip-document.ts';
import { vehicleTravelers } from './vehicles.ts';

/**
 * Budżet wyjazdu (SPECYFIKACJA §5, MVP-3): „zapłacone / do wydania” z pozycji budżetu i portfel
 * (wydatki rzeczywiste z telefonu). Kwoty w walucie bazowej wyjazdu po kursach z `trip.fx`;
 * waluta bez kursu trafia do `unconverted`, zamiast cicho zniknąć z sumy.
 */

type Doc = TripDocument;

export type MoneyByCurrency = Record<string, number>;

export type CategoryTotal = { category: string; paidMinor: number; lowMinor: number; highMinor: number };

export type TravelerShare = { ref: string; name: string; lowMinor: number; highMinor: number };

export type BudgetSummary = {
  currency: string;
  paidMinor: number;
  /** Do wydania: pozycje szacowane i zobowiązania — scenariusz oszczędny … wygodny. */
  toSpendLowMinor: number;
  toSpendHighMinor: number;
  totalLowMinor: number;
  totalHighMinor: number;
  /** Całość na osobę, oszczędnie … wygodnie; `null`, gdy nie ma osób albo każdemu wypada co innego (wtedy `perTraveler`). */
  perPersonLowMinor: number | null;
  perPersonHighMinor: number | null;
  /** Ile wypada na każdego uczestnika; pozycja bez wyboru osób dzieli się na wszystkich. */
  perTraveler: TravelerShare[];
  byCategory: CategoryTotal[];
  /** Kwoty w walutach bez kursu w `trip.fx` — pokazane osobno. */
  unconverted: MoneyByCurrency;
};

/** Kwota w walucie bazowej albo `null`, gdy brak kursu. */
export function toBase(doc: Doc, amountMinor: number, currency: string): number | null {
  if (currency === doc.trip.baseCurrency) return amountMinor;
  const rate = doc.trip.fx.find((each) => each.currency === currency)?.rateToBase;
  return rate === undefined ? null : Math.round(amountMinor * rate);
}

/** Kogo dotyczy pozycja budżetu: osoby auta (`vehicleRef`), wybrane osoby, a bez wyboru wszyscy uczestnicy (kolejność z planu). */
export function lineTravelers(doc: Doc, line: Doc['budgetLines'][number]): string[] {
  // Koszt auta (paliwo, winiety) dzielą osoby tego auta; auto jeszcze bez osób liczy się jak bez wyboru.
  const car = vehicleTravelers(doc, line.vehicleRef);
  const chosen = car.length > 0 ? car : (line.participantRefs ?? []);
  return doc.travelers.filter((traveler) => chosen.length === 0 || chosen.includes(traveler.ref)).map((traveler) => traveler.ref);
}

/** Imiona osób pozycji; `null`, gdy dotyczy wszystkich. */
export function lineTravelerNames(travelers: readonly { ref: string; name: string }[], line: { participantRefs?: string[] | undefined }): string[] | null {
  const chosen = travelers.filter((traveler) => line.participantRefs?.includes(traveler.ref));
  return chosen.length === 0 || chosen.length === travelers.length ? null : chosen.map((traveler) => traveler.name);
}

export function budgetSummary(doc: Doc): BudgetSummary {
  const people = doc.travelers.length;
  const summary: BudgetSummary = {
    currency: doc.trip.baseCurrency,
    paidMinor: 0,
    toSpendLowMinor: 0,
    toSpendHighMinor: 0,
    totalLowMinor: 0,
    totalHighMinor: 0,
    perPersonLowMinor: null,
    perPersonHighMinor: null,
    perTraveler: [],
    byCategory: [],
    unconverted: {},
  };
  const categories = new Map<string, CategoryTotal>();
  const shares = new Map(doc.travelers.map((traveler) => [traveler.ref, { low: 0, high: 0 }]));
  for (const line of doc.budgetLines) {
    const refs = lineTravelers(doc, line);
    const times = line.perPerson ? Math.max(refs.length, 1) : 1;
    const low = toBase(doc, line.lowMinor * times, line.currency);
    const high = toBase(doc, line.highMinor * times, line.currency);
    if (low === null || high === null) {
      summary.unconverted[line.currency] = (summary.unconverted[line.currency] ?? 0) + line.highMinor * times;
      continue;
    }
    const category = categories.get(line.category) ?? { category: line.category, paidMinor: 0, lowMinor: 0, highMinor: 0 };
    categories.set(line.category, category);
    if (line.status === 'paid') {
      summary.paidMinor += low;
      category.paidMinor += low;
    } else {
      summary.toSpendLowMinor += low;
      summary.toSpendHighMinor += high;
    }
    category.lowMinor += low;
    category.highMinor += high;
    // Zapłacona pozycja ma jedną kwotę: tę, którą doliczają też sumy wyżej.
    for (const ref of refs) {
      const share = shares.get(ref)!;
      share.low += low / refs.length;
      share.high += (line.status === 'paid' ? low : high) / refs.length;
    }
  }
  summary.totalLowMinor = summary.paidMinor + summary.toSpendLowMinor;
  summary.totalHighMinor = summary.paidMinor + summary.toSpendHighMinor;
  summary.perTraveler = doc.travelers.map((traveler) => {
    const share = shares.get(traveler.ref)!;
    return { ref: traveler.ref, name: traveler.name, lowMinor: Math.round(share.low), highMinor: Math.round(share.high) };
  });
  // Grosze z zaokrągleń nie robią różnicy między osobami.
  const even = (values: number[]) => Math.max(...values) - Math.min(...values) <= 1;
  if (people > 0 && even(summary.perTraveler.map((each) => each.lowMinor)) && even(summary.perTraveler.map((each) => each.highMinor))) {
    summary.perPersonLowMinor = Math.round(summary.totalLowMinor / people);
    summary.perPersonHighMinor = Math.round(summary.totalHighMinor / people);
  }
  summary.byCategory = [...categories.values()].sort((a, b) => b.highMinor - a.highMinor);
  return summary;
}

export type WalletExpense = { amountMinor: number; currency: string; category?: string };

export type WalletSummary = { currency: string; spentMinor: number; count: number; byCategory: Record<string, number>; unconverted: MoneyByCurrency };

/** Portfel: wydatki zapisane w trakcie wyjazdu, w walucie bazowej. */
export function walletSummary(doc: Doc, expenses: WalletExpense[]): WalletSummary {
  const wallet: WalletSummary = { currency: doc.trip.baseCurrency, spentMinor: 0, count: expenses.length, byCategory: {}, unconverted: {} };
  for (const expense of expenses) {
    const base = toBase(doc, expense.amountMinor, expense.currency);
    if (base === null) {
      wallet.unconverted[expense.currency] = (wallet.unconverted[expense.currency] ?? 0) + expense.amountMinor;
      continue;
    }
    wallet.spentMinor += base;
    const category = expense.category ?? 'other';
    wallet.byCategory[category] = (wallet.byCategory[category] ?? 0) + base;
  }
  return wallet;
}

/** „7 519,30 zł” — kwota w jednostkach drobnych z kodem waluty. */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pl-PL', { style: 'currency', currency, maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
}

/** „1000 zł” albo „1000 zł – 2000 zł”. */
export const formatMoneyRange = (minMinor: number, maxMinor: number, currency: string): string =>
  minMinor === maxMinor ? formatMoney(minMinor, currency) : `${formatMoney(minMinor, currency)} – ${formatMoney(maxMinor, currency)}`;

/** Kwota do pola formularza: 1200 → „12”, 127050 → „1270,50”. Odwrotność `parseMoney`. */
export const moneyToInput = (amountMinor: number): string => (amountMinor / 100).toFixed(amountMinor % 100 === 0 ? 0 : 2).replace('.', ',');

/** „1 270,50” → 127050; `null` przy nieprawidłowej kwocie. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Kategorie budżetu i wydatków (kolumna `category`). */
export const BUDGET_CATEGORY: Record<string, string> = {
  flights: 'loty',
  lodging: 'noclegi',
  car: 'auto',
  fuel: 'paliwo',
  tolls_parking: 'opłaty, parkingi',
  tickets: 'bilety, wstępy',
  activities: 'atrakcje',
  food: 'jedzenie',
  luggage: 'bagaż',
  insurance: 'ubezpieczenie',
  transport: 'transport',
  other: 'inne',
};
