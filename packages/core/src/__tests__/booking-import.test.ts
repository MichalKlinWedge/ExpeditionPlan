import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyBookingDraft, type BookingDraft, bookingDraftRows, matchingBooking } from '../booking-import.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const EMPTY: BookingDraft = {
  isBooking: true,
  confirmed: true,
  kind: null,
  title: null,
  provider: null,
  confirmationCode: null,
  startDate: null,
  startTime: null,
  startTz: null,
  endDate: null,
  endTime: null,
  endTz: null,
  placeName: null,
  address: null,
  currency: null,
  total: null,
  paidAmount: null,
  paidDate: null,
  payWhen: null,
  paymentMethod: null,
  refundable: null,
  freeCancellationUntil: null,
  adults: null,
  children: null,
  includes: [],
  checkInFrom: null,
  checkOutUntil: null,
  flightNumber: null,
  fromAirport: null,
  toAirport: null,
  baggage: null,
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
const IDS = { bookingId: 'rez', placeId: 'miejsce', contactId: 'kontakt' };
const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

describe('import rezerwacji: dopasowanie', () => {
  const doc = fixture('maroko');

  it('ten sam kod rezerwacji wskazuje rezerwację', () => {
    expect(matchingBooking(doc, { ...EMPTY, confirmationCode: 'anon-gyg-0001' })?.ref).toBe('nocleg-agafay');
  });

  it('lot tego dnia: jedyny pasujący rodzaj z datą', () => {
    expect(matchingBooking(doc, { ...EMPTY, kind: 'flight', startDate: '2026-12-30' })?.ref).toBe('lot-powrot');
  });

  it('kilka aut tego dnia — nie zgaduje', () => {
    expect(matchingBooking(doc, { ...EMPTY, kind: 'car_rental', startDate: '2026-12-26' })).toBeUndefined();
    expect(matchingBooking(doc, { ...EMPTY, kind: 'ferry', startDate: '2026-12-26' })).toBeUndefined();
  });
});

describe('import rezerwacji: podgląd i zapis', () => {
  const doc = fixture('maroko');

  it('nowa rezerwacja auta: rodzaj, nazwa i status zawsze, pola noclegu pominięte', () => {
    const draft: BookingDraft = {
      ...EMPTY,
      kind: 'car_rental',
      title: 'Sixt Marrakesz',
      provider: 'Sixt',
      confirmationCode: 'SX-991',
      startDate: '2026-12-26',
      startTime: '10:30',
      endDate: '2026-12-30',
      endTime: '08:00',
      currency: 'EUR',
      total: 412.5,
      paidAmount: 412.5,
      kmLimit: 1000,
      deposit: 1200,
      fuelPolicy: 'pełny – pełny',
      breakfast: 'tak',
      phone: '+212 600 000 000',
    };
    const rows = bookingDraftRows(doc, draft, null);
    expect(rows.filter((row) => row.required).map((row) => row.key)).toEqual(['kind', 'title', 'status']);
    expect(keys(rows)).not.toContain('lodging');
    expect(rows.find((row) => row.key === 'status')?.value).toBe('zapłacone');
    expect(rows.find((row) => row.key === 'car')?.value).toContain('limit 1000 km');

    const saved = applyBookingDraft(doc, draft, null, ['price', 'paid', 'car', 'contact', 'start', 'end', 'confirmationCode'], IDS)!;
    expect(TripDocument.safeParse(saved.doc).success).toBe(true);
    expect(saved.booking).toMatchObject({
      ref: 'id-rez',
      kind: 'car_rental',
      status: 'paid',
      confirmationCode: 'SX-991',
      start: { date: '2026-12-26', time: '10:30', tz: 'Africa/Casablanca' },
      price: { currency: 'EUR', minMinor: 41250, maxMinor: 41250 },
      paid: { amountMinor: 41250, currency: 'EUR' },
      car: { kmLimit: 1000, fuelPolicy: 'pełny – pełny', deposit: { minMinor: 120000 } },
    });
    expect(saved.booking.lodging).toBeUndefined();
    expect(saved.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['bookings:insert', 'contacts:insert']);
    expect(saved.doc.contacts.at(-1)).toMatchObject({ role: 'rental', name: 'Sixt', bookingRef: 'id-rez' });
  });

  it('istniejąca: pola równe planowi pomija, inne pokazuje z obecną wartością i zapisuje tylko zaznaczone', () => {
    const flight = doc.bookings.find((each) => each.ref === 'lot-tam')!;
    const draft: BookingDraft = {
      ...EMPTY,
      kind: 'flight',
      title: flight.title,
      startDate: flight.start!.date,
      flightNumber: 'FR 1234',
      fromAirport: 'krk',
      toAirport: 'rak',
      confirmationCode: 'QWE12',
      startTz: 'Nie/Strefa',
    };
    const rows = bookingDraftRows(doc, draft, 'lot-tam');
    expect(keys(rows)).not.toContain('title');
    expect(keys(rows)).not.toContain('kind');
    expect(keys(rows)).toContain('flight');
    expect(rows.find((row) => row.key === 'status')).toBeUndefined();

    const saved = applyBookingDraft(doc, draft, 'lot-tam', ['flight', 'confirmationCode'], IDS)!;
    expect(TripDocument.safeParse(saved.doc).success).toBe(true);
    expect(saved.booking).toMatchObject({ ref: 'lot-tam', status: 'paid', confirmationCode: 'QWE12', flight: { number: 'FR 1234', fromAirport: 'KRK', toAirport: 'RAK' } });
    // Początek nie był zaznaczony — zostaje z planu.
    expect(saved.booking.start).toEqual(flight.start);
    expect(saved.writes).toHaveLength(1);
  });

  it('potwierdzenie podnosi „do rezerwacji” do „zarezerwowane”; nocleg dostaje miejsce z adresem', () => {
    const draft: BookingDraft = { ...EMPTY, kind: 'car_rental', confirmationCode: 'OCT-1' };
    expect(bookingDraftRows(doc, draft, 'auto-sixt-octavia').find((row) => row.key === 'status')).toMatchObject({ value: 'zarezerwowane', current: 'do rezerwacji' });

    const lodging: BookingDraft = { ...EMPTY, kind: 'lodging', title: 'Dar Atlas', placeName: 'Dar Atlas', address: 'Derb 5, Imlil', startDate: '2026-12-31', endDate: '2027-01-01', checkInFrom: '14:00' };
    const saved = applyBookingDraft(doc, lodging, null, ['place', 'start', 'end', 'checkTimes'], IDS)!;
    expect(TripDocument.safeParse(saved.doc).success).toBe(true);
    expect(saved.booking).toMatchObject({ kind: 'lodging', status: 'booked', startPlaceRef: 'id-miejsce', checkInFrom: '14:00', start: { tz: 'Africa/Casablanca' } });
    expect(saved.doc.places.at(-1)).toMatchObject({ ref: 'id-miejsce', name: 'Dar Atlas', address: 'Derb 5, Imlil' });
    expect(saved.writes.map((write) => write.collection)).toEqual(['places', 'bookings']);
  });

  it('oferta (bez potwierdzenia) to „do rezerwacji”', () => {
    const saved = applyBookingDraft(doc, { ...EMPTY, confirmed: false, kind: 'activity', title: 'Balon nad Marrakeszem' }, null, [], IDS)!;
    expect(saved.booking.status).toBe('to_book');
  });
});
