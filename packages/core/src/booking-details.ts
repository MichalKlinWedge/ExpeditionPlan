import { formatMoney, formatMoneyRange } from './budget.ts';
import { flightLine } from './booking-info.ts';
import { shortDate } from './format.ts';
import { bookingContacts } from './item-facts.ts';
import { BOOKING_KIND, BOOKING_STATUS, PAY_METHOD, PAY_WHEN } from './labels.ts';
import { lodgingBooking } from './lodging-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Szczegóły rezerwacji z samego planu: termin, kwota, warunki, punkty w pakiecie i kontakty. Web pokazuje
 * to w tabeli „Rezerwacje”, telefon offline w oknie rezerwacji otwieranym z punktu planu.
 */

type Doc = TripDocument;
type Booking = Doc['bookings'][number];
type Item = Doc['items'][number];
type Contact = Doc['contacts'][number];

/** Rezerwacja, do której prowadzi punkt: własna, bilet odcinka albo (przy noclegu) nocleg tego dnia. */
export function itemBookingRef(doc: Doc, item: Item): string | undefined {
  return item.bookingRef ?? item.leg?.ticketBookingRef ?? (item.kind === 'lodging' ? lodgingBooking(doc, item)?.ref : undefined);
}

/** Punkty planu prowadzące do rezerwacji (w kolejności planu): z niej, z biletem na nią i noclegi tej nocy. Np. dla kontaktu rezerwacji. */
export function itemsOfBooking(doc: Doc, bookingRef: string): Item[] {
  return doc.items.filter((item) => itemBookingRef(doc, item) === bookingRef);
}

/** Punkty, dla których rezerwacja jest biletem odcinka (bilet komunikacji na kilka przejazdów), a nie pakietem. */
export function ticketItems(doc: Doc, bookingRef: string): Item[] {
  return doc.items.filter((item) => item.leg?.ticketBookingRef === bookingRef && item.bookingRef !== bookingRef);
}

/**
 * Odpina bilet od przejazdu (`leg.ticketBookingRef`); rezerwacja i reszta odcinka zostają. `null`, gdy punkt
 * nie ma biletu (albo ma inny niż `bookingRef`, jeśli podany).
 */
export function unlinkTicket(doc: Doc, itemRef: string, bookingRef?: string): { doc: Doc; changed: Item[] } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  const ticket = item?.leg?.ticketBookingRef;
  if (item === undefined || item.leg === undefined || ticket === undefined || (bookingRef !== undefined && ticket !== bookingRef)) return null;
  const { ticketBookingRef: _ticket, ...leg } = item.leg;
  const next: Item = { ...item, leg };
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, changed: [next] };
}

/** Rodzaje rezerwacji, które mogą być biletem przejazdu (bilet, karta komunikacji, lot, pociąg…); nie nocleg ani ubezpieczenie. */
export const TICKET_KINDS: readonly string[] = ['ticket', 'transit_pass', 'train', 'bus', 'ferry', 'flight', 'transfer', 'driver_hire', 'package', 'other'];

/** Rezerwacje do wyboru jako bilet przejazdu: pasujący rodzaj, bez anulowanych. */
export function ticketBookings(doc: Doc): Booking[] {
  return doc.bookings.filter((booking) => TICKET_KINDS.includes(booking.kind) && booking.status !== 'cancelled');
}

/** Bilety do wyboru przy przejeździe: `ticketBookings` i obecny bilet punktu, także anulowany (z dopiskiem statusu). */
export function ticketChoices(doc: Doc, item: Pick<Item, 'leg'>): { ref: string; title: string; note?: string }[] {
  const choices = ticketBookings(doc).map((booking) => ({ ref: booking.ref, title: booking.title }));
  const current = doc.bookings.find((booking) => booking.ref === item.leg?.ticketBookingRef);
  if (current === undefined || choices.some((each) => each.ref === current.ref)) return choices;
  return [...choices, { ref: current.ref, title: current.title, note: BOOKING_STATUS[current.status] ?? current.status }];
}

/** Podpina bilet do przejazdu (punkt z `leg`); inny bilet tego przejazdu zastępuje. `null`, gdy nie ma czego zmienić. */
export function linkTicket(doc: Doc, itemRef: string, bookingRef: string): { doc: Doc; changed: Item[] } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item?.leg === undefined || item.leg.ticketBookingRef === bookingRef || !doc.bookings.some((booking) => booking.ref === bookingRef)) return null;
  const next: Item = { ...item, leg: { ...item.leg, ticketBookingRef: bookingRef } };
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, changed: [next] };
}

