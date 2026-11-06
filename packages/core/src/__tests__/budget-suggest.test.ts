import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bookingAmount, budgetSuggestions, nightsBetween } from '../budget-suggest.ts';
import { documentProblem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);

describe('budżet z rezerwacji i cen punktów', () => {
  it('Maroko: rezerwacje mają już pozycje; propozycje to punkty z ceną bez pozycji', () => {
    const suggestions = budgetSuggestions(maroko);
    expect(suggestions.filter((each) => each.source === 'booking')).toEqual([]);
    const items = suggestions.filter((each) => each.source === 'item').map((each) => each.ref);
    expect(items).toEqual(expect.arrayContaining(['d2-medersa', 'd2-bahia', 'd4-kozy']));
    // Sandboarding ma pozycję (itemRef) — nie wraca jako propozycja.
    expect(items).not.toContain('d4-sandboard');
    // Bilet za osobę: kwota dla całej piątki.
    const medersa = suggestions.find((each) => each.ref === 'd2-medersa')!;
    expect(medersa.line.lowMinor).toBeGreaterThan(maroko.items.find((each) => each.ref === 'd2-medersa')!.price!.minMinor);
    expect(medersa.line.itemRef).toBe('d2-medersa');
  });

  it('punkt tylko dla części osób: propozycja dotyczy tych osób, a cały punkt nie ma wyboru', () => {
    const who = [maroko.travelers[0]!.ref];
    const doc = TripDocument.parse({ ...maroko, items: maroko.items.map((each) => (each.ref === 'd2-medersa' ? { ...each, participantRefs: who } : each)) });
    const suggestions = budgetSuggestions(doc);
    expect(suggestions.find((each) => each.ref === 'd2-medersa')!.line.participantRefs).toEqual(who);
    expect(suggestions.find((each) => each.ref === 'd2-bahia')!.line.participantRefs).toBeUndefined();
  });

  it('nocleg za noc razy noce, zapłacona kwota wygrywa z ceną; propozycja przechodzi walidację', () => {
    expect(nightsBetween('2026-12-26', '2026-12-29')).toBe(3);
    expect(nightsBetween(undefined, '2026-12-29')).toBe(1);
    const booking: TripDocument['bookings'][number] = {
      ...maroko.bookings.find((each) => each.ref === 'nocleg-perla')!,
      ref: 'nowy-nocleg',
      status: 'to_book',
      paid: undefined,
      price: { currency: 'PLN', basis: 'per_night', minMinor: 30_000, maxMinor: 36_000, from: false, approx: false },
      start: { date: '2026-12-26', precision: 'exact', tz: 'Africa/Casablanca' },
      end: { date: '2026-12-29', precision: 'exact', tz: 'Africa/Casablanca' },
    };
    const doc: TripDocument = { ...maroko, bookings: [...maroko.bookings, booking] };
    expect(bookingAmount(doc, booking)).toEqual({ lowMinor: 90_000, highMinor: 108_000, currency: 'PLN', note: '3 × noc' });
    const suggestion = budgetSuggestions(doc).find((each) => each.ref === 'nowy-nocleg')!;
    expect(suggestion.line).toMatchObject({ category: 'lodging', status: 'estimate', bookingRef: 'nowy-nocleg' });
    const withLine: TripDocument = { ...doc, budgetLines: [...doc.budgetLines, { ...suggestion.line, ref: 'l-nowy' }] };
    expect(documentProblem(withLine)).toBeNull();
    expect(budgetSuggestions(withLine).some((each) => each.ref === 'nowy-nocleg')).toBe(false);
    expect(bookingAmount(doc, { ...booking, paid: { amountMinor: 85_000, currency: 'PLN' } })).toEqual({ lowMinor: 85_000, highMinor: 85_000, currency: 'PLN' });
  });
});
