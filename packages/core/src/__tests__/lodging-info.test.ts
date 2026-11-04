import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyLodgingDraft, lodgingBooking, lodgingDetails, type LodgingDraft, lodgingDraftRows, lodgingLink, lodgingLinkLabel, setLodgingLink } from '../lodging-info.ts';
import { documentProblem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const EMPTY: LodgingDraft = {
  isLodging: true,
  description: null,
  address: null,
  checkInFrom: null,
  checkOutUntil: null,
  breakfast: null,
  beds: null,
  rooms: null,
  amenities: [],
  confirmationCode: null,
  hostName: null,
  phone: null,
  email: null,
};
const IDS = { bookingId: 'rez', contactId: 'kontakt' };

/** Plan z punktem noclegu bez rezerwacji: noclegi planu są tylko pomysłami, więc dzień żadnej nie ma. */
function bare() {
  const doc = fixture('barcelona');
  const found = doc.items.find((each) => each.kind === 'lodging' && each.dayRef !== undefined)!;
  const { bookingRef: _ref, ...item } = found;
  const parsed = TripDocument.parse({
    ...doc,
    bookings: doc.bookings.map((booking) => (booking.kind === 'lodging' ? { ...booking, status: 'idea' } : booking)),
    items: doc.items.map((each) => (each.ref === item.ref ? item : each)),
  });
  return { doc: parsed, item: parsed.items.find((each) => each.ref === item.ref)! };
}

describe('link do obiektu', () => {
  it('etykieta po adresie, zastępuje poprzedni link obiektu, inne linki zostają', () => {
    expect(lodgingLinkLabel('https://www.booking.com/hotel/es/x.pl.html')).toBe('Booking.com');
    expect(lodgingLinkLabel('https://www.airbnb.pl/rooms/1')).toBe('Airbnb');
    expect(lodgingLinkLabel('https://notbooking.com/hotel')).toBe('Strona obiektu');

    const { doc, item } = bare();
    const withOther = TripDocument.parse({ ...doc, items: doc.items.map((each) => (each.ref === item.ref ? { ...item, links: [{ label: 'Dojazd', url: 'https://example.com/dojazd' }] } : each)) });
    const first = setLodgingLink(withOther, item.ref, 'https://www.booking.com/hotel/es/a.html')!;
    expect(first.item.links.map((link) => link.label)).toEqual(['Booking.com', 'Dojazd']);
    const second = setLodgingLink(first.doc, item.ref, 'https://obiekt.example.com')!;
    expect(lodgingLink(second.item)).toEqual({ label: 'Strona obiektu', url: 'https://obiekt.example.com' });
    expect(second.item.links).toHaveLength(2);
    expect(setLodgingLink(second.doc, item.ref, null)!.item.links.map((link) => link.label)).toEqual(['Dojazd']);
  });
});

describe('szkic z wklejonego tekstu', () => {
  const draft: LodgingDraft = { ...EMPTY, description: 'Apartament przy porcie.', address: 'Carrer Ample 12', checkInFrom: '15:00', checkOutUntil: '11:00', breakfast: 'w cenie', rooms: 2, beds: '2 podwójne', amenities: ['Wi-Fi', 'kuchnia'], confirmationCode: 'ABC123', hostName: 'Marta', phone: '+34 600 000 000' };

  it('bez rezerwacji powstaje nowa na ten dzień, z kontaktem i danymi; punkt ją wskazuje', () => {
    const { doc, item } = bare();
    const rows = lodgingDraftRows(doc, item, draft);
    expect(rows.map((row) => row.key)).toContain('checkInFrom');
    const edit = applyLodgingDraft(doc, item.ref, draft, rows.map((row) => row.key), IDS)!;
    const booking = edit.doc.bookings.find((each) => each.ref === 'id-rez')!;
    expect(booking).toMatchObject({ kind: 'lodging', status: 'booked', checkInFrom: '15:00', checkOutUntil: '11:00', confirmationCode: 'ABC123', lodging: { breakfast: 'w cenie', rooms: 2, beds: '2 podwójne', amenities: ['Wi-Fi', 'kuchnia'] } });
    const day = doc.days.find((each) => each.ref === item.dayRef)!;
    expect(booking.start?.date).toBe(day.date);
    expect(booking.end!.date > day.date).toBe(true);
    expect(edit.item).toMatchObject({ bookingRef: 'id-rez', description: 'Apartament przy porcie.' });
    expect(edit.doc.contacts.find((each) => each.ref === 'id-kontakt')).toMatchObject({ name: 'Marta', role: 'host', phone: '+34 600 000 000', bookingRef: 'id-rez' });
    expect(edit.doc.places.find((each) => each.ref === item.placeRef)?.address).toBe('Carrer Ample 12');
    expect(edit.writes.map((write) => `${write.collection}:${write.op}`)).toEqual(['places:update', 'bookings:insert', 'contacts:insert']);
    expect(documentProblem(TripDocument.parse(edit.doc))).toBeNull();
    expect(lodgingBooking(edit.doc, edit.item)?.ref).toBe('id-rez');
    expect(lodgingDetails(edit.doc, edit.item)).toEqual(['Zameldowanie od 15:00', 'Wymeldowanie do 11:00', 'Śniadanie: w cenie', 'Pokoje: 2', 'Łóżka: 2 podwójne', 'Udogodnienia: Wi-Fi, kuchnia']);
  });

  it('zapisuje tylko zaznaczone; inna wartość w planie ma `current`, taka sama znika z podglądu', () => {
    const { doc, item } = bare();
    const first = applyLodgingDraft(doc, item.ref, { ...draft, checkInFrom: '14:00' }, ['checkInFrom'], IDS)!;
    expect(first.item.description).toBe(item.description);
    const booking = first.doc.bookings.find((each) => each.ref === 'id-rez')!;
    expect(booking).toMatchObject({ status: 'to_book', checkInFrom: '14:00' });
    expect(booking.lodging).toBeUndefined();
    expect(first.writes.map((write) => write.collection)).toEqual(['bookings']);

    const rows = lodgingDraftRows(first.doc, first.item, draft);
    expect(rows.find((row) => row.key === 'checkInFrom')).toEqual({ key: 'checkInFrom', label: 'Zameldowanie od', value: '15:00', current: '14:00' });
    expect(lodgingDraftRows(first.doc, first.item, { ...draft, checkInFrom: '14:00' }).some((row) => row.key === 'checkInFrom')).toBe(false);
  });

  it('istniejąca rezerwacja i gospodarz są uzupełniane, nie dublowane', () => {
    const { doc, item } = bare();
    const created = applyLodgingDraft(doc, item.ref, draft, ['checkInFrom', 'contact'], IDS)!;
    const updated = applyLodgingDraft(created.doc, item.ref, { ...EMPTY, email: 'obiekt@example.com', checkOutUntil: '10:00' }, ['checkOutUntil', 'contact'], { bookingId: 'inna', contactId: 'inny' })!;
    expect(updated.doc.bookings).toHaveLength(created.doc.bookings.length);
    expect(updated.doc.bookings.find((each) => each.ref === 'id-rez')).toMatchObject({ checkInFrom: '15:00', checkOutUntil: '10:00' });
    expect(updated.doc.contacts.filter((each) => each.bookingRef === 'id-rez')).toHaveLength(1);
    expect(updated.doc.contacts.find((each) => each.ref === 'id-kontakt')).toMatchObject({ phone: '+34 600 000 000', email: 'obiekt@example.com' });
  });
});
