import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { balanceTask, balanceText, lineBalance, shiftTripDates, TripDocument } from '../index.ts';

const base = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/dinara/plan.json', import.meta.url)), 'utf8')));
const line = { ref: 'pakiet', category: 'activities', title: 'Michał i Kostek', status: 'committed', lowMinor: 599_237, highMinor: 599_237, currency: 'PLN', perPerson: false, depositMinor: 173_779, balanceDue: '2027-01-15' } as const;
const withLine = (each: Partial<typeof line> | Record<string, unknown> = {}) => TripDocument.parse({ ...base, budgetLines: [{ ...line, ...each }] });
let counter = 0;
const newRef = () => `zadanie-${++counter}`;

describe('dopłata po zadatku', () => {
  it('reszta i termin', () => {
    const doc = withLine();
    const balance = lineBalance(doc, doc.budgetLines[0]!)!;
    expect(balance).toMatchObject({ lowMinor: 425_458, highMinor: 425_458, due: '2027-01-15' });
    expect(balanceText(balance)).toMatch(/^do dopłaty 4\s?254,58\szł do 15\.01\.2027$/);
    expect(lineBalance(withLine({ status: 'paid' }), withLine({ status: 'paid' }).budgetLines[0]!)).toBeNull();
    expect(lineBalance(withLine({ depositMinor: undefined }), withLine({ depositMinor: undefined }).budgetLines[0]!)).toBeNull();
  });

  it('„na osobę”: reszta z całości dla wszystkich osób pozycji', () => {
    const doc = withLine({ perPerson: true, lowMinor: 100_000, highMinor: 100_000, depositMinor: 50_000 });
    expect(lineBalance(doc, doc.budgetLines[0]!)!.lowMinor).toBe(100_000 * doc.travelers.length - 50_000);
  });

  it('zadanie: powstaje z terminem, aktualizuje się, a zapłata je zamyka', () => {
    const doc = withLine();
    const created = balanceTask(doc, 'pakiet', doc.budgetLines[0], newRef)!;
    expect(created.op).toBe('insert');
    expect(created.task).toMatchObject({ title: 'Dopłata: Michał i Kostek', status: 'open', due: { kind: 'absolute', date: '2027-01-15' }, budgetLineRef: 'pakiet', priority: 'high' });
    const withTask = TripDocument.parse({ ...doc, tasks: [...doc.tasks, created.task] });
    expect(balanceTask(withTask, 'pakiet', withTask.budgetLines[0], newRef)).toBeNull();

    const later = TripDocument.parse({ ...withTask, budgetLines: [{ ...line, balanceDue: '2027-01-20' }] });
    expect(balanceTask(later, 'pakiet', later.budgetLines[0], newRef)).toMatchObject({ op: 'update', task: { ref: created.task.ref, due: { date: '2027-01-20' } } });

    const paid = TripDocument.parse({ ...withTask, budgetLines: [{ ...line, status: 'paid', depositMinor: undefined, balanceDue: undefined }] });
    expect(balanceTask(paid, 'pakiet', paid.budgetLines[0], newRef)).toMatchObject({ op: 'update', task: { status: 'done' } });

    const removed = balanceTask(withTask, 'pakiet', undefined, newRef)!;
    expect(removed.task.status).toBe('dropped');
    expect(removed.task.budgetLineRef).toBeUndefined();
  });

  it('bez terminu nie ma zadania', () => {
    const doc = withLine({ balanceDue: undefined });
    expect(balanceTask(doc, 'pakiet', doc.budgetLines[0], newRef)).toBeNull();
  });

  it('zmiana terminu wyjazdu nie przesuwa dopłaty ani jej zadania', () => {
    const doc = withLine();
    const task = balanceTask(doc, 'pakiet', doc.budgetLines[0], newRef)!.task;
    const shifted = shiftTripDates(TripDocument.parse({ ...doc, tasks: [...doc.tasks, task] }), '2030-06-01');
    expect(shifted.doc.budgetLines[0]!.balanceDue).toBe('2027-01-15');
    expect(shifted.doc.tasks.find((each) => each.ref === task.ref)!.due).toEqual({ kind: 'absolute', date: '2027-01-15' });
  });
});
