import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { budgetPace } from '../budget-pace.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('budżet dzień po dniu', () => {
  const maroko = load('maroko');
  const expenses = [
    // 500 MAD × 0,43 = 215 zł pierwszego dnia (data zapłaty w strefie wyjazdu).
    { amountMinor: 50000, currency: 'MAD', category: 'food', paidAt: '2026-12-26T13:00:00Z' },
    // Sandboard przypięty do punktu dnia 4 — dzień z punktu, nie z daty.
    { amountMinor: 10000, currency: 'EUR', category: 'activities', paidAt: '2026-12-26T20:00:00Z', itemRef: 'd4-sandboard' },
    // Przed wyjazdem — poza dniami planu.
    { amountMinor: 5000, currency: 'USD', category: 'luggage', paidAt: '2026-12-20T10:00:00Z' },
  ];
  const pace = budgetPace(maroko, expenses, '2026-12-27');

  it('plan dnia = pozycje dnia + równa część wspólnych; zapłacone przed wyjazdem pominięte', () => {
    expect(pace.days).toHaveLength(5);
    expect(pace.days[0]).toMatchObject({ dayRef: 'd1', plannedHighMinor: 102500, spentMinor: 21500, over: false });
    expect(pace.days[3]).toMatchObject({ dayRef: 'd4', plannedHighMinor: 145500, spentMinor: 43000 });
    expect(pace.plannedHighMinor).toBe(555500);
  });

  it('wydatki poza dniami, tempo i prognoza na koniec', () => {
    expect(pace.outsideMinor).toBe(18250);
    expect(pace.spentMinor).toBe(82750);
    expect(pace.elapsedDays).toBe(2);
    expect(pace.forecastMinor).toBe(82750 + (64500 / 2) * 3);
    expect(budgetPace(maroko, expenses, '2026-12-01').forecastMinor).toBeNull();
  });

  it('kategoria ponad plan', () => {
    const luggage = pace.categories.find((each) => each.category === 'luggage');
    expect(luggage).toMatchObject({ plannedHighMinor: 40000, spentMinor: 18250, over: false });
    const big = budgetPace(maroko, [{ amountMinor: 500000, currency: 'PLN', category: 'tolls_parking', paidAt: '2026-12-27T10:00:00Z' }], '2026-12-27');
    expect(big.categories.find((each) => each.category === 'tolls_parking')?.over).toBe(true);
    expect(big.days[1]?.over).toBe(true);
  });

  it('waluta bez kursu osobno', () => {
    expect(budgetPace(maroko, [{ amountMinor: 1000, currency: 'GBP', paidAt: '2026-12-27T10:00:00Z' }], '2026-12-27').unconverted).toEqual({ GBP: 1000 });
  });

  it('pozycja „na osobę” dla części osób liczy się razy te osoby, a nie wszyscy', () => {
    const [a, b] = maroko.travelers.map((traveler) => traveler.ref);
    const line = { ref: 'dla-dwoch', category: 'food', title: 'Kolacja', status: 'estimate', lowMinor: 1000, highMinor: 1000, currency: maroko.trip.baseCurrency, perPerson: true } as const;
    const planned = (extra: { participantRefs?: string[] }) => budgetPace({ ...maroko, budgetLines: [{ ...line, ...extra }] }, [], '2026-12-27').plannedHighMinor;
    expect(planned({})).toBe(1000 * maroko.travelers.length);
    expect(planned({ participantRefs: [a!, b!] })).toBe(2000);
  });
});
