import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { budgetSummary, formatMoney, parseMoney, TripDocument, walletSummary } from '../index.ts';

const load = (slug: string) =>
  TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('budżet: zapłacone / do wydania', () => {
  it('Maroko: 7 519 zł zapłacone, ~3 915–5 555 zł do wydania (kryterium odbioru MVP-3)', () => {
    const summary = budgetSummary(load('maroko'));
    expect(summary.currency).toBe('PLN');
    expect(summary.paidMinor).toBe(751_930);
    expect(summary.toSpendLowMinor).toBe(391_500);
    expect(summary.toSpendHighMinor).toBe(555_500);
    expect(summary.totalHighMinor).toBe(751_930 + 555_500);
    expect(summary.byCategory[0]?.category).toBe('flights');
    expect(summary.unconverted).toEqual({});
  });

  it('pozycja „na osobę” liczy się razy liczba uczestników', () => {
    const doc = load('dinara');
    const summary = budgetSummary(doc);
    // Samolot 400 zł na osobę × 5 + reszta 1340 zł.
    expect(summary.toSpendLowMinor).toBe(40_000 * doc.travelers.length + 134_000);
    expect(summary.perPersonLowMinor).toBe(Math.round(summary.totalLowMinor / doc.travelers.length));
  });

  it('portfel przelicza po kursie z planu, waluta bez kursu zostaje osobno', () => {
    const doc = load('maroko');
    const wallet = walletSummary(doc, [
      { amountMinor: 10_000, currency: 'MAD', category: 'food' },
      { amountMinor: 5_000, currency: 'PLN', category: 'food' },
      { amountMinor: 2_000, currency: 'GBP' },
    ]);
    expect(wallet.spentMinor).toBe(4_300 + 5_000);
    expect(wallet.byCategory).toEqual({ food: 9_300 });
    expect(wallet.unconverted).toEqual({ GBP: 2_000 });
  });

  it('kwoty: zapis i odczyt', () => {
    expect(parseMoney('1 270,50')).toBe(127_050);
    expect(parseMoney('45')).toBe(4_500);
    expect(parseMoney('abc')).toBeNull();
    // Polska norma nie grupuje liczb czterocyfrowych („7519”), pięciocyfrowe już tak.
    expect(formatMoney(751_930, 'PLN').replace(/\s/g, ' ')).toBe('7519,30 zł');
    expect(formatMoney(1_200_000, 'PLN').replace(/\s/g, ' ')).toBe('12 000 zł');
  });
});
