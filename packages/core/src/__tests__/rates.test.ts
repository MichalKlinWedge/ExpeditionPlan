import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { budgetSummary } from '../budget.ts';
import { fetchRates, mergeRates, rebaseRates, staleCurrencies, tripCurrencies } from '../rates.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

describe('kursy walut', () => {
  it('waluty obce wyjazdu bez bazowej, z wydatków też', () => {
    const currencies = tripCurrencies(maroko, ['EUR']);
    expect(currencies).toContain('MAD');
    expect(currencies).toContain('EUR');
    expect(currencies).not.toContain(maroko.trip.baseCurrency);
  });

  it('Frankfurter v2: odwrotność kursu jako rateToBase, z datą', async () => {
    let url = '';
    const fake = (async (input: string) => {
      url = input;
      return new Response(JSON.stringify([{ date: '2026-11-02', base: 'PLN', quote: 'MAD', rate: 2.494 }]));
    }) as unknown as typeof fetch;
    const rates = await fetchRates('PLN', ['MAD'], fake);
    expect(url).toContain('/v2/rates?base=PLN&quotes=MAD');
    expect(rates).toEqual([{ currency: 'MAD', rateToBase: 0.400962, date: '2026-11-02' }]);
  });

  it('scalanie i wykrywanie nieaktualnych kursów', () => {
    const merged = mergeRates([{ currency: 'EUR', rateToBase: 4.3 }, { currency: 'MAD', rateToBase: 0.39, date: '2026-10-01' }], [{ currency: 'MAD', rateToBase: 0.4, date: '2026-11-02' }]);
    expect(merged).toEqual([{ currency: 'EUR', rateToBase: 4.3 }, { currency: 'MAD', rateToBase: 0.4, date: '2026-11-02' }]);
    expect(staleCurrencies(merged, ['EUR', 'MAD', 'GEL'], '2026-11-05')).toEqual(['EUR', 'GEL']);
  });

  it('zmiana waluty wyjazdu: kursy przez nową walutę, dawna dostaje kurs, a nowa go traci', () => {
    const fx = [{ currency: 'EUR', rateToBase: 4.3, date: '2026-11-02' }, { currency: 'MAD', rateToBase: 0.43, date: '2026-10-01' }, { currency: 'USD', rateToBase: 3.9 }];
    expect(rebaseRates(fx, 'PLN', 'EUR')).toEqual([
      { currency: 'MAD', rateToBase: 0.1, date: '2026-10-01' },
      { currency: 'PLN', rateToBase: 0.232558, date: '2026-11-02' },
      { currency: 'USD', rateToBase: 0.906977 },
    ]);
    expect(rebaseRates(fx, 'PLN', 'PLN')).toEqual(fx);
    expect(rebaseRates(fx, 'PLN', 'GBP')).toBeNull();
  });

  it('podsumowanie budżetu po zmianie waluty wychodzi to samo, tylko w nowej walucie', () => {
    const plan = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
    const before = budgetSummary(plan);
    const fx = rebaseRates(mergeRates(plan.trip.fx, [{ currency: 'GBP', rateToBase: 5 }]), plan.trip.baseCurrency, 'GBP')!;
    const after = budgetSummary({ ...plan, trip: { ...plan.trip, baseCurrency: 'GBP', fx } });
    expect(after.currency).toBe('GBP');
    expect(after.unconverted).toEqual({});
    expect(after.totalHighMinor / (before.totalHighMinor / 5)).toBeCloseTo(1, 3);
  });
});
