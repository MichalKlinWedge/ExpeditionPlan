import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { READINESS_ORDER, tripReadiness } from '../trip-readiness.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));
const maroko = fixture('maroko');

describe('gotowość przed wyjazdem', () => {
  it('rezerwacje: do zrobienia, do zapłaty (przedpłata), bez dokumentu w sejfie; kandydaci tylko po wyborze', () => {
    const doc = TripDocument.parse({
      ...maroko,
      bookings: [
        ...maroko.bookings,
        { ref: 'rx-auto', kind: 'car_rental', status: 'to_book', title: 'Auto' },
        { ref: 'rx-hotel', kind: 'lodging', status: 'booked', title: 'Hotel', payWhen: 'prepaid', start: { date: '2026-12-20', tz: 'Africa/Casablanca' } },
        { ref: 'rx-bilet', kind: 'flight', status: 'paid', title: 'Lot' },
        { ref: 'rx-riad', kind: 'lodging', status: 'booked', title: 'Riad', payWhen: 'on_site' },
      ],
    });
    const mine = new Set(['rx-auto', 'rx-hotel', 'rx-bilet', 'rx-riad']);
    const issues = tripReadiness(doc, '2026-12-21', new Set(['rx-bilet']));
    expect(issues.filter((each) => mine.has(each.ref)).map((each) => [each.group, each.ref, each.overdue ?? false])).toEqual([
      ['book', 'rx-auto', false],
      ['pay', 'rx-hotel', true],
      ['vault', 'rx-hotel', false],
      ['vault', 'rx-riad', false],
    ]);
    // Bez listy z sejfu (brak dostępu) — grupy „vault” nie ma.
    expect(tripReadiness(doc, '2026-12-21').some((each) => each.group === 'vault')).toBe(false);
  });

  it('zadania: otwarte z terminem przed końcem wyjazdu, „w trakcie” pominięte, przeterminowane oznaczone', () => {
    const doc = TripDocument.parse({
      ...maroko,
      tasks: [
        ...maroko.tasks,
        { ref: 't-pasz', kind: 'todo', title: 'Paszporty', status: 'open', due: { kind: 'before_trip', days: 14 } },
        { ref: 't-trasa', kind: 'todo', title: 'W trasie', status: 'open', due: { kind: 'on_trip' } },
        { ref: 't-done', kind: 'todo', title: 'Zrobione', status: 'done' },
        { ref: 't-bez', kind: 'question', title: 'Bez terminu', status: 'open' },
      ],
    });
    const tasks = tripReadiness(doc, '2026-12-20').filter((each) => each.group === 'task' && each.ref.startsWith('t-') && !maroko.tasks.some((task) => task.ref === each.ref));
    expect(tasks.map((each) => [each.ref, each.date, each.overdue ?? false])).toEqual([
      ['t-pasz', '2026-12-12', true],
      ['t-bez', undefined, false],
    ]);
  });

  it('pięć planów: grupy po kolei, a nierozstrzygnięte porównania noclegów są „do decyzji”, nie „do zarezerwowania”', () => {
    for (const slug of ['barcelona', 'chatka', 'dinara', 'gruzja', 'maroko']) {
      const doc = fixture(slug);
      const issues = tripReadiness(doc, doc.trip.startDate);
      const ranks = issues.map((each) => READINESS_ORDER.indexOf(each.group));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      for (const issue of issues.filter((each) => each.group === 'book')) {
        const booking = doc.bookings.find((each) => each.ref === issue.ref)!;
        if (booking.variantGroupRef === undefined) continue;
        expect(doc.variantGroups.find((group) => group.ref === booking.variantGroupRef)?.chosenRef).toBe(booking.variantRef);
      }
    }
    expect(tripReadiness(fixture('gruzja'), '2026-08-01').filter((each) => each.group === 'decide').map((each) => each.title)).toContain('Noclegi w Mestii · 5–10.08 · 2 propozycje');
  });
});
