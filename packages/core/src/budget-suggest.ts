import { priceForGroup } from './engine/price.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Pozycje budżetu z planu (MVP-3: „pozycje z rezerwacji i cen punktów zasilają budżet”):
 * rezerwacje z ceną albo zapłatą i punkty dnia z ceną, które nie mają jeszcze swojej pozycji.
 * To propozycje — organizator dodaje je pojedynczo, bo zbiorcza pozycja („Wstępy: medersa
 * i Bahia”) bywa już wpisana bez powiązania z punktem.
 */

type Doc = TripDocument;
type Booking = Doc['bookings'][number];
type Item = Doc['items'][number];
type Line = Doc['budgetLines'][number];

export type BudgetDraft = Omit<Line, 'ref'>;
export type BudgetSuggestion = { source: 'booking' | 'item'; ref: string; title: string; line: BudgetDraft; note?: string };

const BOOKING_CATEGORY: Record<Booking['kind'], Line['category']> = {
  flight: 'flights',
  train: 'transport',
  bus: 'transport',
  ferry: 'transport',
  lodging: 'lodging',
  car_rental: 'car',
  transfer: 'transport',
  driver_hire: 'transport',
  activity: 'activities',
  package: 'activities',
  ticket: 'tickets',
  transit_pass: 'transport',
  insurance: 'insurance',
  esim: 'other',
  luggage: 'luggage',
  other: 'other',
};

const ITEM_CATEGORY: Partial<Record<Item['kind'], Line['category']>> = {
  visit: 'tickets',
  activity: 'activities',
  meal: 'food',
  transport: 'transport',
  lodging: 'lodging',
};

/** Rezerwacje, które realnie wchodzą do kosztów — bez pomysłów, kandydatów i anulowanych. */
const COUNTED: ReadonlySet<Booking['status']> = new Set(['to_book', 'booked', 'paid', 'unknown']);

/** Dni między datami (noce noclegu, doby najmu); co najmniej 1. */
export function nightsBetween(start: string | undefined, end: string | undefined): number {
  if (start === undefined || end === undefined) return 1;
  const days = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
  return Math.max(1, days);
}

/** Kwota rezerwacji dla całej grupy: cena za noc × noce, za osobę × uczestnicy (z progami wieku). */
export function bookingAmount(doc: Doc, booking: Booking): { lowMinor: number; highMinor: number; currency: string; note?: string } | null {
  if (booking.paid) return { lowMinor: booking.paid.amountMinor, highMinor: booking.paid.amountMinor, currency: booking.paid.currency };
  const price = booking.price;
  if (price === undefined) return null;
  const group = priceForGroup(price, doc.travelers);
  const times = price.basis === 'per_night' || price.basis === 'per_day' ? nightsBetween(booking.start?.date, booking.end?.date) : 1;
  const note = times > 1 ? `${times} × ${price.basis === 'per_night' ? 'noc' : 'doba'}` : undefined;
  // „od X” — górna granica nieznana: obie kwoty od dołu, żeby suma nie udawała pewności.
  return { lowMinor: group.minMinor * times, highMinor: (price.from ? group.minMinor : group.maxMinor) * times, currency: group.currency, ...(note ? { note } : {}) };
}

export function budgetSuggestions(doc: Doc): BudgetSuggestion[] {
  const linkedBookings = new Set(doc.budgetLines.map((line) => line.bookingRef).filter((ref) => ref !== undefined));
  const linkedItems = new Set(doc.budgetLines.map((line) => line.itemRef).filter((ref) => ref !== undefined));
  const result: BudgetSuggestion[] = [];

  for (const booking of doc.bookings) {
    if (!COUNTED.has(booking.status) || linkedBookings.has(booking.ref)) continue;
    const amount = bookingAmount(doc, booking);
    if (amount === null) continue;
    result.push({
      source: 'booking',
      ref: booking.ref,
      title: booking.title,
      ...(amount.note ? { note: amount.note } : {}),
      line: {
        category: BOOKING_CATEGORY[booking.kind],
        title: booking.title,
        bookingRef: booking.ref,
        status: booking.paid || booking.status === 'paid' ? 'paid' : booking.status === 'booked' ? 'committed' : 'estimate',
        lowMinor: amount.lowMinor,
        highMinor: amount.highMinor,
        currency: amount.currency,
        perPerson: false,
      },
    });
  }

  for (const item of doc.items) {
    const price = item.price;
    // Punkt w pakiecie albo z rezerwacją liczy się w rezerwacji; darmowy — wcale.
    if (price === undefined || item.dayRef === undefined || item.bookingRef !== undefined || item.payment === 'included' || item.payment === 'free') continue;
    if (linkedItems.has(item.ref) || (item.planStatus !== 'scheduled' && item.variantRefs.length === 0)) continue;
    const people = item.participantRefs && item.participantRefs.length > 0 ? doc.travelers.filter((traveler) => item.participantRefs!.includes(traveler.ref)) : doc.travelers;
    const group = priceForGroup(price, people);
    result.push({
      source: 'item',
      ref: item.ref,
      title: item.title,
      ...(group.unknownAgeRefs.length > 0 ? { note: 'bez wieku części osób — liczone po najwyższym progu' } : {}),
      line: {
        category: ITEM_CATEGORY[item.kind] ?? 'other',
        title: item.title,
        itemRef: item.ref,
        status: item.payment === 'prepaid' ? 'committed' : 'estimate',
        lowMinor: group.minMinor,
        highMinor: price.from ? group.minMinor : group.maxMinor,
        currency: group.currency,
        perPerson: false,
        // Cena policzona dla uczestników punktu, więc pozycja dotyczy tylko ich.
        ...(item.participantRefs && item.participantRefs.length > 0 ? { participantRefs: item.participantRefs } : {}),
      },
    });
  }
  return result;
}
