import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { addDays } from '../engine/time.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { daysBetween, isRealDate, shiftBriefDates, shiftTripDates, suggestNewStart } from '../trip-reschedule.ts';

const fixture = (plan: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${plan}/plan.json`, import.meta.url)), 'utf8')));

const plans = ['maroko', 'gruzja', 'barcelona', 'chatka', 'dinara'];
const OFFSETS = [1, 7, 30, 100, 183, 365, -14];
/** Ta sama pora roku i ten sam stan czasu letniego: plan ma działać bez żadnej poprawki. */
const SAME_SEASON = [-14, 364, 365];

function gate(doc: TripDocument) {
  const problems: { itemRef?: string; message: string }[] = [];
  for (const day of doc.days) {
    for (const scenario of ['optimistic', 'pessimistic'] as const) {
      const schedule = scheduleDay(doc, day.ref, { scenario });
      for (const item of schedule.items) if (item.driftMin > 15) problems.push({ itemRef: item.ref, message: `${day.ref}/${scenario}: ${item.title} +${item.driftMin} min` });
      for (const warning of schedule.warnings) if (warning.severity === 'hard') problems.push({ message: warning.message });
    }
  }
  return problems;
}

describe('zmiana terminu: pięć planów referencyjnych', () => {
  describe.each(plans)('%s', (plan) => {
    const document = fixture(plan);

    it.each(OFFSETS)('o %i dni: dokument przechodzi walidację, a długość się nie zmienia', (offset) => {
      const shift = shiftTripDates(document, addDays(document.trip.startDate, offset));
      const parsed = TripDocument.safeParse(shift.doc);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(shift.offsetDays).toBe(offset);
      expect(daysBetween(shift.startDate, shift.endDate)).toBe(daysBetween(document.trip.startDate, document.trip.endDate));
      expect(shift.doc.days.map((day) => day.date)).toEqual(document.days.map((day) => addDays(day.date, offset)));
    });

    it.each(SAME_SEASON)('o %i dni (ta sama pora roku): bramka PoC-5 dalej zielona', (offset) => {
      const shift = shiftTripDates(document, addDays(document.trip.startDate, offset));
      expect(gate(shift.doc).map((problem) => problem.message)).toEqual([]);
      expect(shift.review.schedule).toEqual([]);
    });

    // Inna pora roku to realnie inny dzień: wcześniejszy zachód, inna różnica czasu między strefami.
    // Silnik ma to zgłosić, a zmiana terminu pokazać w podglądzie — nic nie może przejść po cichu.
    it.each(OFFSETS)('o %i dni: każdy problem bramki jest w podglądzie „do sprawdzenia”', (offset) => {
      const shift = shiftTripDates(document, addDays(document.trip.startDate, offset));
      const shown = shift.review.schedule.map((entry) => entry.message);
      for (const problem of gate(shift.doc)) {
        if (problem.itemRef === undefined) expect(shown).toContain(problem.message);
        else expect(shown.some((message) => message.includes(document.items.find((item) => item.ref === problem.itemRef)!.title))).toBe(true);
      }
    });

    it('tam i z powrotem daje ten sam dokument', () => {
      const there = shiftTripDates(document, addDays(document.trip.startDate, 100));
      const back = shiftTripDates(there.doc, document.trip.startDate);
      expect(back.doc).toEqual(document);
    });

    it('daty uczestnika idą za wyjazdem', () => {
      const first = document.travelers[0]!;
      const withDates = { ...document, travelers: document.travelers.map((each) => (each.ref === first.ref ? { ...each, fromDate: addDays(document.trip.startDate, 1) } : each)) };
      const shift = shiftTripDates(withDates, addDays(document.trip.startDate, 30));
      expect(shift.moved.travelers).toEqual([first.ref]);
      const moved = shift.doc.travelers.find((each) => each.ref === first.ref)!;
      expect(moved.fromDate).toBe(addDays(document.trip.startDate, 31));
      expect(moved.toDate).toBeUndefined();
    });

    it('bez zmiany daty nic się nie przesuwa', () => {
      const shift = shiftTripDates(document, document.trip.startDate);
      expect(shift.doc).toBe(document);
      expect(Object.values(shift.moved).flat()).toEqual([]);
    });
  });

  it('maroko: opłacone zostają przy starych datach i są do sprawdzenia, kandydaci idą z planem', () => {
    const document = fixture('maroko');
    const shift = shiftTripDates(document, addDays(document.trip.startDate, 30));
    const paid = document.bookings.filter((booking) => booking.status === 'paid' && booking.start !== undefined);
    expect(paid.length).toBeGreaterThan(0);
    expect(shift.review.keptBookings.map((booking) => booking.ref)).toEqual(paid.map((booking) => booking.ref));
    for (const booking of paid) expect(shift.doc.bookings.find((each) => each.ref === booking.ref)).toEqual(booking);
    const candidate = document.bookings.find((booking) => booking.status === 'candidate' && booking.start !== undefined)!;
    expect(shift.doc.bookings.find((each) => each.ref === candidate.ref)!.start!.date).toBe(addDays(candidate.start!.date, 30));
    expect(shift.doc.sources).toEqual(document.sources);
  });

  it('gruzja: bezpłatne anulowanie idzie z ofertą, data sprawdzenia ceny zostaje, „unknown” do sprawdzenia', () => {
    const document = fixture('gruzja');
    const shift = shiftTripDates(document, addDays(document.trip.startDate, 10));
    const offer = document.bookings.find((booking) => booking.freeCancellationUntil !== undefined && booking.status === 'candidate')!;
    const after = shift.doc.bookings.find((each) => each.ref === offer.ref)!;
    expect(after.freeCancellationUntil).toBe(addDays(offer.freeCancellationUntil!, 10));
    expect(after.price?.checkedAt).toBe(offer.price?.checkedAt);
    expect(shift.review.uncertainBookings.length).toBeGreaterThan(0);
    expect(shift.review.repriceBookings.map((booking) => booking.ref)).toContain(offer.ref);
  });

  it('barcelona: tytuł z datą jest do poprawy także przy przesunięciu o pełne tygodnie', () => {
    const document = fixture('barcelona');
    const byWeek = shiftTripDates(document, addDays(document.trip.startDate, 7));
    expect(byWeek.review.weekdaysChange).toBe(false);
    expect(byWeek.review.dayTitles.map((day) => day.title)).toContain('Sobota 5.12: Bunkry, Sagrada, Montjuïc');
  });

  it('chatka: sam dzień tygodnia w tytule przeszkadza tylko, gdy się zmienia; termin zadania idzie z planem', () => {
    const document = fixture('chatka');
    expect(shiftTripDates(document, addDays(document.trip.startDate, 7)).review.dayTitles).toEqual([]);
    const shift = shiftTripDates(document, addDays(document.trip.startDate, 8));
    expect(shift.review.dayTitles).toHaveLength(2);
    expect(shift.review.weekdaysChange).toBe(true);
    const task = document.tasks.find((each) => each.due?.kind === 'absolute')!;
    expect(shift.moved.tasks).toContain(task.ref);
    expect(shift.doc.tasks.find((each) => each.ref === task.ref)!.due).toMatchObject({ date: addDays('2026-10-23', 8) });
  });

  it('chatka: dzień po zmianie czasu spacer kończy się po zachodzie — to widać w podglądzie', () => {
    const document = fixture('chatka');
    const shift = shiftTripDates(document, addDays(document.trip.startDate, 7));
    expect(shift.review.schedule.map((entry) => entry.message).join()).toContain('po zachodzie');
  });

  it('nie zmienia wejścia', () => {
    const document = fixture('maroko');
    const before = JSON.stringify(document);
    shiftTripDates(document, addDays(document.trip.startDate, 40));
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe('zmiana terminu: reguły', () => {
  const base = TripDocument.parse({
    schemaVersion: 1,
    trip: { title: 'Test', startDate: '2027-05-01', endDate: '2027-05-03', primaryTz: 'Europe/Warsaw', baseCurrency: 'PLN', fx: [{ currency: 'EUR', rateToBase: 4.3, date: '2026-11-01' }] },
    days: [{ ref: 'd1', date: '2027-05-01', tz: 'Europe/Warsaw' }],
    variantGroups: [
      { ref: 'g-data', scope: 'trip', title: 'Data', conditionKind: 'choice', decideBy: { local: '2027-04-20T18:30', tz: 'Europe/Warsaw' } },
      { ref: 'g-godzina', scope: 'day', dayRef: 'd1', title: 'Godzina', conditionKind: 'weather', decideBy: { time: '08:00' } },
    ],
    bookings: [
      { ref: 'kod', kind: 'flight', status: 'to_book', title: 'Z kodem', confirmationCode: 'ABC', start: { date: '2027-05-01', tz: 'Europe/Warsaw' } },
      { ref: 'zaplacone', kind: 'ticket', status: 'candidate', title: 'Zapłacone', paid: { amountMinor: 100, currency: 'PLN', date: '2026-11-01' }, start: { date: '2027-05-01', tz: 'Europe/Warsaw' } },
      { ref: 'odwolane', kind: 'ticket', status: 'cancelled', title: 'Odwołane', start: { date: '2027-05-01', tz: 'Europe/Warsaw' } },
      { ref: 'bez-daty', kind: 'insurance', status: 'booked', title: 'Polisa' },
      { ref: 'do-kupienia', kind: 'ticket', status: 'to_book', title: 'Bilet', start: { date: '2027-05-02', tz: 'Europe/Warsaw' } },
    ],
    tasks: [
      { ref: 't-otwarte', kind: 'todo', title: 'Otwarte', due: { kind: 'absolute', date: '2027-04-01', time: '10:00' } },
      { ref: 't-zrobione', kind: 'todo', title: 'Zrobione', status: 'done', due: { kind: 'absolute', date: '2027-04-01' } },
      { ref: 't-doplata', kind: 'todo', title: 'Dopłata', bookingRef: 'kod', due: { kind: 'absolute', date: '2027-04-10' } },
      { ref: 't-odwolane', kind: 'todo', title: 'Przy odwołanej', bookingRef: 'odwolane', due: { kind: 'absolute', date: '2027-04-11' } },
      { ref: 't-wzgledne', kind: 'todo', title: 'Względne', due: { kind: 'before_trip', days: 2 } },
    ],
  });
  const shift = shiftTripDates(base, '2027-06-01');

  it('kod potwierdzenia albo zapłata trzymają datę, także przy nieaktualnym statusie', () => {
    expect(shift.review.keptBookings.map((booking) => booking.ref)).toEqual(['kod', 'zaplacone']);
    expect(shift.doc.bookings.find((each) => each.ref === 'zaplacone')!.paid!.date).toBe('2026-11-01');
    expect(shift.moved.bookings).toEqual(['do-kupienia']);
  });

  it('odwołana nie przesuwa się i nie wymaga sprawdzenia, rezerwacja bez daty też nie', () => {
    expect(shift.doc.bookings.find((each) => each.ref === 'odwolane')!.start!.date).toBe('2027-05-01');
    expect(shift.review.keptBookings.map((booking) => booking.ref)).not.toContain('odwolane');
    expect(shift.review.keptBookings.map((booking) => booking.ref)).not.toContain('bez-daty');
  });

  it('zadania: otwarte z datą idą za planem, zamknięte i względne zostają, przy kupionej — do sprawdzenia', () => {
    expect(shift.moved.tasks).toEqual(['t-otwarte', 't-odwolane']);
    expect(shift.doc.tasks[0]!.due).toEqual({ kind: 'absolute', date: '2027-05-02', time: '10:00' });
    expect(shift.doc.tasks[1]!.due).toEqual(base.tasks[1]!.due);
    expect(shift.doc.tasks[4]!.due).toEqual(base.tasks[4]!.due);
    expect(shift.review.keptTasks).toEqual([{ ref: 't-doplata', title: 'Dopłata', date: '2027-04-10' }]);
  });

  it('termin decyzji: data przesuwa się z zachowaniem godziny, sama godzina zostaje', () => {
    expect(shift.moved.variantGroups).toEqual(['g-data']);
    expect(shift.doc.variantGroups[0]!.decideBy).toEqual({ local: '2027-05-21T18:30', tz: 'Europe/Warsaw' });
    expect(shift.doc.variantGroups[1]!.decideBy).toEqual({ time: '08:00' });
  });

  it('kurs waluty to fakt', () => {
    expect(shift.doc.trip.fx).toEqual(base.trip.fx);
  });

  it('odrzuca datę spoza kalendarza', () => {
    expect(isRealDate('2027-02-31')).toBe(false);
    expect(isRealDate('2027-02-28')).toBe(true);
    expect(() => shiftTripDates(base, '2027-02-31')).toThrow();
  });
});

describe('brief i propozycja daty', () => {
  it('brief: przesuwa tylko daty „fixed”, reszta bez zmian', () => {
    const brief = { goal: 'x', dates: { kind: 'fixed', start: '2027-05-01', end: '2027-05-03' }, fixed: [{ startLocal: '2027-05-01T10:00' }] };
    expect(shiftBriefDates(brief, 2)).toEqual({ ...brief, dates: { kind: 'fixed', start: '2027-05-03', end: '2027-05-05' } });
    expect(shiftBriefDates({ dates: { kind: 'flexible', days: 3, window: 'maj' } }, 2)).toBeNull();
    expect(shiftBriefDates({ goal: 'bez dat' }, 2)).toBeNull();
    expect(shiftBriefDates(brief, 0)).toBeNull();
  });

  it('propozycja: najbliższy termin co 52 tygodnie, ten sam dzień tygodnia', () => {
    expect(suggestNewStart('2026-10-24', '2026-11-04')).toBe('2027-10-23');
    expect(new Date('2027-10-23').getUTCDay()).toBe(new Date('2026-10-24').getUTCDay());
    expect(suggestNewStart('2025-12-20', '2026-11-04')).toBe('2026-12-19');
    expect(suggestNewStart('2026-11-04', '2026-11-04')).toBe('2026-11-04');
    expect(suggestNewStart('2024-02-29', '2026-11-04')).toBe('2027-02-25');
  });
});
