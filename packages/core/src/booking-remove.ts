import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Usunięcie rezerwacji z planu: odwołania do niej znikają, a punkty, zadania, kontakty i pozycje
 * budżetu zostają. Razem z rezerwacją odchodzą tylko notatki o niej i ograniczenia bez innego
 * zaczepienia — bez rezerwacji silnik czytałby je jako dotyczące całego wyjazdu (`scheduleDay`).
 * Nowe pole wskazujące rezerwację trzeba obsłużyć tutaj; test na fixture'ach pilnuje, że żadne
 * odwołanie nie zostaje.
 */

type Doc = TripDocument;
type Element = { ref?: string | undefined };

export type BookingRemovalWrite = {
  collection: 'items' | 'days' | 'legs' | 'constraints' | 'contacts' | 'budgetLines' | 'tasks' | 'notes' | 'sources' | 'bookings';
  element: { ref: string } & Record<string, unknown>;
  op: 'update' | 'remove';
};

export type BookingRemovalSummary = { items: number; days: number; legs: number; tasks: number; contacts: number; budgetLines: number; constraints: number; notesRemoved: number; constraintsRemoved: number };

export type BookingRemoval = { doc: Doc; writes: BookingRemovalWrite[]; summary: BookingRemovalSummary };

export function removeBooking(doc: Doc, bookingRef: string): BookingRemoval | null {
  if (!doc.bookings.some((booking) => booking.ref === bookingRef)) return null;
  const writes: BookingRemovalWrite[] = [];

  /** `null` usuwa element, ten sam obiekt zostawia go bez zapisu. */
  const sweep = <T extends Element>(collection: BookingRemovalWrite['collection'], list: readonly T[], edit: (element: T) => T | null) => {
    let changed = 0;
    let removed = 0;
    const next: T[] = [];
    for (const element of list) {
      const result = edit(element);
      if (result === element) {
        next.push(element);
        continue;
      }
      if (result === null) removed++;
      else {
        changed++;
        next.push(result);
      }
      if (element.ref !== undefined) writes.push({ collection, element: (result ?? element) as { ref: string } & Record<string, unknown>, op: result === null ? 'remove' : 'update' });
    }
    return { next, changed, removed };
  };

  const items = sweep('items', doc.items, (item) => {
    const booked = item.bookingRef === bookingRef;
    const ticket = item.leg?.ticketBookingRef === bookingRef;
    if (!booked && !ticket) return item;
    const { bookingRef: _booking, payment, leg, ...rest } = item;
    const { ticketBookingRef: _ticket, ...restLeg } = leg ?? {};
    const keptPayment = booked ? (payment === 'included' ? undefined : payment) : payment;
    return {
      ...rest,
      ...(booked ? {} : _booking !== undefined ? { bookingRef: _booking } : {}),
      ...(keptPayment !== undefined ? { payment: keptPayment } : {}),
      ...(leg === undefined ? {} : { leg: ticket ? restLeg : leg }),
    } as typeof item;
  });
  const days = sweep('days', doc.days, (day) => {
    if (day.lodgingRef !== bookingRef) return day;
    const { lodgingRef: _lodging, ...rest } = day;
    return rest;
  });
  const legs = sweep('legs', doc.legs, (leg) => {
    if (leg.ticketBookingRef !== bookingRef) return leg;
    const { ticketBookingRef: _ticket, ...rest } = leg;
    return rest;
  });
  const constraints = sweep('constraints', doc.constraints, (constraint) => {
    if (constraint.bookingRef !== bookingRef) return constraint;
    if (constraint.dayRef === undefined && constraint.itemRef === undefined) return null;
    const { bookingRef: _booking, ...rest } = constraint;
    return rest;
  });
  const contacts = sweep('contacts', doc.contacts, (contact) => {
    if (contact.bookingRef !== bookingRef) return contact;
    const { bookingRef: _booking, ...rest } = contact;
    return rest;
  });
  const budgetLines = sweep('budgetLines', doc.budgetLines, (line) => {
    if (line.bookingRef !== bookingRef) return line;
    const { bookingRef: _booking, ...rest } = line;
    return rest;
  });
  const tasks = sweep('tasks', doc.tasks, (task) => {
    const linked = task.bookingRef === bookingRef;
    const dated = task.due?.kind === 'before_booking' && task.due.bookingRef === bookingRef;
    if (!linked && !dated) return task;
    const { bookingRef: _booking, due, ...rest } = task;
    return { ...rest, ...(!linked && _booking !== undefined ? { bookingRef: _booking } : {}), ...(!dated && due !== undefined ? { due } : {}) } as typeof task;
  });
  const notes = sweep('notes', doc.notes, (note) => (note.scope === 'booking' && note.targetRef === bookingRef ? null : note));
  const sources = sweep('sources', doc.sources, (source) => (source.appliesToRefs.includes(bookingRef) ? { ...source, appliesToRefs: source.appliesToRefs.filter((ref) => ref !== bookingRef) } : source));

  const booking = doc.bookings.find((each) => each.ref === bookingRef)!;
  // Rezerwacja na końcu: gdy zapis się przerwie, żadne odwołanie nie wskazuje usuniętego wiersza.
  writes.push({ collection: 'bookings', element: booking as { ref: string } & Record<string, unknown>, op: 'remove' });

  return {
    doc: {
      ...doc,
      items: items.next,
      days: days.next,
      legs: legs.next,
      constraints: constraints.next,
      contacts: contacts.next,
      budgetLines: budgetLines.next,
      tasks: tasks.next,
      notes: notes.next,
      sources: sources.next,
      bookings: doc.bookings.filter((each) => each.ref !== bookingRef),
    },
    writes,
    summary: {
      items: items.changed,
      days: days.changed,
      legs: legs.changed,
      tasks: tasks.changed,
      contacts: contacts.changed,
      budgetLines: budgetLines.changed,
      constraints: constraints.changed,
      notesRemoved: notes.removed,
      constraintsRemoved: constraints.removed,
    },
  };
}

/** Do potwierdzenia: co straci powiązanie, a co odejdzie razem z rezerwacją. */
export function bookingRemovalNote(summary: BookingRemovalSummary): string {
  const list = (parts: [string, number][]) =>
    parts
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label}: ${count}`)
      .join(', ');
  const kept = list([
    ['punkty planu', summary.items + summary.legs],
    ['noclegi dni', summary.days],
    ['zadania', summary.tasks],
    ['kontakty', summary.contacts],
    ['pozycje budżetu', summary.budgetLines],
    ['ograniczenia', summary.constraints],
  ]);
  const gone = list([
    ['notatki', summary.notesRemoved],
    ['ograniczenia', summary.constraintsRemoved],
  ]);
  return [kept && `Zostają, ale bez powiązania z rezerwacją — ${kept}.`, gone && `Odejdą razem z nią — ${gone}.`].filter(Boolean).join(' ');
}
