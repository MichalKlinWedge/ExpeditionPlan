import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { flightLine, flightOf } from '../booking-info.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

describe('lot przy punkcie planu', () => {
  it('linia, numer, lotniska, bagaż i kod w jednej linijce', () => {
    const booking = { ...maroko.bookings.find((each) => each.ref === 'lot-powrot')!, confirmationCode: 'ABC123' };
    expect(flightLine({ ...booking, flight: { ...booking.flight, number: 'FR 2146' } })).toBe('Ryanair FR 2146 · Agadir Al Massira → Wrocław · bagaż: Jak w locie tam. · kod ABC123');
  });

  it('punkt odprawy i wylotu wskazuje rezerwację lotu; inne punkty nie', () => {
    const item = (ref: string) => maroko.items.find((each) => each.ref === ref)!;
    expect(flightOf(maroko, item('d1-lotnisko-wro'))?.ref).toBe('lot-tam');
    expect(flightOf(maroko, item('d5-wylot'))?.ref).toBe('lot-powrot');
    expect(flightOf(maroko, item('d1-suki'))).toBeUndefined();
  });

  it('rezerwacja, która nie jest lotem, nie ma linijki lotu', () => {
    expect(flightLine(maroko.bookings.find((each) => each.kind !== 'flight')!)).toBeUndefined();
  });
});
