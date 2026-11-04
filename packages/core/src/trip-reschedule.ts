import { scheduleDay, type ScheduleWarning } from './engine/schedule.ts';
import { addDays } from './engine/time.ts';
import { IsoDate } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Zmiana terminu wyjazdu: cały plan o tę samą liczbę dni, długość bez zmian.
 *
 * Razem z planem idzie to, co od niego zależy: `trip.startDate/endDate`, daty dni, rezerwacje jeszcze
 * niekupione (z `freeCancellationUntil`, bo to warunek oferty na dany termin), terminy `absolute`
 * otwartych zadań i `decideBy` z datą. Terminy względne (`before_trip`, `before_item`, `on_trip`,
 * `before_booking`, `decideBy.time`) i godziny punktów nie mają daty — liczą się od dnia same.
 *
 * Zostaje to, co jest faktem: rezerwacje kupione (`booked`, `paid`, zapłata albo kod potwierdzenia —
 * data zmienia się u dostawcy, więc to zadanie dla człowieka, a nie dla planu), odwołane,
 * `paid.date`, `checkedAt` cen i źródeł, `fx.date`, zadania zamknięte oraz wydatki, dziennik
 * i zdarzenia z trasy (poza dokumentem).
 */

type Doc = TripDocument;
type Booking = Doc['bookings'][number];

/** Data z kalendarza, a nie tylko w dobrym formacie: 2027-02-31 odpada. */
export const isRealDate = (date: string) => IsoDate.safeParse(date).success && addDays(date, 0) === date;

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** Kupiona: data jest ustalona z dostawcą. Status bywa nieaktualny, zapłata i kod już nie. */
const isBought = (booking: Booking) =>
  booking.status === 'booked' || booking.status === 'paid' || booking.paid !== undefined || booking.confirmationCode !== undefined;

const WEEKDAY_IN_TEXT = /(?<!\p{L})(?:poniedział\p{L}*|wtor\p{L}*|środ[aęy]|czwart\p{L}*|piąt(?:ek|ku)|sobot\p{L}*|niedziel\p{L}*)(?!\p{L})/iu;
const DATE_IN_TEXT =
  /(?<![\d.])\d{1,2}\.(?:0?[1-9]|1[0-2])(?!\d)|(?<!\d)\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?!\p{L})/iu;

export type TripShift = {
  /** O ile dni przesuwa się plan; ujemna wartość = wcześniej. */
  offsetDays: number;
  startDate: string;
  endDate: string;
  /** Dokument po zmianie. */
  doc: Doc;
  /** Klucze elementów, które się zmieniły — tylko one idą do zapisu. */
  moved: { days: string[]; bookings: string[]; tasks: string[]; variantGroups: string[] };
  /** Co człowiek musi sprawdzić sam, bo plan tego nie przesunie albo nie wie, czy słusznie. */
  review: TripShiftReview;
};

export type TripShiftReview = {
  /** Kupione rezerwacje przy starych datach. */
  keptBookings: { ref: string; title: string; start?: string; end?: string }[];
  /** Przesunięte, ale dokument nie mówi, czy kupione (`unknown`). */
  uncertainBookings: { ref: string; title: string }[];
  /** Przesunięte rezerwacje z ceną: była sprawdzana na stary termin. */
  repriceBookings: { ref: string; title: string }[];
  /** Otwarte zadania z konkretną datą, przypięte do kupionej rezerwacji: termin zostaje. */
  keptTasks: { ref: string; title: string; date: string }[];
  /** Tytuły dni, w których data albo dzień tygodnia przestają się zgadzać. */
  dayTitles: { ref: string; title: string }[];
  /** Inny dzień tygodnia: godziny otwarcia i zamknięcia w dni tygodnia trzeba sprawdzić. */
  weekdaysChange: boolean;
  /** Nowe problemy dni wg silnika: zachód słońca, zamknięte miejsca, zmiana czasu między strefami. */
  schedule: { dayRef: string; date: string; message: string }[];
};

/** Tyle minut poślizgu względem planu to już nie zaokrąglenie (bramka PoC-5). */
const DRIFT_LIMIT_MIN = 15;

const isSerious = (warning: ScheduleWarning) =>
  warning.severity === 'hard' || warning.kind === 'closed' || (warning.kind === 'late' && (warning.minutes ?? 0) > DRIFT_LIMIT_MIN);

function seriousWarnings(doc: Doc): Map<string, { dayRef: string; date: string; message: string }> {
  const found = new Map<string, { dayRef: string; date: string; message: string }>();
  for (const day of doc.days) {
    for (const scenario of ['optimistic', 'pessimistic'] as const) {
      for (const warning of scheduleDay(doc, day.ref, { scenario }).warnings.filter(isSerious)) {
        const key = `${day.ref}|${warning.kind}|${warning.itemRef ?? ''}|${warning.constraintIndex ?? ''}`;
        if (!found.has(key)) found.set(key, { dayRef: day.ref, date: day.date, message: warning.message });
      }
    }
  }
  return found;
}