/** Bilet `bookingRef` dokładnie przy przejazdach `itemRefs`: dopina brakujące, odpina pozostałe. */
export function setBookingTickets(doc: Doc, bookingRef: string, itemRefs: string[]): { doc: Doc; changed: Item[] } {
  const wanted = new Set(itemRefs);
  let current = doc;
  const changed = new Map<string, Item>();
  for (const item of doc.items) {
    const has = item.leg?.ticketBookingRef === bookingRef;
    const edit = wanted.has(item.ref) && !has ? linkTicket(current, item.ref, bookingRef) : !wanted.has(item.ref) && has ? unlinkTicket(current, item.ref, bookingRef) : null;
    if (edit === null) continue;
    current = edit.doc;
    for (const each of edit.changed) changed.set(each.ref, each);
  }
  return { doc: current, changed: [...changed.values()] };
}

/** „26 gru 06:10 → 26 gru 09:55”. */
export function bookingWhen(booking: Booking): string {
  const part = (time: Booking['start']) => (time ? `${shortDate(time.date)}${time.time ? ` ${time.precision === 'approx' ? 'ok. ' : ''}${time.time}` : ''}` : '');
  const start = part(booking.start);
  const end = part(booking.end);
  return start && end ? `${start} → ${end}` : start || end;
}

/** Zapłacona kwota, a bez niej cena z planu. */
export function bookingPrice(booking: Booking): string | null {
  if (booking.paid) return `zapłacono ${formatMoney(booking.paid.amountMinor, booking.paid.currency)}`;
  const price = booking.price;
  if (!price) return null;
  if (price.from) return `od ${formatMoney(price.minMinor, price.currency)}`;
  return `${price.approx ? 'ok. ' : ''}${formatMoneyRange(price.minMinor, price.maxMinor, price.currency)}`;
}

/** Warunki, które liczą się w trasie: zwrot, odwołanie (póki aktualne), płatność, skład, auto, nocleg. */
export function bookingFacts(booking: Booking, today: string): string[] {
  const cancelSoon = booking.freeCancellationUntil !== undefined && booking.freeCancellationUntil >= today;
  return [
    booking.refundable === false ? 'bezzwrotna' : null,
    cancelSoon ? `darmowe odwołanie do ${shortDate(booking.freeCancellationUntil!)}` : null,
    booking.payWhen ? PAY_WHEN[booking.payWhen] : null,
    booking.paymentMethod ? PAY_METHOD[booking.paymentMethod] : null,
    booking.party ? `zgłoszeni: ${booking.party.adults} dor.${booking.party.children > 0 ? ` + ${booking.party.children} dz.` : ''}` : null,
    booking.checkInFrom || booking.checkOutUntil ? [booking.checkInFrom ? `zameldowanie od ${booking.checkInFrom}` : null, booking.checkOutUntil ? `wymeldowanie do ${booking.checkOutUntil}` : null].filter(Boolean).join(', ') : null,
    booking.car?.kmLimit ? `limit ${booking.car.kmLimit} km` : null,
    booking.car?.officeHours ? `biuro ${booking.car.officeHours}` : null,
    booking.lodging?.breakfast ? `śniadanie: ${booking.lodging.breakfast}` : null,
    booking.includes.length > 0 ? `w cenie: ${booking.includes.join(', ')}` : null,
  ].filter((each): each is string => each !== null && each !== '');
}

/** Lot w jednej linijce, inaczej dostawca i kod. */
export function bookingLine(booking: Booking): string {
  return booking.kind === 'flight' ? (flightLine(booking) ?? '') : [booking.provider, booking.confirmationCode ? `kod ${booking.confirmationCode}` : null].filter(Boolean).join(' · ');
}

export type BookingDetails = {
  booking: Booking;
  kind: string;
  status: string;
  when: string;
  price: string | null;
  line: string;
  facts: string[];
  /** Miejsce noclegu. */
  place?: string;
  /** Punkty planu w pakiecie tej rezerwacji. */
  items: { ref: string; title: string }[];
  /** Przejazdy, dla których ta rezerwacja jest biletem odcinka (`leg.ticketBookingRef`), poza pakietem. */
  tickets: { ref: string; title: string }[];
  contacts: Contact[];
};

export function bookingDetails(doc: Doc, ref: string, today: string): BookingDetails | null {
  const booking = doc.bookings.find((each) => each.ref === ref);
  if (booking === undefined) return null;
  const place = booking.kind === 'lodging' && booking.startPlaceRef !== undefined ? doc.places.find((each) => each.ref === booking.startPlaceRef)?.name : undefined;
  return {
    booking,
    kind: BOOKING_KIND[booking.kind] ?? booking.kind,
    status: BOOKING_STATUS[booking.status] ?? booking.status,
    when: bookingWhen(booking),
    price: bookingPrice(booking),
    line: bookingLine(booking),
    facts: bookingFacts(booking, today),
    ...(place !== undefined ? { place } : {}),
    items: doc.items.filter((item) => item.bookingRef === ref).map((item) => ({ ref: item.ref, title: item.title })),
    tickets: ticketItems(doc, ref).map((item) => ({ ref: item.ref, title: item.title })),
    contacts: bookingContacts(doc, ref),
  };
}
