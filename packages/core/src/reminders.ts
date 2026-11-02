import { addDays, zonedToInstant } from './engine/time.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Przypomnienia z planu (powiadomienia lokalne w telefonie — działają offline): otwarte zadania
 * z terminem i „Jutro wyjazd”. Przed wyjazdem liczone w strefie domowej, w trakcie — w strefie dnia.
 * Godzina domyślna 9:00 (zadania), 19:00 (dzień przed wyjazdem).
 */

type Doc = TripDocument;
export type Reminder = { key: string; title: string; body: string; at: number };

export function tripReminders(doc: Doc, now: number): Reminder[] {
  const home = doc.trip.homeTz;
  const days = new Map(doc.days.map((day) => [day.ref, day]));
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const bookings = new Map(doc.bookings.map((booking) => [booking.ref, booking]));
  const out: Reminder[] = [];
  const add = (key: string, title: string, body: string, date: string | undefined, time: string, tz: string) => {
    if (date === undefined) return;
    const at = zonedToInstant(date, time, tz);
    if (at > now) out.push({ key, title, body, at });
  };

  for (const task of doc.tasks) {
    if (task.status !== 'open' || task.due === undefined) continue;
    const due = task.due;
    const title = task.priority === 'high' ? `Ważne: ${task.title}` : task.title;
    const body = `${doc.trip.title}${task.body ? ` — ${task.body}` : ''}`;
    const key = `task:${task.ref}`;
    switch (due.kind) {
      case 'absolute':
        add(key, title, body, due.date, due.time ?? '09:00', home);
        break;
      case 'before_trip':
        add(key, title, body, addDays(doc.trip.startDate, -due.days), '09:00', home);
        break;
      case 'before_item': {
        const day = days.get(items.get(due.itemRef)?.dayRef ?? '');
        if (day) add(key, title, body, addDays(day.date, -due.days), '09:00', day.tz);
        break;
      }
      case 'before_booking': {
        const start = bookings.get(due.bookingRef)?.start;
        if (start) add(key, title, body, addDays(start.date, -1), '09:00', start.tz ?? home);
        break;
      }
      case 'on_trip': {
        const day = due.dayRef ? days.get(due.dayRef) : undefined;
        const date = day?.date ?? doc.trip.startDate;
        add(key, title, body, date, due.time ?? '08:00', day?.tz ?? doc.trip.primaryTz);
        break;
      }
    }
  }
  add('trip:eve', `Jutro wyjazd: ${doc.trip.title}`, 'Otwórz plan raz z internetem — zapisze się na telefonie do użytku offline.', addDays(doc.trip.startDate, -1), '19:00', home);
  return out.sort((a, b) => a.at - b.at);
}
