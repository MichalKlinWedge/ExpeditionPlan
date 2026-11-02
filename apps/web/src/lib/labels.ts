export const ROLE: Record<string, string> = { owner: "właściciel", editor: "edytor", viewer: "widz" };

/** „26–31 grudnia 2026” — daty wyjazdu bez strefy (to daty kalendarzowe). */
export const tripDates = (start: string, end: string) =>
  new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatRange(
    new Date(`${start}T00:00:00Z`),
    new Date(`${end}T00:00:00Z`),
  );

/** Rodzaj rezerwacji (`BookingKind`). */
export const BOOKING_KIND: Record<string, string> = {
  flight: "lot",
  train: "pociąg",
  bus: "autobus",
  ferry: "prom",
  lodging: "nocleg",
  car_rental: "wynajem auta",
  transfer: "transfer",
  driver_hire: "kierowca",
  activity: "atrakcja",
  package: "pakiet",
  ticket: "bilet",
  transit_pass: "karta komunikacji",
  insurance: "ubezpieczenie",
  esim: "eSIM",
  luggage: "bagaż",
  other: "inne",
};
