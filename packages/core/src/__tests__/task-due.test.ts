import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { taskDates, taskDueDate, taskOverdue, taskUrgency } from '../task-due.ts';
import { tripReadiness } from '../trip-readiness.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));

describe('zadanie po terminie', () => {
  const doc = TripDocument.parse({
    ...maroko,
    tasks: [
      ...maroko.tasks,
      { ref: 't-dni', kind: 'todo', title: 'Ubezpieczenie', status: 'open', due: { kind: 'before_trip', days: 7 } },
      { ref: 't-deadline', kind: 'todo', title: 'Odprawa', status: 'open', due: { kind: 'before_trip', days: 1 }, deadline: '2026-12-01' },
      { ref: 't-zrobione', kind: 'todo', title: 'Zrobione', status: 'done', deadline: '2020-01-01' },
      { ref: 't-trakcie', kind: 'todo', title: 'W trakcie', status: 'open', due: { kind: 'on_trip' } },
    ],
  });
  const task = (ref: string) => doc.tasks.find((each) => each.ref === ref)!;

  it('termin względny jako data, „w trakcie” bez dnia = koniec wyjazdu', () => {
    expect(taskDueDate(doc, task('t-dni'))).toBe('2026-12-19');
    expect(taskDueDate(doc, task('t-trakcie'))).toBe(doc.trip.endDate);
  });

  it('po terminie albo po „najpóźniej”, tylko otwarte', () => {
    expect(taskOverdue(doc, task('t-dni'), '2026-12-19')).toBe(false);
    expect(taskOverdue(doc, task('t-dni'), '2026-12-20')).toBe(true);
    // Termin (dzień przed wyjazdem) jeszcze nie minął, ale „najpóźniej” tak.
    expect(taskOverdue(doc, task('t-deadline'), '2026-12-02')).toBe(true);
    expect(taskOverdue(doc, task('t-deadline'), '2026-12-01')).toBe(false);
    expect(taskOverdue(doc, task('t-zrobione'), '2026-12-02')).toBe(false);
  });

  it('pilność do licznika w belce: po terminie, w ciągu 30 dni, później', () => {
    expect(taskUrgency(taskDates(doc, task('t-deadline')), '2026-12-02')).toBe('overdue');
    expect(taskUrgency(['2026-12-31'], '2026-12-02')).toBe('soon');
    expect(taskUrgency(['2027-01-01'], '2026-12-02', 30)).toBe('soon');
    expect(taskUrgency(['2027-01-02'], '2026-12-02', 30)).toBeNull();
    expect(taskDates(doc, task('t-zrobione'))).toEqual([]);
    expect(taskUrgency([], '2026-12-02')).toBeNull();
  });

  it('„Gotowość” liczy zaległość z „najpóźniej” i pokazuje wcześniejszą datę', () => {
    const issue = tripReadiness(doc, '2026-12-02').find((each) => each.ref === 't-deadline')!;
    expect(issue).toMatchObject({ date: '2026-12-01', overdue: true });
  });
});
