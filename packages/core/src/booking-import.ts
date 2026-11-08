import { z } from 'zod';

import { bookingPlace } from './booking-place.ts';
import { formatMoney } from './budget.ts';
import { shortDate } from './format.ts';
import { BOOKING_KIND, BOOKING_STATUS, PAY_METHOD, PAY_WHEN } from './labels.ts';
import { Currency, IsoDate, LocalTime, TimeZone } from './schemas/common.ts';
import { BookingKind, type TripDocument } from './schemas/trip-document.ts';

/**
 * Import rezerwacji z potwierdzenia: PDF, zrzut ekranu albo wklejony mail. AI czyta dokument i daje
 * szkic (`BookingDraft`), a ten moduł pokazuje, co szkic zmieniłby w nowej albo istniejącej rezerwacji,
 * i zapisuje tylko pola zaznaczone w podglądzie. Pola z inną wartością w planie nie są zaznaczane
 * domyślnie. Plik trafia potem do sejfu przy tej rezerwacji (web, `booking-import.tsx`).
 */

type Doc = TripDocument;
type Booking = Doc['bookings'][number];
type Place = Doc['places'][number];
type Contact = Doc['contacts'][number];

const short = (max: number) => z.string().trim().min(1).max(max).nullable();
const count = z.number().int().nonnegative().max(999).nullable();
const amount = z.number().nonnegative().nullable();

export const BookingDraft = z.object({
  /** Czy dokument w ogóle dotyczy rezerwacji, biletu, najmu albo ubezpieczenia. */
  isBooking: z.boolean(),
  /** Potwierdzenie (zarezerwowane, kupione), a nie oferta albo koszyk. */
  confirmed: z.boolean(),
  kind: BookingKind.nullable(),
  title: short(120),
  provider: short(80),
  confirmationCode: short(60),
  startDate: IsoDate.nullable(),
  startTime: LocalTime.nullable(),
  /** Strefa IANA początku; niepoprawną kod pomija i bierze strefę dnia wyjazdu. */
  startTz: z.string().max(60).nullable(),
  endDate: IsoDate.nullable(),
  endTime: LocalTime.nullable(),
  endTz: z.string().max(60).nullable(),
  placeName: short(120),
  address: short(200),
  currency: Currency.nullable(),
  /** Cena całej rezerwacji w jednostkach głównych (1234.5 = 1234,50). */
  total: amount,
  paidAmount: amount,
  paidDate: IsoDate.nullable(),
  payWhen: z.enum(['prepaid', 'on_site', 'before_arrival']).nullable(),
  paymentMethod: z.enum(['cash', 'card', 'credit_card_only', 'online']).nullable(),
  refundable: z.boolean().nullable(),
  freeCancellationUntil: IsoDate.nullable(),
  adults: count,
  children: count,
  includes: z.array(z.string().trim().min(1).max(80)).max(12),
  checkInFrom: LocalTime.nullable(),
  checkOutUntil: LocalTime.nullable(),
  flightNumber: short(20),
  fromAirport: short(10),
  toAirport: short(10),
  baggage: short(120),
  carClass: short(60),
  carModel: short(80),
  kmLimit: z.number().int().positive().max(100_000).nullable(),
  deposit: amount,
  fuelPolicy: short(80),
  officeHours: short(80),
  rooms: z.number().int().positive().max(99).nullable(),
  beds: short(120),
  breakfast: short(120),
  contactName: short(80),
  phone: short(40),
  email: z.email().max(254).nullable(),
});
export type BookingDraft = z.infer<typeof BookingDraft>;

export const BOOKING_IMPORT_FIELDS = [
  'kind',
  'title',
  'status',
  'provider',
  'confirmationCode',
  'start',
  'end',
  'place',
  'price',
  'paid',
  'payment',
  'cancellation',
  'party',
  'includes',
  'checkTimes',
  'flight',
  'car',
  'lodging',
  'contact',
] as const;
export type BookingImportField = (typeof BOOKING_IMPORT_FIELDS)[number];

