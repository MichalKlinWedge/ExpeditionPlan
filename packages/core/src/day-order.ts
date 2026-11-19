import { dayChip } from './format.ts';
import { shortText } from './memory-timeline.ts';
import { dayLodging, LIVE_BOOKING } from './plan-info.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * „Kolejność dni”: zamiana programów całych dni. Program dnia (punkty, tytuł, wstęp, godziny dnia, scenariusze,
 * atrakcje „po drodze”, warianty, ograniczenia i zadania dnia) to wszystko, co wskazuje wiersz dnia, więc zamiana
 * przestawia daty wierszy, a nie przenosi punktów: zapis dotyczy tylko dni, a odwołania do dnia jadą z programem.
 * Przy dacie zostają noclegi (`lodgingRef`, `baseRef`, a rezerwacje noclegu mają własne daty) i rezerwacje punktów
 * na konkretny dzień — te pokazuje `dayOrderNotes`, bo po zamianie nie pasują do nowej daty.
 */

type Doc = TripDocument;
type Day = Doc['days'][number];

/** Punkt programu przypięty do daty: rezerwacja na ten dzień albo stała godzina. */
export type HeldPoint = { title: string; reason: 'booking' | 'fixed'; date: string };

/** Wiersz listy dni: program dnia z krótkim opisem, nocleg tej daty i punkty, które jej potrzebują. */
export type DayProgram = {
  ref: string;
  date: string;
  title: string;
  summary: string;
  points: number;
  lodging: string | null;
  held: HeldPoint[];
};

const SUMMARY_CHARS = 140;
const byDate = (a: Day, b: Day) => a.date.localeCompare(b.date);

export function dayPrograms(doc: Doc): DayProgram[] {
  const bookings = new Map(doc.bookings.map((booking) => [booking.ref, booking]));
  return [...doc.days].sort(byDate).map((day) => {
    const items = doc.items.filter((item) => item.dayRef === day.ref && item.planStatus === 'scheduled').sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''));
    const top = items.filter((item) => item.parentRef === undefined);
    const held = items.flatMap((item): HeldPoint[] => {
      const booking = item.bookingRef === undefined ? undefined : bookings.get(item.bookingRef);
      if (booking?.start !== undefined && LIVE_BOOKING.has(booking.status) && booking.start.date === day.date) return [{ title: item.title, reason: 'booking', date: day.date }];
      return item.isFixed === true ? [{ title: item.title, reason: 'fixed', date: day.date }] : [];
    });
    const text = day.summary?.trim() || top.map((item) => item.title).join(' · ');
    return {
      ref: day.ref,
      date: day.date,
      title: day.title?.trim() || top[0]?.title || 'Dzień bez punktów',
      summary: text === '' ? '' : shortText(text, SUMMARY_CHARS),
      points: items.length,
      lodging: dayLodging(doc, day.ref)?.name ?? null,
      held,
    };
  });
}

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((ref, index) => ref === b[index]);

/**
 * Programy dni w kolejności `order` (refy dni): i-ty program dostaje i-tą datę wyjazdu razem z jej noclegiem i bazą.
 * `null` = to nie jest przestawienie dni tego wyjazdu albo nic się nie zmienia.
 */
export function reorderDays(doc: Doc, order: readonly string[]): { doc: Doc; changed: Day[] } | null {
  const sorted = [...doc.days].sort(byDate);
  const current = sorted.map((day) => day.ref);
  if (order.length !== sorted.length || new Set(order).size !== order.length || order.some((ref) => !current.includes(ref))) return null;
  if (sameOrder(order, current)) return null;
  const days = order.map((ref, index): Day => {
    const program = sorted.find((day) => day.ref === ref)!;
    const slot = sorted[index]!;
    const { lodgingRef: _lodging, baseRef: _base, ...rest } = program;
    return {
      ...rest,
      date: slot.date,
      ...(slot.lodgingRef !== undefined ? { lodgingRef: slot.lodgingRef } : {}),
      ...(slot.baseRef !== undefined ? { baseRef: slot.baseRef } : {}),
    };
  });
  const before = new Map(sorted.map((day) => [day.ref, day]));
  const changed = days.filter((day) => {
    const old = before.get(day.ref)!;
    return old.date !== day.date || old.lodgingRef !== day.lodgingRef || old.baseRef !== day.baseRef;
  });
  return { doc: { ...doc, days }, changed };
}

/** Co po przestawieniu nie pasuje: rezerwacje i stałe godziny z innej daty oraz inny nocleg niż przy dawnej dacie. */
export function dayOrderNotes(programs: readonly DayProgram[], order: readonly string[]): string[] {
  const notes: string[] = [];
  order.forEach((ref, index) => {
    const program = programs.find((each) => each.ref === ref);
    const slot = programs[index];
    if (program === undefined || slot === undefined || program.date === slot.date) return;
    for (const point of program.held) {
      notes.push(
        point.reason === 'booking'
          ? `„${point.title}” ma rezerwację na ${dayChip(point.date)}, a program idzie na ${dayChip(slot.date)} — rezerwacja się nie przesunie.`
          : `„${point.title}” ma stałą godzinę z ${dayChip(point.date)} — sprawdź, czy pasuje do ${dayChip(slot.date)}.`,
      );
    }
    if (program.lodging !== slot.lodging && (program.lodging !== null || slot.lodging !== null)) {
      notes.push(`„${program.title}” był planowany przy noclegu ${program.lodging ?? '(brak)'}, a noc ${dayChip(slot.date)} zostaje w: ${slot.lodging ?? '(brak noclegu)'}.`);
    }
  });
  return notes;
}
