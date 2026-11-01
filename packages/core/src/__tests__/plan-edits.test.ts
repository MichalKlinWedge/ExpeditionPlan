import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scheduleDay } from '../engine/schedule.ts';
import { addItem, dayItems, documentProblem, ItemInUseError, moveToDay, moveWithinDay, removeItem, updateItem } from '../plan-edits.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const maroko = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
const refs = (doc: TripDocument, day: string) => dayItems(doc, day).map((item) => item.ref);

describe('edycja planu (MVP-3)', () => {
  it('w górę i w dół zmienia jeden punkt, a dokument zostaje poprawny', () => {
    const [first, second] = refs(maroko, 'd2');
    const edit = moveWithinDay(maroko, second!, -1)!;
    expect(edit.changed).toHaveLength(1);
    expect(refs(edit.doc, 'd2').slice(0, 2)).toEqual([second, first]);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(moveWithinDay(maroko, first!, -1)).toBeNull();
  });

  it('w dół o jedno miejsce', () => {
    const [first, second, third] = refs(maroko, 'd2');
    const edit = moveWithinDay(maroko, first!, 1)!;
    expect(refs(edit.doc, 'd2').slice(0, 3)).toEqual([second, first, third]);
  });

  it('do puli i z powrotem: status i godzina względna pilnowane', () => {
    const ref = refs(maroko, 'd2')[1]!;
    const pooled = moveToDay(maroko, ref, null)!;
    const item = pooled.doc.items.find((each) => each.ref === ref)!;
    expect(item.dayRef).toBeUndefined();
    expect(item.planStatus).not.toBe('scheduled');
    expect(documentProblem(pooled.doc)).toBeNull();
    const back = moveToDay(pooled.doc, ref, 'd3')!;
    expect(refs(back.doc, 'd3').at(-1)).toBe(ref);
    expect(back.doc.items.find((each) => each.ref === ref)!.planStatus).toBe('scheduled');
    expect(documentProblem(back.doc)).toBeNull();
  });

  it('zmiana czasu trwania przelicza dzień', () => {
    const ref = refs(maroko, 'd2')[1]!;
    const end = (doc: TripDocument) => scheduleDay(doc, 'd2').items.find((each) => each.ref === ref)!.end;
    const edit = updateItem(maroko, ref, { durationMin: (maroko.items.find((each) => each.ref === ref)!.durationMin ?? 0) + 60, durationMaxMin: undefined })!;
    expect(end(edit.doc) - end(maroko)).toBe(60 * 60_000);
  });

  it('nowy punkt na końcu dnia i usunięcie', () => {
    const added = addItem(maroko, 'd2', '01a19366-0000-7000-8000-000000000001', { title: 'Herbata', kind: 'meal', durationMin: 20 });
    expect(added.created!.ref).toBe('id-01a19366-0000-7000-8000-000000000001');
    expect(refs(added.doc, 'd2').at(-1)).toBe(added.created!.ref);
    expect(documentProblem(added.doc)).toBeNull();
    const removed = removeItem(added.doc, added.created!.ref)!;
    expect(removed.doc.items.some((each) => each.ref === added.created!.ref)).toBe(false);
  });

  it('usunięcie punktu wyrzucanego przez wariant: wariant przestaje go wyrzucać', () => {
    const edit = removeItem(maroko, 'd1-suki')!;
    const variant = edit.others?.find((each) => each.collection === 'variants');
    expect(variant?.element.excludesRefs).not.toContain('d1-suki');
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('usunięcie bloku: podpunkty zostają bez bloku', () => {
    const chatka = TripDocument.parse(
      JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/chatka/plan.json', import.meta.url)), 'utf8')),
    );
    const block = chatka.items.find((item) => chatka.items.some((other) => other.parentRef === item.ref))!;
    // Ograniczenie przy bloku najpierw znika (w planie wzorcowym blok PRACA je ma).
    const free = { ...chatka, constraints: chatka.constraints.filter((each) => each.itemRef !== block.ref) };
    const edit = removeItem(free, block.ref)!;
    expect(edit.changed.length).toBeGreaterThan(0);
    expect(edit.changed.every((item) => item.parentRef === undefined)).toBe(true);
    expect(documentProblem(edit.doc)).toBeNull();
  });

  it('punkt wskazany przez ograniczenie albo budżet nie da się usunąć', () => {
    const constrained = maroko.constraints.find((each) => each.itemRef !== undefined) ?? maroko.budgetLines.find((each) => each.itemRef !== undefined);
    expect(constrained).toBeDefined();
    expect(() => removeItem(maroko, constrained!.itemRef!)).toThrow(ItemInUseError);
  });
});
