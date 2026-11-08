import type { AiClient, AskOptions } from '@expeditionplan/ai';
import { describe, expect, it } from 'vitest';

import { BOOKING_TEXT_LIMIT, bookingPrompt, readBooking } from '../booking.ts';

const READING = {
  isBooking: true,
  confirmed: true,
  kind: 'flight',
  title: 'Lot Kraków → Marrakesz',
  provider: 'Ryanair',
  confirmationCode: 'QWE12',
  startDate: '2026-12-26',
  startTime: '06:10',
  startTz: 'Europe/Warsaw',
  endDate: '2026-12-26',
  endTime: '09:55',
  endTz: 'Africa/Casablanca',
  placeName: null,
  address: null,
  currency: 'PLN',
  total: 1890,
  paidAmount: 1890,
  paidDate: null,
  payWhen: 'prepaid',
  paymentMethod: null,
  refundable: false,
  freeCancellationUntil: null,
  adults: 2,
  children: 2,
  includes: [],
  checkInFrom: null,
  checkOutUntil: null,
  flightNumber: 'FR 1234',
  fromAirport: 'KRK',
  toAirport: 'RAK',
  baggage: '1 × 20 kg',
  carClass: null,
  carModel: null,
  kmLimit: null,
  deposit: null,
  fuelPolicy: null,
  officeHours: null,
  rooms: null,
  beds: null,
  breakfast: null,
  contactName: null,
  phone: null,
  email: null,
};

const CONTEXT = { startDate: '2026-12-26', endDate: '2026-12-30', zones: ['Africa/Casablanca', 'Europe/Warsaw'], currencies: ['PLN', 'MAD'] };

function answering(reply: unknown, seen: AskOptions[] = []): AiClient {
  return {
    defaultProvider: 'GEMINI',
    ask: async (_prompt, options) => {
      seen.push(options ?? {});
      return { text: JSON.stringify(reply), provider: 'GEMINI', model: 'test' };
    },
    listModels: async () => [],
  };
}

describe('rezerwacja z potwierdzenia', () => {
  it('plik idzie jako załącznik, wynik to szkic; dokument o czymś innym daje null', async () => {
    const seen: AskOptions[] = [];
    const file = { mimeType: 'application/pdf', data: 'JVBERi0=' };
    expect(await readBooking(answering(READING, seen), { file }, CONTEXT)).toMatchObject({ kind: 'flight', confirmationCode: 'QWE12', total: 1890 });
    expect(seen[0]?.image).toEqual(file);
    expect(await readBooking(answering({ ...READING, isBooking: false }), { text: 'przepis na pizzę' }, CONTEXT)).toBeNull();
  });

  it('tekst w znaczniku, przycięty do limitu; polecenie zna daty i waluty wyjazdu', () => {
    const prompt = bookingPrompt(CONTEXT, 'x'.repeat(BOOKING_TEXT_LIMIT + 50));
    expect(prompt).toContain('<tekst>');
    expect(prompt).toContain('od 2026-12-26 do 2026-12-30');
    expect(prompt).toContain('PLN, MAD');
    expect(prompt.match(/x+/g)!.some((run) => run.length > BOOKING_TEXT_LIMIT)).toBe(false);
    expect(bookingPrompt(CONTEXT)).not.toContain('<tekst>');
  });
});
