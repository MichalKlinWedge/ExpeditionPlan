import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bookingRemovalNote, removeBooking } from '../booking-remove.ts';
import { scheduleDay } from '../engine/schedule.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('usunięcie rezerwacji', () => {
  it('każda rezerwacja z pięciu planów: dokument spójny, żadne odwołanie nie zostaje, rezerwacja zapisana na końcu', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      for (const booking of doc.bookings) {
        const edit = removeBooking(doc, booking.ref!)!;
        const parsed = TripDocument.safeParse(edit.doc);
        expect(parsed.success, `${slug}/${booking.ref}`).toBe(true);
        expect(JSON.stringify(edit.doc), `${slug}/${booking.ref}`).not.toContain(`"${booking.ref}"`);
        expect(edit.writes.at(-1)).toMatchObject({ collection: 'bookings', op: 'remove' });
        expect(edit.doc.items).toHaveLength(doc.items.length);
      }
    }
  });

  it('powiązania: punkt traci pakiet, zadanie termin, dzień nocleg; reszta zostaje, notatka odchodzi', () => {
    const base = fixture('dinara');
    const ref = base.bookings[0]!.ref!;
    const day = base.days[0]!;
    const item = base.items[0]!;
    const doc = TripDocument.parse({
      ...base,
      days: base.days.map((each) => (each.ref === day.ref ? { ...each, lodgingRef: ref } : each)),
      items: base.items.map((each) => (each.ref === item.ref ? { ...each, bookingRef: ref, payment: 'included' } : each)),
      tasks: [...base.tasks, { ref: 'zadanie-x', kind: 'todo', title: 'Zapłać', status: 'open', bookingRef: ref, due: { kind: 'before_booking', bookingRef: ref } }],
      contacts: [...base.contacts, { ref: 'kontakt-x', name: 'Gospodarz', role: 'host', bookingRef: ref }],
      notes: [...base.notes, { ref: 'notatka-x', scope: 'booking', targetRef: ref, kind: 'info', body: 'Kod do drzwi' }],
    });
    const edit = removeBooking(doc, ref)!;
    expect(edit.doc.days.find((each) => each.ref === day.ref)?.lodgingRef).toBeUndefined();
    const after = edit.doc.items.find((each) => each.ref === item.ref)!;
    expect(after.bookingRef).toBeUndefined();
    expect(after.payment).toBeUndefined();
    const task = edit.doc.tasks.find((each) => each.ref === 'zadanie-x')!;
    expect(task.bookingRef).toBeUndefined();
    expect(task.due).toBeUndefined();
    expect(edit.doc.contacts.find((each) => each.ref === 'kontakt-x')?.name).toBe('Gospodarz');
    expect(edit.doc.notes.some((each) => each.ref === 'notatka-x')).toBe(false);
    expect(edit.summary).toMatchObject({ notesRemoved: 1 });
    expect(edit.writes.find((each) => each.element.ref === 'notatka-x')?.op).toBe('remove');
    expect(edit.writes.find((each) => each.element.ref === 'kontakt-x')?.op).toBe('update');
    expect(bookingRemovalNote(edit.summary)).toContain('Odejdą razem z nią — notatki: 1.');
    expect(removeBooking(doc, 'nie-ma')).toBeNull();
  });

  it('ograniczenie tylko z rezerwacją odchodzi, zamiast objąć cały wyjazd; z dniem traci samo powiązanie', () => {
    const base = fixture('dinara');
    const ref = base.bookings[0]!.ref!;
    const dayRef = base.days[0]!.ref!;
    const doc = TripDocument.parse({
      ...base,
      constraints: [
        ...base.constraints,
        { ref: 'tylko-rezerwacja', kind: 'arrive_before', bookingRef: ref, time: '01:00', reason: 'Odbiór kluczy' },
        { ref: 'z-dniem', kind: 'arrive_before', bookingRef: ref, dayRef, time: '23:30', reason: 'Odbiór kluczy' },
      ],
    });
    const edit = removeBooking(doc, ref)!;
    expect(edit.doc.constraints.some((each) => each.ref === 'tylko-rezerwacja')).toBe(false);
    const kept = edit.doc.constraints.find((each) => each.ref === 'z-dniem')!;
    expect(kept.bookingRef).toBeUndefined();
    expect(kept.dayRef).toBe(dayRef);
    expect(edit.summary).toMatchObject({ constraintsRemoved: 1, constraints: 1 });
    expect(() => scheduleDay(TripDocument.parse(edit.doc), dayRef)).not.toThrow();
  });
});
