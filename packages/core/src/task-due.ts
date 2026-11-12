import { addDays } from './engine/time.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Terminy zadania jako daty: termin (`due`, także względny — przed wyjazdem, punktem, rezerwacją, w trakcie)
 * i osobny ostateczny termin wykonania (`deadline`). Otwarte zadanie po którymkolwiek z nich jest „po terminie”:
 * web i telefon pokazują je na czerwono, „Gotowość do wyjazdu” liczy je jako zaległe.
 */

type Doc = TripDocument;
type Task = Pick<Doc['tasks'][number], 'status' | 'due' | 'deadline'>;

/** Tyle z planu potrzeba do dat terminów: cały dokument albo same wiersze z bazy (licznik zadań w belce). */
export type TaskDueContext = {
  trip: { startDate: string; endDate: string };
  items: readonly { ref: string; dayRef?: string | undefined }[];
  days: readonly { ref: string; date: string }[];
  bookings: readonly { ref: string; start?: { date: string } | undefined }[];
};

/**
 * Data terminu `due`. „Przed rezerwacją” = dzień przed jej początkiem; „w trakcie” = jego dzień albo,
 * bez dnia, koniec wyjazdu. `undefined`, gdy terminu nie ma albo jego punkt czy rezerwacja nie mają daty.
 */
export function taskDueDate(doc: TaskDueContext, task: Task): string | undefined {
  const due = task.due;
  switch (due?.kind) {
    case 'absolute':
      return due.date;
    case 'before_trip':
      return addDays(doc.trip.startDate, -due.days);
    case 'before_item': {
      const dayRef = doc.items.find((item) => item.ref === due.itemRef)?.dayRef;
      const day = doc.days.find((each) => each.ref === dayRef);
      return day === undefined ? undefined : addDays(day.date, -due.days);
    }
    case 'before_booking': {
      const start = doc.bookings.find((booking) => booking.ref === due.bookingRef)?.start;
      return start === undefined ? undefined : addDays(start.date, -1);
    }
    case 'on_trip':
      return (due.dayRef === undefined ? undefined : doc.days.find((day) => day.ref === due.dayRef)?.date) ?? doc.trip.endDate;
    default:
      return undefined;
  }
}

/** Otwarte zadanie, którego termin albo ostateczny termin wykonania minął przed `today` (data lokalna). */
export function taskOverdue(doc: TaskDueContext, task: Task, today: string): boolean {
  if (task.status !== 'open') return false;
  const due = taskDueDate(doc, task);
  return (due !== undefined && due < today) || (task.deadline !== undefined && task.deadline < today);
}

/** Daty otwartego zadania do pilnowania: termin i „najpóźniej” (bez dat — pusta lista). */
export function taskDates(doc: TaskDueContext, task: Task): string[] {
  if (task.status !== 'open') return [];
  return [taskDueDate(doc, task), task.deadline].filter((date): date is string => date !== undefined);
}

/**
 * Pilność zadania z jego dat (`taskDates`) na dzień `today`: `overdue` — któraś minęła, `soon` — najbliższa
 * wypada w ciągu `soonDays` dni (od dziś włącznie), inaczej `null`.
 */
export function taskUrgency(dates: readonly string[], today: string, soonDays = 30): 'overdue' | 'soon' | null {
  if (dates.length === 0) return null;
  if (dates.some((date) => date < today)) return 'overdue';
  const limit = addDays(today, soonDays);
  return dates.some((date) => date <= limit) ? 'soon' : null;
}
