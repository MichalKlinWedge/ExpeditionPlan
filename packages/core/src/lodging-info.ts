import { z } from 'zod';

import { dayLodging } from './plan-info.ts';
import { LocalTime } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Obiekt noclegu na karcie punktu: link do jego strony i dane odczytane przez AI z tekstu, który
 * użytkownik sam wkleił (strona obiektu, mail z potwierdzeniem). Stron Bookingu nie pobieramy:
 * regulamin zabrania automatycznego odczytu (pkt A15), a API wymaga statusu partnera (SPECYFIKACJA W1).
 * Szkic idzie przez podgląd: pola z inną wartością w planie nie zmieniają się bez zaznaczenia.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Booking = Doc['bookings'][number];
type Place = Doc['places'][number];
type Contact = Doc['contacts'][number];

const short = (max: number) => z.string().trim().min(1).max(max).nullable();

export const LodgingDraft = z.object({
  /** Czy w tekście w ogóle jest opis noclegu albo jego rezerwacji. */
  isLodging: z.boolean(),
  description: short(600),
  address: short(200),
  checkInFrom: LocalTime.nullable(),
  checkOutUntil: LocalTime.nullable(),
  breakfast: short(120),
  beds: short(120),
  rooms: z.number().int().positive().max(99).nullable(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(20),
  confirmationCode: short(60),
  hostName: short(80),
  phone: short(40),
  email: z.email().max(254).nullable(),
});
export type LodgingDraft = z.infer<typeof LodgingDraft>;

export type LodgingField = 'description' | 'address' | 'checkInFrom' | 'checkOutUntil' | 'breakfast' | 'beds' | 'rooms' | 'amenities' | 'confirmationCode' | 'contact';

/** Wiersz podglądu; `current` — inna wartość, która już jest w planie (nie zaznaczamy jej domyślnie). */
export type LodgingDraftRow = { key: LodgingField; label: string; value: string; current?: string };

/** Etykieta linku do obiektu po adresie strony. */
export function lodgingLinkLabel(url: string): string {
  if (/(^|\/\/|\.)booking\.com(\/|$)/i.test(url)) return 'Booking.com';
  if (/(^|\/\/|\.)airbnb\.[a-z.]+(\/|$)/i.test(url)) return 'Airbnb';
  return 'Strona obiektu';
}

const LINK_LABELS = new Set(['Booking.com', 'Airbnb', 'Strona obiektu']);

/** Obecny link do obiektu, a bez niego pierwszy link punktu nie jest nim traktowany. */
export const lodgingLink = (item: Item) => item.links.find((link) => LINK_LABELS.has(link.label));

/** Link do obiektu w punkcie: zastępuje poprzedni, `null` usuwa; pozostałe linki zostają. */
export function setLodgingLink(doc: Doc, itemRef: string, url: string | null): { doc: Doc; item: Item } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const others = item.links.filter((link) => !LINK_LABELS.has(link.label));
  const next = { ...item, links: url === null ? others : [{ label: lodgingLinkLabel(url), url }, ...others] };
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next };
}

/** Rezerwacja punktu noclegu: własna albo noclegu tego dnia. */
export function lodgingBooking(doc: Doc, item: Item): Booking | undefined {
  const ref = item.bookingRef ?? (item.dayRef === undefined ? undefined : dayLodging(doc, item.dayRef)?.booking?.ref);
  return ref === undefined ? undefined : doc.bookings.find((each) => each.ref === ref);
}

const hostOf = (doc: Doc, booking: Booking | undefined) => (booking === undefined ? undefined : doc.contacts.find((contact) => contact.bookingRef === booking.ref && contact.role === 'host'));

