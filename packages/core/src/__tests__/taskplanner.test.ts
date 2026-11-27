import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TripDocument } from '../schemas/trip-document.ts';
import { PlannerTaskInput, plannerKey, plannerTask, suggestedForPlanner } from '../taskplanner.ts';

const plansDir = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));
const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(`${plansDir}${slug}/plan.json`, 'utf8')));
const maroko = load('maroko');

const TRIP = '0193a0c4-7d2e-7f00-9c1a-2b3c4d5e6f70';
const ctx = (ref: string) => ({ tripId: TRIP, tripUrl: `https://ep.example/trips/${TRIP}/tasks`, taskUrl: `https://ep.example/trips/${TRIP}/tasks#${ref}` });

describe('zadanie EP → Task Planner', () => {
  const doc = TripDocument.parse({
    ...maroko,
    trip: { ...maroko.trip, title: 'Szkic AI: Maroko' },
    tasks: [
      ...maroko.tasks.map((each) => ({ ...each, status: 'done' as const })),
      { ref: 't-dni', kind: 'todo', title: 'Ubezpieczenie', status: 'open', due: { kind: 'before_trip', days: 7 }, priority: 'high' },
      { ref: 't-deadline', kind: 'question', title: 'Odprawa', status: 'open', due: { kind: 'absolute', date: '2026-12-10', time: '09:00' }, deadline: '2026-12-12' },
      { ref: 't-godzina', kind: 'decision', title: 'Taksówka', status: 'dropped', due: { kind: 'absolute', date: '2026-12-10', time: '09:00' }, body: 'Zamówić', answer: 'Tak' },
      { ref: 't-bez', kind: 'todo', title: 'Coś', status: 'done' },
    ],
  });
  const task = (ref: string) => doc.tasks.find((each) => each.ref === ref)!;

  it('klucz zewnętrzny', () => {
    expect(plannerKey(TRIP, 't-dni')).toBe(`ep:${TRIP}:t-dni`);
  });

  it('termin względny jako data, priorytet, tagi bez prefiksu szkicu', () => {
    const out = plannerTask(doc, task('t-dni'), ctx('t-dni'));
    expect(out).toMatchObject({ title: 'Ubezpieczenie', status: 'todo', priority: 2, startDate: null, dueDate: '2026-12-19', dueTime: null, timeZone: null });
    expect(out.tags).toEqual(['wyjazd', 'Maroko']);
    expect(out.source).toEqual({ kind: 'expeditionplan', tripId: TRIP, ref: 't-dni', url: ctx('t-dni').tripUrl });
    expect(out.description).toContain(`(${ctx('t-dni').taskUrl})`);
  });

  it('„najpóźniej” jest terminem, wcześniejszy termin datą startu, godzina odpada', () => {
    const out = plannerTask(doc, task('t-deadline'), ctx('t-deadline'));
    expect(out).toMatchObject({ startDate: '2026-12-10', dueDate: '2026-12-12', dueTime: null, timeZone: null });
    expect(out.tags).toContain('pytanie');
    expect(out).not.toHaveProperty('priority');
  });

  it('godzina ze strefą, anulowane, opis z odpowiedzią', () => {
    const out = plannerTask(doc, task('t-godzina'), ctx('t-godzina'));
    expect(out).toMatchObject({ status: 'cancelled', dueDate: '2026-12-10', dueTime: '09:00', timeZone: doc.trip.homeTz });
    expect(out.description).toMatch(/^Zamówić\n\n\*\*Odpowiedź:\*\* Tak/);
    expect(out.tags).toContain('decyzja');
  });

  it('bez terminu: daty czyszczone (null)', () => {
    expect(plannerTask(doc, task('t-bez'), ctx('t-bez'))).toMatchObject({ status: 'done', startDate: null, dueDate: null, dueTime: null });
  });

  it('domyślnie otwarte bez osoby albo moje', () => {
    const [me, you] = doc.travelers.map((each) => each.ref);
    const withPeople = TripDocument.parse({
      ...doc,
      tasks: [...doc.tasks, { ref: 't-moje', kind: 'todo', title: 'Moje', assigneeRefs: [me] }, { ref: 't-cudze', kind: 'todo', title: 'Cudze', assigneeRefs: [you] }],
    });
    expect(suggestedForPlanner(withPeople, new Set([me!]))).toEqual(['t-dni', 't-deadline', 't-moje']);
  });

  it('każde zadanie z 5 planów daje poprawny ładunek', () => {
    for (const slug of readdirSync(plansDir, { withFileTypes: true }).filter((each) => each.isDirectory()).map((each) => each.name)) {
      const plan = load(slug);
      for (const each of plan.tasks) {
        const parsed = PlannerTaskInput.safeParse(plannerTask(plan, each, ctx(each.ref)));
        expect(parsed.success, `${slug}/${each.ref}: ${parsed.error?.message}`).toBe(true);
      }
    }
  });
});