/** Plan przesunięty tak, żeby zaczynał się `newStart`. Nie zmienia wejścia. */
export function shiftTripDates(doc: Doc, newStart: string): TripShift {
  if (!isRealDate(newStart)) throw new Error(`Niepoprawna data: ${newStart}`);
  const offsetDays = daysBetween(doc.trip.startDate, newStart);
  const shift = (date: string) => addDays(date, offsetDays);
  const weekdaysChange = offsetDays % 7 !== 0;
  const moved: TripShift['moved'] = { days: [], bookings: [], tasks: [], variantGroups: [] };
  const review: TripShiftReview = { keptBookings: [], uncertainBookings: [], repriceBookings: [], keptTasks: [], dayTitles: [], weekdaysChange, schedule: [] };
  const endDate = shift(doc.trip.endDate);
  if (offsetDays === 0) return { offsetDays, startDate: newStart, endDate, doc, moved, review };

  const days = doc.days.map((day) => {
    moved.days.push(day.ref);
    const title = day.title ?? '';
    if (DATE_IN_TEXT.test(title) || (weekdaysChange && WEEKDAY_IN_TEXT.test(title))) review.dayTitles.push({ ref: day.ref, title });
    return { ...day, date: shift(day.date) };
  });

  const bookings = doc.bookings.map((booking) => {
    if (booking.status === 'cancelled') return booking;
    if (isBought(booking)) {
      if (booking.start !== undefined || booking.end !== undefined) {
        review.keptBookings.push({ ref: booking.ref, title: booking.title, ...(booking.start ? { start: booking.start.date } : {}), ...(booking.end ? { end: booking.end.date } : {}) });
      }
      return booking;
    }
    if (booking.start === undefined && booking.end === undefined && booking.freeCancellationUntil === undefined) return booking;
    moved.bookings.push(booking.ref);
    if (booking.status === 'unknown') review.uncertainBookings.push({ ref: booking.ref, title: booking.title });
    if (booking.price !== undefined) review.repriceBookings.push({ ref: booking.ref, title: booking.title });
    return {
      ...booking,
      ...(booking.start ? { start: { ...booking.start, date: shift(booking.start.date) } } : {}),
      ...(booking.end ? { end: { ...booking.end, date: shift(booking.end.date) } } : {}),
      ...(booking.freeCancellationUntil ? { freeCancellationUntil: shift(booking.freeCancellationUntil) } : {}),
    };
  });

  const bought = new Set(doc.bookings.filter((booking) => booking.status !== 'cancelled' && isBought(booking)).map((booking) => booking.ref));
  const tasks = doc.tasks.map((task) => {
    if (task.due?.kind !== 'absolute' || task.status !== 'open') return task;
    if (task.bookingRef !== undefined && bought.has(task.bookingRef)) {
      review.keptTasks.push({ ref: task.ref, title: task.title, date: task.due.date });
      return task;
    }
    moved.tasks.push(task.ref);
    return { ...task, due: { ...task.due, date: shift(task.due.date) } };
  });

  const variantGroups = doc.variantGroups.map((group) => {
    if (group.decideBy === undefined || !('local' in group.decideBy)) return group;
    moved.variantGroups.push(group.ref);
    const { local } = group.decideBy;
    return { ...group, decideBy: { ...group.decideBy, local: `${shift(local.slice(0, 10))}${local.slice(10)}` } };
  });

  const next: Doc = { ...doc, trip: { ...doc.trip, startDate: newStart, endDate }, days, bookings, tasks, variantGroups };
  const before = seriousWarnings(doc);
  review.schedule = [...seriousWarnings(next)].filter(([key]) => !before.has(key)).map(([, warning]) => warning);
  return { offsetDays, startDate: newStart, endDate, doc: next, moved, review };
}

/**
 * Brief poza dokumentem: daty `fixed` idą za planem, żeby kolejne „Zaplanuj z AI” nie wróciło do
 * starego terminu. `flexible` nie ma dat, a `fixed[]` to elementy już ustalone, więc zostają.
 * `null` = nie ma czego zmieniać. Brief z bazy może być niepełny, stąd `unknown`.
 */
export function shiftBriefDates(brief: unknown, offsetDays: number): Record<string, unknown> | null {
  if (offsetDays === 0 || typeof brief !== 'object' || brief === null) return null;
  const dates = (brief as { dates?: { kind?: unknown; start?: unknown; end?: unknown } }).dates;
  if (dates?.kind !== 'fixed' || typeof dates.start !== 'string' || typeof dates.end !== 'string') return null;
  return { ...brief, dates: { ...dates, start: addDays(dates.start, offsetDays), end: addDays(dates.end, offsetDays) } };
}

/**
 * Propozycja daty przy przywracaniu: najbliższy termin od dziś co pełne 52 tygodnie — ten sam dzień
 * tygodnia (wyjazd weekendowy zostaje weekendowy) i prawie ta sama pora roku.
 */
export function suggestNewStart(start: string, today: string): string {
  let candidate = start;
  while (candidate < today) candidate = addDays(candidate, 364);
  return candidate;
}