/**
 * Wiersz podglądu. `current` — inna wartość, która już jest w rezerwacji (domyślnie odznaczona);
 * `required` — bez tego pola nowej rezerwacji nie ma (rodzaj, nazwa), więc nie da się go odznaczyć.
 */
export type BookingDraftRow = { key: BookingImportField; label: string; value: string; current?: string; required?: boolean };

const minor = (value: number) => Math.round(value * 100);
const sameText = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

const validTz = (zone: string | null) => (zone !== null && TimeZone.safeParse(zone).success ? zone : undefined);

/** Strefa końca rezerwacji: podana w dokumencie, a bez niej strefa dnia wyjazdu o tej dacie albo główna. */
function zoneFor(doc: Doc, date: string, given: string | null): string {
  return validTz(given) ?? doc.days.find((day) => day.date === date)?.tz ?? doc.trip.primaryTz;
}

/** Rezerwacja, której dotyczy dokument: ten sam kod, ten sam lot tego dnia albo ten sam rodzaj z tą samą datą początku. */
export function matchingBooking(doc: Doc, draft: BookingDraft): Booking | undefined {
  const open = doc.bookings.filter((booking) => booking.status !== 'cancelled');
  const code = draft.confirmationCode;
  if (code !== null) {
    const byCode = open.find((booking) => sameText(booking.confirmationCode, code));
    if (byCode) return byCode;
  }
  if (draft.startDate === null) return undefined;
  const sameDay = open.filter((booking) => booking.start?.date === draft.startDate);
  if (draft.flightNumber !== null) {
    const flight = sameDay.find((booking) => booking.kind === 'flight' && sameText(booking.flight?.number?.replace(/\s/g, ''), draft.flightNumber!.replace(/\s/g, '')));
    if (flight) return flight;
  }
  // Rodzaj i data to za mało, gdy pasuje kilka (dwa loty tego dnia) — wtedy wybiera człowiek.
  const sameKind = draft.kind === null ? [] : sameDay.filter((booking) => booking.kind === draft.kind && (booking.confirmationCode === undefined || code === null));
  return sameKind.length === 1 ? sameKind[0] : undefined;
}

/** Rola kontaktu z dokumentu po rodzaju rezerwacji. */
const contactRole = (kind: Booking['kind']): Contact['role'] => (kind === 'lodging' ? 'host' : kind === 'car_rental' ? 'rental' : 'operator');

function contactOf(doc: Doc, booking: Booking | undefined): Contact | undefined {
  if (booking === undefined) return undefined;
  const own = doc.contacts.filter((contact) => contact.bookingRef === booking.ref);
  return own.find((contact) => contact.role === contactRole(booking.kind)) ?? own[0];
}

/** Status po imporcie: potwierdzenie podnosi „pomysł / do rezerwacji” do „zarezerwowane”, pełna zapłata do „zapłacone”. */
function statusAfter(draft: BookingDraft, current: Booking | undefined): Booking['status'] {
  const before = current?.status;
  if (before === 'cancelled' || before === 'not_required') return before;
  const fullyPaid = draft.paidAmount !== null && draft.paidAmount > 0 && (draft.total === null ? draft.payWhen !== 'on_site' : draft.paidAmount >= draft.total);
  if (fullyPaid) return 'paid';
  if (before === 'paid' || before === 'booked') return before;
  return draft.confirmed ? 'booked' : (before ?? 'to_book');
}

const timeText = (time: Booking['start'], primaryTz: string) =>
  time ? [shortDate(time.date), time.time, time.tz !== primaryTz ? `(${time.tz})` : undefined].filter(Boolean).join(' ') : undefined;