/** Dane obiektu do pokazania na karcie, także offline na telefonie. */
export function lodgingDetails(doc: Doc, item: Item): string[] {
  const booking = lodgingBooking(doc, item);
  const details = booking?.lodging;
  return [
    booking?.checkInFrom ? `Zameldowanie od ${booking.checkInFrom}` : null,
    booking?.checkOutUntil ? `Wymeldowanie do ${booking.checkOutUntil}` : null,
    details?.breakfast ? `Śniadanie: ${details.breakfast}` : null,
    details?.rooms ? `Pokoje: ${details.rooms}` : null,
    details?.beds ? `Łóżka: ${details.beds}` : null,
    details && details.amenities.length > 0 ? `Udogodnienia: ${details.amenities.join(', ')}` : null,
  ].filter((line) => line !== null);
}

const contactLine = (contact: { phone?: string | null; email?: string | null; name?: string | null }) => [contact.name, contact.phone, contact.email].filter(Boolean).join(' · ');

/** Co szkic zmieniłby w planie; pola bez odczytanej wartości i te już takie same nie trafiają na listę. */
export function lodgingDraftRows(doc: Doc, item: Item, draft: LodgingDraft): LodgingDraftRow[] {
  const booking = lodgingBooking(doc, item);
  const place = doc.places.find((each) => each.ref === item.placeRef);
  const host = hostOf(doc, booking);
  const candidates: { key: LodgingField; label: string; value: string | null; current: string | undefined }[] = [
    { key: 'description', label: 'Opis', value: draft.description, current: item.description },
    ...(place ? [{ key: 'address' as const, label: 'Adres', value: draft.address, current: place.address }] : []),
    { key: 'checkInFrom', label: 'Zameldowanie od', value: draft.checkInFrom, current: booking?.checkInFrom },
    { key: 'checkOutUntil', label: 'Wymeldowanie do', value: draft.checkOutUntil, current: booking?.checkOutUntil },
    { key: 'breakfast', label: 'Śniadanie', value: draft.breakfast, current: booking?.lodging?.breakfast },
    { key: 'rooms', label: 'Pokoje', value: draft.rooms === null ? null : String(draft.rooms), current: booking?.lodging?.rooms === undefined ? undefined : String(booking.lodging.rooms) },
    { key: 'beds', label: 'Łóżka', value: draft.beds, current: booking?.lodging?.beds },
    { key: 'amenities', label: 'Udogodnienia', value: draft.amenities.length > 0 ? draft.amenities.join(', ') : null, current: booking?.lodging?.amenities.length ? booking.lodging.amenities.join(', ') : undefined },
    { key: 'confirmationCode', label: 'Kod rezerwacji', value: draft.confirmationCode, current: booking?.confirmationCode },
    {
      key: 'contact',
      label: 'Kontakt do obiektu',
      value: draft.phone || draft.email ? contactLine({ name: draft.hostName, phone: draft.phone, email: draft.email }) : null,
      current: host ? contactLine(host) : undefined,
    },
  ];
  return candidates.flatMap(({ key, label, value, current }) => (value === null || value === current ? [] : [{ key, label, value, ...(current ? { current } : {}) }]));
}

export type LodgingWrite =
  | { collection: 'places'; element: Place; op: 'update' }
  | { collection: 'bookings'; element: Booking; op: 'insert' | 'update' }
  | { collection: 'contacts'; element: Contact; op: 'insert' | 'update' };

const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Zapis zaznaczonych pól. Bez rezerwacji powstaje nowa na ten dzień („do rezerwacji”, a z kodem
 * „zarezerwowana”), bo godziny, śniadanie i kontakt są w planie częścią rezerwacji. `ids` to uuid
 * ewentualnych nowych wierszy. Kolejność `writes` pilnuje kluczy obcych: rezerwacja przed kontaktem.
 */
