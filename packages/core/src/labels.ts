/**
 * Polskie nazwy wartości ze schematu, jedno źródło dla webu i telefonu. Te same słowa w całej
 * aplikacji: nowa wartość enuma dostaje nazwę tutaj, a nie w widoku.
 */

/** Rola w wyjeździe (`trip_members.role`). */
export const MEMBER_ROLE: Record<string, string> = { owner: 'organizator', editor: 'edytor', viewer: 'widz' };

/** Rola kontaktu (`DocContact.role`). */
export const CONTACT_ROLE: Record<string, string> = {
  host: 'gospodarz',
  operator: 'operator',
  rental: 'wypożyczalnia',
  guide: 'przewodnik',
  emergency: 'alarmowy',
  venue: 'obiekt',
  other: 'inny',
};

/** Rodzaj punktu planu (`ItemKind`). */
export const ITEM_KIND: Record<string, string> = {
  visit: 'zwiedzanie',
  activity: 'aktywność',
  meal: 'posiłek',
  transport: 'przejazd',
  lodging: 'nocleg',
  errand: 'sprawa',
  meetup: 'spotkanie',
  free: 'czas wolny',
  decision: 'decyzja',
};

/** Rodzaj rezerwacji (`BookingKind`). */
export const BOOKING_KIND: Record<string, string> = {
  flight: 'lot',
  train: 'pociąg',
  bus: 'autobus',
  ferry: 'prom',
  lodging: 'nocleg',
  car_rental: 'wynajem auta',
  transfer: 'transfer',
  driver_hire: 'kierowca',
  activity: 'atrakcja',
  package: 'pakiet',
  ticket: 'bilet',
  transit_pass: 'karta komunikacji',
  insurance: 'ubezpieczenie',
  esim: 'eSIM',
  luggage: 'bagaż',
  other: 'inne',
};

/** Podstawa ceny (`PriceBasis`). */
export const PRICE_BASIS: Record<string, string> = { per_group: 'za całość', per_person: 'za osobę', per_night: 'za noc', per_day: 'za dobę', per_unit: 'za sztukę' };

/** Status rezerwacji (`BookingStatus`). */
export const BOOKING_STATUS: Record<string, string> = {
  idea: 'pomysł',
  candidate: 'kandydat',
  to_book: 'do rezerwacji',
  booked: 'zarezerwowane',
  paid: 'zapłacone',
  cancelled: 'anulowane',
  unknown: 'nie wiadomo, czy kupione',
  not_required: 'bez rezerwacji',
};

/** Kiedy płatne i czym (`DocBooking.payWhen`, `paymentMethod`). */
export const PAY_WHEN: Record<string, string> = { prepaid: 'płatne z góry', on_site: 'płatność na miejscu', before_arrival: 'płatne przed przyjazdem' };
export const PAY_METHOD: Record<string, string> = { cash: 'gotówka', card: 'karta', credit_card_only: 'tylko karta kredytowa', online: 'online' };

/** Status pozycji budżetu. */
export const BUDGET_LINE_STATUS: Record<string, string> = { estimate: 'szacunek', committed: 'zobowiązanie', paid: 'zapłacone' };

/** Temat notatki praktycznej. */
export const NOTE_TOPIC: Record<string, string> = {
  documents: 'dokumenty',
  money: 'pieniądze',
  health: 'zdrowie',
  safety: 'bezpieczeństwo',
  transport: 'transport',
  culture: 'zwyczaje',
  rules: 'przepisy',
  weather: 'pogoda',
  time: 'czas',
  packing: 'pakowanie',
  other: 'inne',
};

/** Zapas czasu w dniu (`schedule.slack`). */
export const SLACK_LABEL = { large: 'duży zapas', small: 'mały zapas', none: 'bez zapasu', negative: 'dzień się nie spina' };

/** Obszar propozycji z przeglądu planu z AI (`ReviewCategory`). */
export const REVIEW_CATEGORY: Record<string, string> = {
  schedule: 'harmonogram',
  routes: 'trasy i przejazdy',
  map: 'mapa',
  descriptions: 'opisy',
  meals: 'posiłki',
  variants: 'plan B',
  other: 'inne',
};

/** Środek przejazdu (`LegMode`). */
export const LEG_MODE: Record<string, string> = {
  walk: 'pieszo',
  hike: 'trekking',
  car: 'samochód',
  rental_car: 'wynajęte auto',
  taxi: 'taksówka',
  hired_driver: 'kierowca',
  bus: 'autobus',
  metro: 'metro',
  tram: 'tramwaj',
  train: 'pociąg',
  ferry: 'prom',
  boat: 'łódź',
  cable_car: 'kolejka',
  flight: 'samolot',
  bike: 'rower',
};