/** Pola rezerwacji, które zmienia jedno pole podglądu (bez miejsca i kontaktu — te są w osobnych kolekcjach). */
function patchOf(doc: Doc, draft: BookingDraft, key: BookingImportField, current: Booking | undefined): Partial<Booking> | null {
  const currency = draft.currency ?? undefined;
  switch (key) {
    case 'kind':
      return draft.kind === null ? null : { kind: draft.kind };
    case 'title':
      return draft.title === null ? null : { title: draft.title };
    case 'status':
      return { status: statusAfter(draft, current) };
    case 'provider':
      return draft.provider === null ? null : { provider: draft.provider };
    case 'confirmationCode':
      return draft.confirmationCode === null ? null : { confirmationCode: draft.confirmationCode };
    case 'start':
      return draft.startDate === null ? null : { start: { date: draft.startDate, ...(draft.startTime ? { time: draft.startTime } : {}), precision: 'exact', tz: zoneFor(doc, draft.startDate, draft.startTz) } };
    case 'end':
      return draft.endDate === null ? null : { end: { date: draft.endDate, ...(draft.endTime ? { time: draft.endTime } : {}), precision: 'exact', tz: zoneFor(doc, draft.endDate, draft.endTz ?? draft.startTz) } };
    case 'price':
      return draft.total === null || currency === undefined ? null : { price: { currency, basis: 'per_group', minMinor: minor(draft.total), maxMinor: minor(draft.total), from: false, approx: false } };
    case 'paid':
      return draft.paidAmount === null || draft.paidAmount === 0 || currency === undefined ? null : { paid: { amountMinor: minor(draft.paidAmount), currency, ...(draft.paidDate ? { date: draft.paidDate } : {}) } };
    case 'payment':
      return draft.payWhen === null && draft.paymentMethod === null ? null : { ...(draft.payWhen ? { payWhen: draft.payWhen } : {}), ...(draft.paymentMethod ? { paymentMethod: draft.paymentMethod } : {}) };
    case 'cancellation':
      return draft.refundable === null && draft.freeCancellationUntil === null
        ? null
        : { ...(draft.freeCancellationUntil ? { freeCancellationUntil: draft.freeCancellationUntil, refundable: true } : {}), ...(draft.refundable !== null ? { refundable: draft.refundable } : {}) };
    case 'party':
      return draft.adults === null && draft.children === null ? null : { party: { adults: draft.adults ?? 0, children: draft.children ?? 0 } };
    case 'includes':
      return draft.includes.length === 0 ? null : { includes: draft.includes };
    case 'checkTimes':
      return draft.checkInFrom === null && draft.checkOutUntil === null ? null : { ...(draft.checkInFrom ? { checkInFrom: draft.checkInFrom } : {}), ...(draft.checkOutUntil ? { checkOutUntil: draft.checkOutUntil } : {}) };
    case 'flight': {
      const flight = { number: draft.flightNumber?.toUpperCase(), fromAirport: draft.fromAirport?.toUpperCase(), toAirport: draft.toAirport?.toUpperCase(), baggage: draft.baggage ?? undefined };
      return defined(flight) ? { flight: { ...current?.flight, ...strip(flight) } } : null;
    }
    case 'car': {
      const car = {
        carClass: draft.carClass ?? undefined,
        model: draft.carModel ?? undefined,
        kmLimit: draft.kmLimit ?? undefined,
        fuelPolicy: draft.fuelPolicy ?? undefined,
        officeHours: draft.officeHours ?? undefined,
        deposit: draft.deposit === null || currency === undefined ? undefined : { currency, basis: 'per_group' as const, minMinor: minor(draft.deposit), maxMinor: minor(draft.deposit), from: false, approx: false },
      };
      return defined(car) ? { car: { ...current?.car, ...strip(car) } } : null;
    }
    case 'lodging': {
      const lodging = { rooms: draft.rooms ?? undefined, beds: draft.beds ?? undefined, breakfast: draft.breakfast ?? undefined };
      return defined(lodging) ? { lodging: { amenities: [], ...current?.lodging, ...strip(lodging) } } : null;
    }
    default:
      return null;
  }
}

