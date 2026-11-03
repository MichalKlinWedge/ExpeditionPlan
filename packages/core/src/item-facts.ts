import { formatMoney } from './budget.ts';
import { priceForGroup } from './engine/price.ts';
import type { dayLodging } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Karta punktu w terenie (MVP-4): ile zapłaci cała grupa, czym i kiedy, rezerwacja z kodem
 * i kontakty do niej (gospodarz, wypożyczalnia) — z samego planu, offline. Telefon pokazuje to
 * w szczegółach punktu, a przy noclegu dnia — telefon do gospodarza.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Booking = Doc['bookings'][number];
type Contact = Doc['contacts'][number];
type Price = NonNullable<Item['price']>;

const PAYMENT: Record<NonNullable<Item['payment']>, string> = {
  cash_only: 'tylko gotówka',
  card: 'karta',
  prepaid: 'zapłacone z góry',
  included: 'w cenie',
  free: 'bezpłatne',
};
const PAY_METHOD: Record<NonNullable<Booking['paymentMethod']>, string> = { cash: 'gotówka', card: 'karta', credit_card_only: 'tylko karta kredytowa', online: 'online' };
const PAY_WHEN: Record<NonNullable<Booking['payWhen']>, string> = { prepaid: 'płatne z góry', on_site: 'płatność na miejscu', before_arrival: 'płatne przed przyjazdem' };
const BASIS: Partial<Record<Price['basis'], string>> = { per_night: 'za noc', per_day: 'za dobę', per_unit: 'za sztukę' };

export type ItemFacts = {
  /** „ok. 70–90 MAD za grupę” / „120 MAD za 5 os. (2 × 50, …)”. */
  price?: string;
  /** Uwaga do ceny z planu („wyłącznie gotówką w dirhamach”). */
  priceNote?: string;
  /** „tylko gotówka” / „w cenie: Pakiet Agafay” / „płatność na miejscu · karta”. */
  payment?: string;
  booking?: { ref: string; title: string; code?: string; status: Booking['status'] };
  contacts: Contact[];
};

const range = (low: number, high: number, currency: string) => (low === high ? formatMoney(low, currency) : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`);

/** Cena punktu dla tych, którzy w nim biorą udział (uczestnicy punktu albo cała grupa). */
export function groupPriceLine(doc: Doc, item: Item, price: Price): string {
  const people = (item.participantRefs ?? []).length > 0 ? doc.travelers.filter((traveler) => item.participantRefs!.includes(traveler.ref)) : doc.travelers;
  const group = priceForGroup(price, people);
  const prefix = price.from ? 'od ' : group.approx ? 'ok. ' : '';
  const amount = price.from ? formatMoney(group.minMinor, price.currency) : range(group.minMinor, group.maxMinor, price.currency);
  if (price.basis !== 'per_person') return `${prefix}${amount}${BASIS[price.basis] ? ` ${BASIS[price.basis]}` : ' za całość'}`;
  const each = price.from ? formatMoney(price.minMinor, price.currency) : range(price.minMinor, price.maxMinor, price.currency);
  return `${prefix}${amount} za ${people.length} os.${price.tiers?.length ? ' (wg wieku)' : ` (${each} za osobę)`}`;
}

/** Kontakty rezerwacji: najpierw gospodarz, potem reszta (wypożyczalnia, obiekt…). */
export function bookingContacts(doc: Doc, bookingRef: string | undefined): Contact[] {
  if (bookingRef === undefined) return [];
  return doc.contacts.filter((contact) => contact.bookingRef === bookingRef).sort((a, b) => Number(b.role === 'host') - Number(a.role === 'host'));
}

export function itemFacts(doc: Doc, item: Item): ItemFacts {
  const price = item.price ?? item.leg?.price;
  const booking = item.bookingRef === undefined ? undefined : doc.bookings.find((each) => each.ref === item.bookingRef);
  const payment = [
    item.payment === 'included' && booking ? `w cenie: ${booking.title}` : item.payment ? PAYMENT[item.payment] : undefined,
    item.payment === undefined && booking?.payWhen ? PAY_WHEN[booking.payWhen] : undefined,
    item.payment === undefined && booking?.paymentMethod ? PAY_METHOD[booking.paymentMethod] : undefined,
  ].filter((part): part is string => part !== undefined);
  return {
    ...(price && item.payment !== 'included' && item.payment !== 'free' ? { price: groupPriceLine(doc, item, price) } : {}),
    ...(price?.note ? { priceNote: price.note } : {}),
    ...(payment.length > 0 ? { payment: payment.join(' · ') } : {}),
    ...(booking ? { booking: { ref: booking.ref, title: booking.title, ...(booking.confirmationCode ? { code: booking.confirmationCode } : {}), status: booking.status } } : {}),
    contacts: bookingContacts(doc, booking?.ref),
  };
}

/** Kontakty noclegu dnia (gospodarz pierwszy) — przycisk „Zadzwoń” na karcie noclegu. */
export function lodgingContacts(doc: Doc, lodging: ReturnType<typeof dayLodging>): Contact[] {
  return bookingContacts(doc, lodging?.booking?.ref);
}
