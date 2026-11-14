import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bookingDetails, bookingFacts, itemBookingRef, itemsOfBooking, linkTicket, setBookingTickets, ticketBookings, ticketChoices, ticketItems, unlinkTicket } from '../booking-details.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
const barcelona = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/barcelona/plan.json', import.meta.url)), 'utf8')));

describe('szczegóły rezerwacji', () => {
  it('pakiet: termin, zapłacona kwota, warunki, punkty w pakiecie i kontakt', () => {
    const details = bookingDetails(maroko, 'nocleg-agafay', '2026-11-07')!;
    expect(details.kind).toBe('pakiet');
    expect(details.status).toBe('zapłacone');
    expect(details.when).toMatch(/→/);
    expect(details.price).toMatch(/^zapłacono /);
    expect(details.line).toBe('GetYourGuide · kod ANON-GYG-0001');
    expect(details.facts).toEqual(expect.arrayContaining(['płatne z góry', 'online', 'zgłoszeni: 4 dor. + 1 dz.', 'wymeldowanie do 11:00']));
    expect(details.items.map((item) => item.ref)).toContain('d2-quady');
    expect(details.contacts.map((contact) => contact.name)).toEqual(['Organizator obozu Agafay (pakiet GetYourGuide)']);
  });

  it('lot: linia lotu zamiast dostawcy', () => {
    expect(bookingDetails(maroko, 'lot-tam', '2026-11-07')!.line).toMatch(/^Ryanair/);
  });

  it('nieznana rezerwacja: brak', () => {
    expect(bookingDetails(maroko, 'nie-ma', '2026-11-07')).toBeNull();
  });

  it('darmowe odwołanie tylko póki aktualne', () => {
    const booking = { ...maroko.bookings[0]!, freeCancellationUntil: '2026-12-01' };
    expect(bookingFacts(booking, '2026-11-07')).toContain('darmowe odwołanie do 1 gru');
    expect(bookingFacts(booking, '2026-12-02').some((fact) => fact.startsWith('darmowe'))).toBe(false);
  });
});

describe('punkty rezerwacji', () => {
  it('pakiet i lot z punktami planu, nieznana pusta', () => {
    expect(itemsOfBooking(maroko, 'nocleg-agafay').map((item) => item.ref)).toEqual(expect.arrayContaining(['d2-quady', 'd2-radykalny-oboz']));
    expect(itemsOfBooking(maroko, 'lot-tam').map((item) => item.ref)).toEqual(expect.arrayContaining(['d1-lotnisko-wro', 'd1-przylot']));
    expect(itemsOfBooking(maroko, 'nie-ma')).toEqual([]);
  });
});

describe('rezerwacja punktu', () => {
  it('własna, bilet odcinka albo nocleg dnia', () => {
    const item = maroko.items.find((each) => each.ref === 'd2-quady')!;
    expect(itemBookingRef(maroko, item)).toBe('nocleg-agafay');
    const { bookingRef: _, ...free } = item;
    expect(itemBookingRef(maroko, { ...free, leg: { mode: 'car', links: [], ticketBookingRef: 'lot-tam' } } as typeof item)).toBe('lot-tam');
    const lodging = maroko.items.find((each) => each.ref === 'd2-radykalny-oboz')!;
    const { bookingRef: __, ...unbooked } = lodging;
    expect(itemBookingRef(maroko, unbooked as typeof lodging)).toBe('nocleg-agafay');
  });
});

describe('bilet odcinka', () => {
  it('karta komunikacji nie ma pakietu, ale jest biletem kilku przejazdów', () => {
    const details = bookingDetails(barcelona, 't-casual', '2026-11-07')!;
    expect(details.items).toEqual([]);
    expect(details.tickets.length).toBeGreaterThan(1);
    expect(details.tickets.map((item) => item.ref)).toEqual(ticketItems(barcelona, 't-casual').map((item) => item.ref));
    expect(ticketItems(barcelona, 't-casual').every((item) => itemBookingRef(barcelona, item) === 't-casual')).toBe(true);
  });

  it('odpięcie biletu od jednego przejazdu: reszta odcinka i rezerwacja zostają', () => {
    const [first, ...rest] = ticketItems(barcelona, 't-casual');
    expect(unlinkTicket(barcelona, first!.ref, 'inny-bilet')).toBeNull();
    const edit = unlinkTicket(barcelona, first!.ref, 't-casual')!;
    expect(edit.changed[0]!.leg).toEqual(expect.objectContaining({ mode: first!.leg!.mode }));
    expect(edit.changed[0]!.leg?.ticketBookingRef).toBeUndefined();
    expect(ticketItems(edit.doc, 't-casual').map((item) => item.ref)).toEqual(rest.map((item) => item.ref));
    expect(edit.doc.bookings).toBe(barcelona.bookings);
    expect(unlinkTicket(edit.doc, first!.ref)).toBeNull();
    expect(TripDocument.safeParse(edit.doc).success).toBe(true);
  });

  it('podpięcie biletu: tylko przejazd z odcinkiem, a formularz ustawia dokładnie wybrane', () => {
    const tickets = ticketItems(barcelona, 't-casual').map((item) => item.ref);
    const [first] = tickets;
    const other = barcelona.items.find((item) => item.leg !== undefined && item.leg.ticketBookingRef === undefined && item.bookingRef === undefined)!;
    const noLeg = barcelona.items.find((item) => item.leg === undefined)!;
    expect(linkTicket(barcelona, noLeg.ref, 't-casual')).toBeNull();
    expect(linkTicket(barcelona, first!, 't-casual')).toBeNull();
    expect(linkTicket(barcelona, other.ref, 'nie-ma')).toBeNull();
    expect(linkTicket(barcelona, other.ref, 't-casual')!.changed[0]!.leg?.ticketBookingRef).toBe('t-casual');
    const set = setBookingTickets(barcelona, 't-casual', [other.ref, ...tickets.slice(1)]);
    expect(set.changed.map((item) => item.ref).sort()).toEqual([first!, other.ref].sort());
    expect(ticketItems(set.doc, 't-casual').map((item) => item.ref).sort()).toEqual([other.ref, ...tickets.slice(1)].sort());
    expect(TripDocument.safeParse(set.doc).success).toBe(true);
    expect(ticketBookings(barcelona).map((booking) => booking.ref)).toContain('t-casual');
    expect(ticketBookings(barcelona).some((booking) => booking.kind === 'lodging')).toBe(false);
  });

  it('wybór biletu w edytorze: obecny anulowany bilet zostaje na liście z dopiskiem', () => {
    const item = ticketItems(barcelona, 't-casual')[0]!;
    expect(ticketChoices(barcelona, item).find((each) => each.ref === 't-casual')).toEqual({ ref: 't-casual', title: expect.any(String) });
    const cancelled: TripDocument = { ...barcelona, bookings: barcelona.bookings.map((booking) => (booking.ref === 't-casual' ? { ...booking, status: 'cancelled' } : booking)) };
    expect(ticketChoices(cancelled, item).find((each) => each.ref === 't-casual')?.note).toBe('anulowane');
    expect(ticketChoices(cancelled, { leg: undefined }).some((each) => each.ref === 't-casual')).toBe(false);
  });
});