const defined = (value: Record<string, unknown>) => Object.values(value).some((each) => each !== undefined);
const strip = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

/** Tekst pola w podglądzie; ten sam dla rezerwacji z planu i dla szkicu, więc równe teksty = brak zmiany. */
function render(doc: Doc, key: BookingImportField, booking: Partial<Booking>): string | undefined {
  const money = (minorAmount: number, currency: string) => formatMoney(minorAmount, currency);
  switch (key) {
    case 'kind':
      return booking.kind ? BOOKING_KIND[booking.kind] : undefined;
    case 'title':
      return booking.title;
    case 'status':
      return booking.status ? BOOKING_STATUS[booking.status] : undefined;
    case 'provider':
      return booking.provider;
    case 'confirmationCode':
      return booking.confirmationCode;
    case 'start':
      return timeText(booking.start, doc.trip.primaryTz);
    case 'end':
      return timeText(booking.end, doc.trip.primaryTz);
    case 'price':
      return booking.price ? (booking.price.minMinor === booking.price.maxMinor ? money(booking.price.minMinor, booking.price.currency) : `${money(booking.price.minMinor, booking.price.currency)} – ${money(booking.price.maxMinor, booking.price.currency)}`) : undefined;
    case 'paid':
      return booking.paid ? [money(booking.paid.amountMinor, booking.paid.currency), booking.paid.date ? shortDate(booking.paid.date) : undefined].filter(Boolean).join(', ') : undefined;
    case 'payment':
      return join([booking.payWhen ? PAY_WHEN[booking.payWhen] : undefined, booking.paymentMethod ? PAY_METHOD[booking.paymentMethod] : undefined]);
    case 'cancellation':
      return join([booking.refundable === false ? 'bezzwrotna' : booking.refundable === true && !booking.freeCancellationUntil ? 'zwrotna' : undefined, booking.freeCancellationUntil ? `darmowe odwołanie do ${shortDate(booking.freeCancellationUntil)}` : undefined]);
    case 'party':
      return booking.party ? `${booking.party.adults} dor.${booking.party.children > 0 ? ` + ${booking.party.children} dz.` : ''}` : undefined;
    case 'includes':
      return booking.includes && booking.includes.length > 0 ? booking.includes.join(', ') : undefined;
    case 'checkTimes':
      return join([booking.checkInFrom ? `zameldowanie od ${booking.checkInFrom}` : undefined, booking.checkOutUntil ? `wymeldowanie do ${booking.checkOutUntil}` : undefined]);
    case 'flight': {
      const flight = booking.flight;
      return flight ? join([flight.number, flight.fromAirport && flight.toAirport ? `${flight.fromAirport} → ${flight.toAirport}` : (flight.fromAirport ?? flight.toAirport), flight.baggage ? `bagaż: ${flight.baggage}` : undefined]) : undefined;
    }
    case 'car': {
      const car = booking.car;
      return car
        ? join([
            car.carClass,
            car.model,
            car.kmLimit ? `limit ${car.kmLimit} km` : undefined,
            car.deposit ? `kaucja ${money(car.deposit.minMinor, car.deposit.currency)}` : undefined,
            car.fuelPolicy ? `paliwo: ${car.fuelPolicy}` : undefined,
            car.officeHours ? `biuro ${car.officeHours}` : undefined,
          ])
        : undefined;
    }
    case 'lodging': {
      const lodging = booking.lodging;
      return lodging ? join([lodging.rooms ? `pokoje: ${lodging.rooms}` : undefined, lodging.beds ? `łóżka: ${lodging.beds}` : undefined, lodging.breakfast ? `śniadanie: ${lodging.breakfast}` : undefined]) : undefined;
    }
    default:
      return undefined;
  }
}

const join = (parts: (string | undefined)[]) => {
  const text = parts.filter((each): each is string => each !== undefined && each !== '').join(' · ');
  return text === '' ? undefined : text;
};

