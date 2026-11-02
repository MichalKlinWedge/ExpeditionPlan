import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Ikona punktu planu (emoji, ta sama na webie i w telefonie): przejazd — według środka transportu
 * (lot z rezerwacji też), reszta — według rodzaju punktu.
 */

type Item = TripDocument['items'][number];

const MODE: Record<string, string> = {
  walk: '🚶',
  hike: '🥾',
  car: '🚗',
  rental_car: '🚗',
  taxi: '🚕',
  hired_driver: '🚐',
  bus: '🚌',
  metro: '🚇',
  tram: '🚋',
  train: '🚆',
  ferry: '⛴️',
  boat: '🚤',
  cable_car: '🚡',
  flight: '✈️',
  bike: '🚲',
};

const KIND: Record<string, string> = {
  visit: '🏛️',
  activity: '🎒',
  meal: '🍽️',
  transport: '🚗',
  lodging: '🛏️',
  errand: '📋',
  meetup: '👥',
  free: '☕',
  decision: '🤔',
};

export function itemIcon(doc: TripDocument, item: Item): string {
  if (item.kind === 'transport') {
    if (item.leg?.mode) return MODE[item.leg.mode] ?? KIND.transport!;
    const booking = doc.bookings.find((each) => each.ref === item.bookingRef);
    if (booking?.kind === 'flight') return MODE.flight!;
    if (booking?.kind === 'transfer') return MODE.hired_driver!;
  }
  return KIND[item.kind] ?? '•';
}