export function applyLodgingDraft(doc: Doc, itemRef: string, draft: LodgingDraft, fields: LodgingField[], ids: { bookingId: string; contactId: string }): { doc: Doc; item: Item; writes: LodgingWrite[] } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined) return null;
  const picked = new Set(fields);
  const writes: LodgingWrite[] = [];
  let next = doc;
  let nextItem: Item = item;

  if (picked.has('description') && draft.description !== null) nextItem = { ...nextItem, description: draft.description };

  const place = doc.places.find((each) => each.ref === item.placeRef);
  if (picked.has('address') && draft.address !== null && place !== undefined) {
    const updated = { ...place, address: draft.address };
    next = { ...next, places: next.places.map((each) => (each.ref === place.ref ? updated : each)) };
    writes.push({ collection: 'places', element: updated, op: 'update' });
  }

  const inBooking = (['checkInFrom', 'checkOutUntil', 'breakfast', 'beds', 'rooms', 'amenities', 'confirmationCode', 'contact'] as const).some((key) => picked.has(key));
  if (inBooking) {
    const current = lodgingBooking(doc, item);
    const day = doc.days.find((each) => each.ref === item.dayRef);
    const base: Booking =
      current ??
      ({
        ref: `id-${ids.bookingId}`,
        kind: 'lodging',
        status: draft.confirmationCode !== null && picked.has('confirmationCode') ? 'booked' : 'to_book',
        title: place?.name ?? item.title,
        ...(day ? { start: { date: day.date, precision: 'exact', tz: day.tz }, end: { date: nextDate(day.date), precision: 'exact', tz: day.tz } } : {}),
        ...(item.placeRef ? { startPlaceRef: item.placeRef } : {}),
        includes: [],
        addons: [],
        pros: [],
        cons: [],
        links: [],
        notes: [],
      } as Booking);
    const lodging = {
      amenities: [],
      ...base.lodging,
      ...(picked.has('breakfast') && draft.breakfast !== null ? { breakfast: draft.breakfast } : {}),
      ...(picked.has('beds') && draft.beds !== null ? { beds: draft.beds } : {}),
      ...(picked.has('rooms') && draft.rooms !== null ? { rooms: draft.rooms } : {}),
      ...(picked.has('amenities') && draft.amenities.length > 0 ? { amenities: draft.amenities } : {}),
    };
    const hasLodging = base.lodging !== undefined || (['breakfast', 'beds', 'rooms', 'amenities'] as const).some((key) => picked.has(key));
    const booking: Booking = {
      ...base,
      ...(picked.has('checkInFrom') && draft.checkInFrom !== null ? { checkInFrom: draft.checkInFrom } : {}),
      ...(picked.has('checkOutUntil') && draft.checkOutUntil !== null ? { checkOutUntil: draft.checkOutUntil } : {}),
      ...(picked.has('confirmationCode') && draft.confirmationCode !== null ? { confirmationCode: draft.confirmationCode } : {}),
      ...(hasLodging ? { lodging } : {}),
    };
    next = { ...next, bookings: current ? next.bookings.map((each) => (each.ref === booking.ref ? booking : each)) : [...next.bookings, booking] };
    writes.push({ collection: 'bookings', element: booking, op: current ? 'update' : 'insert' });
    nextItem = { ...nextItem, bookingRef: booking.ref };

    if (picked.has('contact') && (draft.phone !== null || draft.email !== null)) {
      const host = hostOf(doc, current);
      const contact: Contact = {
        ...(host ?? { ref: `id-${ids.contactId}`, name: draft.hostName ?? place?.name ?? item.title, role: 'host' as const, bookingRef: booking.ref }),
        ...(host && draft.hostName !== null ? { name: draft.hostName } : {}),
        ...(draft.phone !== null ? { phone: draft.phone } : {}),
        ...(draft.email !== null ? { email: draft.email } : {}),
      };
      next = { ...next, contacts: host ? next.contacts.map((each) => (each.ref === host.ref ? contact : each)) : [...next.contacts, contact] };
      writes.push({ collection: 'contacts', element: contact, op: host ? 'update' : 'insert' });
    }
  }

  next = { ...next, items: next.items.map((each) => (each.ref === itemRef ? nextItem : each)) };
  return { doc: next, item: nextItem, writes };
}