const LABELS: Record<BookingImportField, string> = {
  kind: 'Rodzaj',
  title: 'Nazwa',
  status: 'Status',
  provider: 'Dostawca',
  confirmationCode: 'Kod rezerwacji',
  start: 'Początek',
  end: 'Koniec',
  place: 'Miejsce',
  price: 'Cena',
  paid: 'Zapłacono',
  payment: 'Płatność',
  cancellation: 'Odwołanie',
  party: 'Zgłoszone osoby',
  includes: 'W cenie',
  checkTimes: 'Zameldowanie',
  flight: 'Lot',
  car: 'Auto',
  lodging: 'Nocleg',
  contact: 'Kontakt',
};

/** Rodzaj nowej rezerwacji i jej nazwa, gdy dokument ich nie podaje. */
const kindOf = (draft: BookingDraft, current: Booking | undefined) => draft.kind ?? current?.kind ?? 'other';
const titleOf = (draft: BookingDraft) => draft.title ?? draft.provider ?? BOOKING_KIND[draft.kind ?? 'other']!;

/** Pola, które mają sens przy danym rodzaju (lot nie ma zameldowania, nocleg nie ma limitu km). */
function fitsKind(key: BookingImportField, kind: Booking['kind']): boolean {
  if (key === 'flight') return kind === 'flight';
  if (key === 'car') return kind === 'car_rental';
  if (key === 'lodging' || key === 'checkTimes') return kind === 'lodging';
  return true;
}

const placeText = (name: string | undefined, address: string | undefined) => join([name, address]);
const contactText = (contact: { name?: string | null; phone?: string | null; email?: string | null } | undefined) => (contact ? join([contact.name ?? undefined, contact.phone ?? undefined, contact.email ?? undefined]) : undefined);

/** Co szkic zmieniłby w rezerwacji `target` (brak = nowa). Pola bez wartości i te już takie same pomija. */
export function bookingDraftRows(doc: Doc, draft: BookingDraft, targetRef: string | null): BookingDraftRow[] {
  const current = targetRef === null ? undefined : doc.bookings.find((each) => each.ref === targetRef);
  const kind = kindOf(draft, current);
  const rows: BookingDraftRow[] = [];
  for (const key of BOOKING_IMPORT_FIELDS) {
    if (!fitsKind(key, kind)) continue;
    let value: string | undefined;
    let was: string | undefined;
    if (key === 'place') {
      const place = doc.places.find((each) => each.ref === current?.startPlaceRef);
      value = draft.placeName === null && draft.address === null ? undefined : placeText(draft.placeName ?? place?.name, draft.address ?? place?.address);
      was = place ? placeText(place.name, place.address) : undefined;
    } else if (key === 'contact') {
      value = draft.phone === null && draft.email === null ? undefined : contactText({ name: draft.contactName ?? draft.provider, phone: draft.phone, email: draft.email });
      was = contactText(contactOf(doc, current));
    } else if (current === undefined && (key === 'kind' || key === 'title' || key === 'status')) {
      value = key === 'kind' ? BOOKING_KIND[kind] : key === 'title' ? titleOf(draft) : BOOKING_STATUS[statusAfter(draft, undefined)];
      rows.push({ key, label: LABELS[key], value: value!, required: true });
      continue;
    } else {
      const patch = patchOf(doc, draft, key, current);
      value = patch === null ? undefined : render(doc, key, patch);
      was = current === undefined ? undefined : render(doc, key, current);
    }
    if (value === undefined || value === was) continue;
    rows.push({ key, label: LABELS[key], value, ...(was ? { current: was } : {}) });
  }
  return rows;
}

export type BookingImportWrite =
  | { collection: 'places'; element: Place; op: 'insert' | 'update' }
  | { collection: 'bookings'; element: Booking; op: 'insert' | 'update' }
  | { collection: 'contacts'; element: Contact; op: 'insert' | 'update' };

