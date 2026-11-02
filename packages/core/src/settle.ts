/**
 * Rozliczenie wydatków wyjazdu („kto komu ile”) w walucie bazowej. Wiersze z bazy po id
 * (telefon i web mają je tak samo): uczestnicy, wydatki, podziały (`expense_splits`) i wykonane
 * przelewy (`settlements`). Zasady:
 * - wydatek bez podziału dzieli się równo na wszystkich uczestników, z podziałem — na wskazanych (wagi);
 * - udział dziecka (uczestnik z opiekunem) liczy się do opiekuna;
 * - `households` — strony to rodziny (`household`), uczestnik bez rodziny jest stroną sam;
 * - wydatek bez płacącego albo bez kursu nie wchodzi do rozliczenia (lista „do uzupełnienia”);
 * - przelewy: zachłannie, największy dłużnik → największy wierzyciel (najwyżej n−1 przelewów).
 */

export type SettleTraveler = { id: string; name: string; household?: string | null; guardianId?: string | null };
export type SettleExpense = { id: string; payerId: string | null; amountMinor: number; currency: string; note?: string | null };
export type SettleSplit = { expenseId: string; travelerId: string; weight?: number | null };
export type SettlePayment = { fromId: string; toId: string; amountMinor: number; currency: string };

export type Party = { key: string; name: string; members: string[]; paidMinor: number; shareMinor: number; balanceMinor: number };
export type Transfer = { from: Party; to: Party; amountMinor: number };
export type Settlement = { parties: Party[]; transfers: Transfer[]; skipped: { expense: SettleExpense; reason: 'no_payer' | 'no_rate' | 'no_people' }[] };

/** Podział kwoty na wagi w groszach — reszta z zaokrągleń trafia do pierwszych stron. */
function divide(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const parts = weights.map((weight) => Math.floor((amount * weight) / total));
  let rest = amount - parts.reduce((sum, part) => sum + part, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i]! += 1;
  return parts;
}

export function settle(input: {
  travelers: SettleTraveler[];
  expenses: SettleExpense[];
  splits: SettleSplit[];
  payments: SettlePayment[];
  /** Kwota w walucie bazowej albo `null`, gdy brak kursu. */
  toBase: (amountMinor: number, currency: string) => number | null;
  households?: boolean;
}): Settlement {
  const byId = new Map(input.travelers.map((traveler) => [traveler.id, traveler]));
  // Dziecko rozlicza opiekun (jeden poziom — opiekun opiekuna nie istnieje w planach).
  const payerOf = (id: string) => byId.get(id)?.guardianId ?? id;
  const partyOf = (id: string) => {
    const person = byId.get(payerOf(id));
    return input.households && person?.household ? `h:${person.household}` : `p:${payerOf(id)}`;
  };
  const parties = new Map<string, Party>();
  const party = (id: string) => {
    const key = partyOf(id);
    let found = parties.get(key);
    if (found === undefined) {
      const person = byId.get(payerOf(id));
      found = { key, name: key.startsWith('h:') ? key.slice(2) : (person?.name ?? '?'), members: [], paidMinor: 0, shareMinor: 0, balanceMinor: 0 };
      parties.set(key, found);
    }
    if (!found.members.includes(id)) found.members.push(id);
    return found;
  };
  for (const traveler of input.travelers) party(traveler.id);

  const skipped: Settlement['skipped'] = [];
  for (const expense of input.expenses) {
    if (expense.payerId === null || !byId.has(expense.payerId)) {
      skipped.push({ expense, reason: 'no_payer' });
      continue;
    }
    const base = input.toBase(expense.amountMinor, expense.currency);
    if (base === null) {
      skipped.push({ expense, reason: 'no_rate' });
      continue;
    }
    const own = input.splits.filter((split) => split.expenseId === expense.id && byId.has(split.travelerId));
    const people = own.length > 0 ? own.map((split) => ({ id: split.travelerId, weight: split.weight ?? 1 })) : input.travelers.map((traveler) => ({ id: traveler.id, weight: 1 }));
    if (people.length === 0 || people.every((each) => each.weight <= 0)) {
      skipped.push({ expense, reason: 'no_people' });
      continue;
    }
    party(expense.payerId).paidMinor += base;
    divide(base, people.map((each) => Math.max(each.weight, 0))).forEach((share, i) => (party(people[i]!.id).shareMinor += share));
  }

  for (const each of parties.values()) each.balanceMinor = each.paidMinor - each.shareMinor;
  for (const payment of input.payments) {
    const base = input.toBase(payment.amountMinor, payment.currency);
    if (base === null || !byId.has(payment.fromId) || !byId.has(payment.toId)) continue;
    party(payment.fromId).balanceMinor += base;
    party(payment.toId).balanceMinor -= base;
  }

  const list = [...parties.values()].filter((each) => each.paidMinor !== 0 || each.shareMinor !== 0 || each.balanceMinor !== 0);
  const debtors = list.filter((each) => each.balanceMinor < 0).map((each) => ({ party: each, left: -each.balanceMinor }));
  const creditors = list.filter((each) => each.balanceMinor > 0).map((each) => ({ party: each, left: each.balanceMinor }));
  const transfers: Transfer[] = [];
  for (;;) {
    debtors.sort((a, b) => b.left - a.left);
    creditors.sort((a, b) => b.left - a.left);
    const debtor = debtors[0];
    const creditor = creditors[0];
    // Grosze z zaokrągleń nie robią przelewu.
    if (debtor === undefined || creditor === undefined || debtor.left < 1 || creditor.left < 1) break;
    const amount = Math.min(debtor.left, creditor.left);
    transfers.push({ from: debtor.party, to: creditor.party, amountMinor: amount });
    debtor.left -= amount;
    creditor.left -= amount;
    if (debtor.left === 0) debtors.shift();
    if (creditor.left === 0) creditors.shift();
  }
  return { parties: list.sort((a, b) => b.balanceMinor - a.balanceMinor), transfers, skipped };
}
