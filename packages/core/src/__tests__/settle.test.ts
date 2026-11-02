import { describe, expect, it } from 'vitest';

import { settle } from '../settle.ts';

const travelers = [
  { id: 'a', name: 'Ania', household: 'Kowalscy' },
  { id: 'b', name: 'Bartek', household: 'Kowalscy' },
  { id: 'c', name: 'Celina', household: 'Nowakowie' },
  { id: 'k', name: 'Kuba', household: 'Nowakowie', guardianId: 'c' },
];
const pln = (amountMinor: number, currency: string) => (currency === 'PLN' ? amountMinor : currency === 'MAD' ? Math.round(amountMinor * 0.4) : null);

describe('rozliczenie wydatków', () => {
  it('równy podział na wszystkich; dziecko liczy się do opiekuna; jeden przelew', () => {
    const result = settle({ travelers, expenses: [{ id: 'e1', payerId: 'a', amountMinor: 40000, currency: 'PLN' }], splits: [], payments: [], toBase: pln });
    const by = Object.fromEntries(result.parties.map((party) => [party.name, party.balanceMinor]));
    // 400 zł na 4 osoby: Ania zapłaciła, Bartek 100 zł, Celina 100 zł za siebie i 100 zł za Kubę.
    expect(by).toEqual({ Ania: 30000, Bartek: -10000, Celina: -20000 });
    expect(result.transfers.map((each) => [each.from.name, each.to.name, each.amountMinor])).toEqual([
      ['Celina', 'Ania', 20000],
      ['Bartek', 'Ania', 10000],
    ]);
  });

  it('podział na wskazanych z wagami, waluta obca, wydatek bez płacącego i bez kursu pominięty', () => {
    const result = settle({
      travelers,
      expenses: [
        { id: 'e1', payerId: 'c', amountMinor: 30000, currency: 'MAD' },
        { id: 'e2', payerId: null, amountMinor: 100, currency: 'PLN' },
        { id: 'e3', payerId: 'a', amountMinor: 100, currency: 'GEL' },
      ],
      splits: [
        { expenseId: 'e1', travelerId: 'a', weight: 2 },
        { expenseId: 'e1', travelerId: 'c', weight: 1 },
      ],
      payments: [],
      toBase: pln,
    });
    // 300 MAD = 120 zł: Ania 80 zł, Celina 40 zł.
    expect(result.transfers.map((each) => [each.from.name, each.to.name, each.amountMinor])).toEqual([['Ania', 'Celina', 8000]]);
    expect(result.skipped.map((each) => each.reason)).toEqual(['no_payer', 'no_rate']);
  });

  it('rodzinami i z wykonanym przelewem — saldo zero, bez przelewów', () => {
    const base = { travelers, expenses: [{ id: 'e1', payerId: 'a', amountMinor: 40000, currency: 'PLN' }], splits: [], toBase: pln, households: true };
    const before = settle({ ...base, payments: [] });
    expect(before.transfers.map((each) => [each.from.name, each.to.name, each.amountMinor])).toEqual([['Nowakowie', 'Kowalscy', 20000]]);
    const after = settle({ ...base, payments: [{ fromId: 'c', toId: 'a', amountMinor: 20000, currency: 'PLN' }] });
    expect(after.transfers).toEqual([]);
  });
});