/**
 * Zapis zaznaczonych pól do rezerwacji `targetRef` albo do nowej (`null`). `ids` to uuid ewentualnych
 * nowych wierszy. Kolejność `writes` pilnuje kluczy obcych: miejsce, rezerwacja, kontakt.
 */
export function applyBookingDraft(
  doc: Doc,
  draft: BookingDraft,
  targetRef: string | null,
  fields: BookingImportField[],
  ids: { bookingId: string; placeId: string; contactId: string },
): { doc: Doc; booking: Booking; writes: BookingImportWrite[] } | null {
  const current = targetRef === null ? undefined : doc.bookings.find((each) => each.ref === targetRef);
  if (targetRef !== null && current === undefined) return null;
  const picked = new Set<BookingImportField>(fields);
  if (current === undefined) {
    picked.add('kind');
    picked.add('title');
  }
  const kind = picked.has('kind') ? kindOf(draft, current) : current!.kind;
  const writes: BookingImportWrite[] = [];
  let next = doc;

  let booking: Booking =
    current ??
    ({ ref: `id-${ids.bookingId}`, kind, status: draft.confirmed ? 'booked' : 'to_book', title: titleOf(draft), includes: [], addons: [], pros: [], cons: [], links: [], notes: [] } as Booking);
  for (const key of BOOKING_IMPORT_FIELDS) {
    if (!picked.has(key) || key === 'place' || key === 'contact' || !fitsKind(key, kind)) continue;
    const patch = key === 'title' ? { title: titleOf(draft) } : key === 'kind' ? { kind } : patchOf(doc, draft, key, current);
    if (patch !== null) booking = { ...booking, ...patch };
  }
  // Nowa rezerwacja z potwierdzenia z zapłatą ma od razu właściwy status, nawet bez wiersza „Status”.
  if (current === undefined) booking = { ...booking, status: statusAfter(draft, undefined) };

  if (picked.has('place') && (draft.placeName !== null || draft.address !== null)) {
    const placed = bookingPlace(next, booking.startPlaceRef, { name: draft.placeName ?? '', coordinates: '', title: booking.title }, ids.placeId);
    if (typeof placed !== 'string' && placed.placeRef !== undefined) {
      let places = placed.places;
      let write = placed.write;
      const place = places.find((each) => each.ref === placed.placeRef)!;
      if (draft.address !== null && place.address !== draft.address) {
        const withAddress = { ...place, address: draft.address };
        places = places.map((each) => (each.ref === place.ref ? withAddress : each));
        write = { place: withAddress, op: write?.op ?? 'update' };
      }
      next = { ...next, places };
      if (write) writes.push({ collection: 'places', element: write.place, op: write.op });
      booking = { ...booking, startPlaceRef: placed.placeRef };
    }
  }

  next = { ...next, bookings: current ? next.bookings.map((each) => (each.ref === booking.ref ? booking : each)) : [...next.bookings, booking] };
  writes.push({ collection: 'bookings', element: booking, op: current ? 'update' : 'insert' });

  if (picked.has('contact') && (draft.phone !== null || draft.email !== null)) {
    const existing = contactOf(doc, current);
    const contact: Contact = {
      ...(existing ?? { ref: `id-${ids.contactId}`, name: draft.contactName ?? draft.provider ?? booking.title, role: contactRole(booking.kind), bookingRef: booking.ref }),
      ...(existing && draft.contactName !== null ? { name: draft.contactName } : {}),
      ...(draft.phone !== null ? { phone: draft.phone } : {}),
      ...(draft.email !== null ? { email: draft.email } : {}),
    };
    next = { ...next, contacts: existing ? next.contacts.map((each) => (each.ref === existing.ref ? contact : each)) : [...next.contacts, contact] };
    writes.push({ collection: 'contacts', element: contact, op: existing ? 'update' : 'insert' });
  }

  return { doc: next, booking, writes };
}
