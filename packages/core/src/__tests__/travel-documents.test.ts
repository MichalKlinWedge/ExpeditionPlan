import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { addMonths, documentWarnings, FORMALITIES, formalityTasks } from '../travel-documents.ts';
import { tripReadiness } from '../trip-readiness.ts';

const fixture = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('formalności: ważność dokumentów', () => {
  const base = fixture('barcelona');
  const [first, second] = base.travelers as [TripDocument['travelers'][number], TripDocument['travelers'][number]];
  const end = base.trip.endDate;

  it('6 miesięcy po powrocie z końcem miesiąca', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-12-07', 6)).toBe('2028-06-07');
  });

  it('paszport bez zapasu, dowód tracący ważność przed powrotem, nieważny dziś; dobre i puste bez ostrzeżeń', () => {
    const doc = TripDocument.parse({
      ...base,
      travelers: base.travelers.map((person) =>
        person.ref === first.ref
          ? { ...person, passportUntil: addMonths(end, 3), idCardUntil: addMonths(end, 1) }
          : person.ref === second.ref
            ? { ...person, passportUntil: addMonths(end, 7), idCardUntil: '2026-10-01', toDate: undefined }
            : person,
      ),
    });
    const warnings = documentWarnings(doc, '2026-11-08');
    expect(warnings.map((each) => [each.name, each.document, each.problem])).toEqual([
      [first.name, 'passport', 'short_margin'],
      [second.name, 'id_card', 'expired'],
    ]);
    expect(warnings[0]!.text).toMatch(/^paszport ważny do \d+\.\d\d\.\d{4} — krócej niż 6 miesięcy po powrocie$/);

    const early = TripDocument.parse({ ...doc, travelers: doc.travelers.map((person) => (person.ref === first.ref ? { ...person, idCardUntil: base.trip.startDate } : person)) });
    expect(documentWarnings(early, '2026-11-08').find((each) => each.document === 'id_card' && each.travelerRef === first.ref)?.problem).toBe('before_return');

    const readiness = tripReadiness(doc, '2026-11-08').filter((issue) => issue.group === 'documents');
    expect(readiness).toEqual([
      { group: 'documents', ref: first.ref, title: `${first.name}: ${warnings[0]!.text}` },
      { group: 'documents', ref: second.ref, title: `${second.name}: ${warnings[1]!.text}`, overdue: true },
    ]);
  });

  it('zadania formalności z linkiem gov.pl i terminem przed wyjazdem; drugi raz bez duplikatów', () => {
    let next = 0;
    const tasks = formalityTasks(base, ['ekuz', 'odyseusz', 'insurance'], () => `t-${++next}`);
    expect(tasks.map((task) => task.title)).toEqual(FORMALITIES.filter((each) => each.key !== 'driving_permit').map((each) => each.title));
    expect(tasks[0]).toMatchObject({ kind: 'todo', status: 'open', due: { kind: 'before_trip', days: 21 } });
    expect(tasks[0]!.body).toContain('https://www.gov.pl/web/gov/uzyskaj-europejska-karte-ubezpieczenia-zdrowotnego-ekuz');
    const withTasks = TripDocument.parse({ ...base, tasks: [...base.tasks, ...tasks] });
    expect(formalityTasks(withTasks, ['ekuz', 'driving_permit'], () => 'x').map((task) => task.title)).toEqual(['Międzynarodowe prawo jazdy']);
  });
});
