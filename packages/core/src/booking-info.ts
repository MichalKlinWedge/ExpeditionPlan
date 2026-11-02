import type { TripDocument } from './schemas/trip-document.ts';

type Booking = TripDocument['bookings'][number];
type Item = TripDocument['items'][number];

/**
 * Lot z rezerwacji w jednej linijce — przy punktach planu (odprawa, wylot, lądowanie), na webie
 * i w telefonie offline: „Ryanair FR 2145 · Wrocław → Agadir Al Massira · bagaż: 20 kg”.
 */
export function flightLine(booking: Booking): string | undefined {
  if (booking.kind !== 'flight') return undefined;
  const carrier = [booking.provider, booking.flight?.number].filter(Boolean).join(' ');
  const route = booking.flight?.fromAirport && booking.flight.toAirport ? `${booking.flight.fromAirport} → ${booking.flight.toAirport}` : undefined;
  const parts = [carrier || undefined, route, booking.flight?.baggage ? `bagaż: ${booking.flight.baggage}` : undefined, booking.confirmationCode ? `kod ${booking.confirmationCode}` : undefined];
  const line = parts.filter(Boolean).join(' · ');
  return line === '' ? undefined : line;
}

/** Rezerwacja lotu, której dotyczy punkt planu (wprost albo przez bilet odcinka). */
export function flightOf(doc: TripDocument, item: Item): Booking | undefined {
  const ref = item.bookingRef ?? item.leg?.ticketBookingRef;
  const booking = ref === undefined ? undefined : doc.bookings.find((each) => each.ref === ref);
  return booking?.kind === 'flight' ? booking : undefined;
}
