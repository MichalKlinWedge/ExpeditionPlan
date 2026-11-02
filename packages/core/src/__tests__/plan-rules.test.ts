import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { itemsForDay, scheduleDay } from '../engine/schedule.ts';
import { documentProblem } from '../plan-edits.ts';
import {
  addConstraint,
  addDayVariantGroup,
  addVariant,
  chainRules,
  dayConstraints,
  itemVariant,
  removeConstraint,
  removeVariant,
  removeVariantGroup,
  setItemVariant,
  updateConstraint,
  updateVariant,
  updateVariantGroup,
} from '../plan-rules.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const raw = TripDocument.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')),
);
// W bazie każde ograniczenie ma klucz (`id-<uuid>` dla wierszy bez `ref`) — tak jak w edytorze.
const maroko: TripDocument = { ...raw, constraints: raw.constraints.map((each, index) => ({ ...each, ref: each.ref ?? `c${index}` })) };
let counter = 0;
const newId = () => `01a1a000-0000-7000-8000-${String(++counter).padStart(12, '0')}`;
const visible = (doc: TripDocument, day: string, active: Record<string, string> = {}) => itemsForDay(doc, day, { activeVariants: active }).map((item) => item.ref);

describe('warianty w edytorze', () => {
  it('plan B dnia: dwa warianty, dzień liczy się jak wcześniej, punkt „tylko B” pojawia się po przełączeniu', () => {
    const before = visible(maroko, 'd3');
    const added = addDayVariantGroup(maroko, 'd3', newId, { title: 'Pogoda', conditionKind: 'weather', conditionText: 'jeśli wieje' }, ['Słońce', 'Wiatr']);
    expect(documentProblem(added.doc)).toBeNull();
    expect(added.writes.map((write) => [write.collection, write.op])).toEqual([['variantGroups', 'insert'], ['variants', 'insert'], ['variants', 'insert']]);
    expect(visible(added.doc, 'd3')).toEqual(before);

    const group = added.writes[0]!.element.ref;
    const [a, b] = added.writes.slice(1).map((write) => write.element.ref);
    const item = before.at(-1)!;
    const onlyB = setItemVariant(added.doc, item, group, b!)!;
    expect(onlyB.changed.map((each) => each.ref)).toEqual([item]);
    expect(itemVariant(onlyB.doc, item, group)).toBe(b);
    expect(visible(onlyB.doc, 'd3')).not.toContain(item);
    expect(visible(onlyB.doc, 'd3', { [group]: b! })).toContain(item);
    expect(documentProblem(onlyB.doc)).toBeNull();

    const always = setItemVariant(onlyB.doc, item, group, null)!;
    expect(itemVariant(always.doc, item, group)).toBeNull();
    expect(visible(always.doc, 'd3', { [group]: a! })).toContain(item);
    expect(setItemVariant(always.doc, item, group, null)).toBeNull();
  });

  it('„wyrzuca” z planu wzorcowego czyta się jako „tylko A”, a przypisanie je czyści', () => {
    expect(itemVariant(maroko, 'd4-plaza', 'd4-wariant')).toBe('d4-v-a');
    expect(itemVariant(maroko, 'd4-paradise', 'd4-wariant')).toBe('d4-v-b');
    const both = setItemVariant(maroko, 'd4-plaza', 'd4-wariant', null)!;
    expect(both.writes).toHaveLength(1);
    expect(both.doc.variants.find((each) => each.ref === 'd4-v-b')!.excludesRefs).not.toContain('d4-plaza');
    expect(visible(both.doc, 'd4', { 'd4-wariant': 'd4-v-b' })).toContain('d4-plaza');
  });

  it('rekomendowany jest jeden w grupie; termin decyzji i wybór zapisują się w grupie', () => {
    const edit = updateVariant(maroko, 'd4-v-b', { recommended: true })!;
    const variants = edit.doc.variants.filter((each) => each.groupRef === 'd4-wariant');
    expect(variants.filter((each) => each.recommended).map((each) => each.ref)).toEqual(['d4-v-b']);
    expect(edit.writes).toHaveLength(2);

    const group = updateVariantGroup(maroko, 'd4-wariant', { decideBy: { time: '08:30' }, chosenRef: 'd4-v-b', conditionText: '' })!;
    const saved = group.doc.variantGroups.find((each) => each.ref === 'd4-wariant')!;
    expect(saved.decideBy).toEqual({ time: '08:30' });
    expect(saved.chosenRef).toBe('d4-v-b');
    expect('conditionText' in saved).toBe(false);
    expect(visible(group.doc, 'd4')).toContain('d4-paradise');
    expect(documentProblem(group.doc)).toBeNull();
  });

  it('usunięcie wariantu: punkty tylko z niego wracają do puli; dwa ostatnie warianty zostają', () => {
    const third = addVariant(maroko, 'd4-wariant', newId, 'C · leniwy dzień')!;
    const c = third.writes[0]!.element.ref;
    const onlyC = setItemVariant(third.doc, 'd4-paradise', 'd4-wariant', c)!;
    const removed = removeVariant(onlyC.doc, c)!;
    expect(removed.doc.items.find((each) => each.ref === 'd4-paradise')!.dayRef).toBeUndefined();
    expect(documentProblem(removed.doc)).toBeNull();
    expect(() => removeVariant(maroko, 'd4-v-b')).toThrow(/co najmniej dwa/);
  });

  it('usunięcie grupy: zostaje wybrany plan, reszta do puli; zadanie-decyzja blokuje', () => {
    expect(() => removeVariantGroup(maroko, 'd4-wariant', 'd4-v-b')).toThrow(/Czy sadzawki/);
    const free: TripDocument = { ...maroko, tasks: maroko.tasks.filter((task) => task.variantGroupRef !== 'd4-wariant') };
    const keepB = removeVariantGroup(free, 'd4-wariant', 'd4-v-b')!;
    expect(documentProblem(keepB.doc)).toBeNull();
    expect(keepB.doc.variantGroups.some((each) => each.ref === 'd4-wariant')).toBe(false);
    const day = visible(keepB.doc, 'd4');
    expect(day).toContain('d4-paradise');
    expect(day).not.toContain('d4-plaza');
    expect(keepB.doc.items.find((each) => each.ref === 'd4-plaza')!.dayRef).toBeUndefined();
    expect(keepB.doc.items.find((each) => each.ref === 'd4-paradise')!.variantRefs).toEqual([]);
    expect(keepB.writes.filter((write) => write.op === 'remove')).toHaveLength(3);
  });
});

describe('kilka zmian naraz', () => {
  it('formularz grupy: jeden zapis na element, wstawienie zostaje wstawieniem', () => {
    let added = '';
    const edit = chainRules(maroko, [
      (doc) => updateVariantGroup(doc, 'd4-wariant', { title: 'Wydmy czy dolina' }),
      (doc) => updateVariantGroup(doc, 'd4-wariant', { decideBy: { time: '08:00' } }),
      (doc) => {
        const step = addVariant(doc, 'd4-wariant', newId, 'C')!;
        added = step.writes[0]!.element.ref;
        return step;
      },
      (doc) => updateVariant(doc, added, { recommended: true }),
      () => null,
    ])!;
    expect(edit.writes.map((write) => [write.collection, write.element.ref, write.op])).toEqual([
      ['variantGroups', 'd4-wariant', 'update'],
      ['variants', added, 'insert'],
      ['variants', 'd4-v-a', 'update'],
    ]);
    const group = edit.doc.variantGroups.find((each) => each.ref === 'd4-wariant')!;
    expect([group.title, group.decideBy]).toEqual(['Wydmy czy dolina', { time: '08:00' }]);
    expect(documentProblem(edit.doc)).toBeNull();
    expect(chainRules(maroko, [() => null])).toBeNull();
  });
});

describe('ograniczenia w edytorze', () => {
  it('dodanie, zmiana i usunięcie — silnik od razu je widzi', () => {
    const first = scheduleDay(maroko, 'd2').items[0]!;
    const added = addConstraint(maroko, newId, { kind: 'latest_start', dayRef: 'd2', itemRef: first.ref, time: '06:00', severity: 'hard', reason: 'test' });
    expect(documentProblem(added.doc)).toBeNull();
    const ref = added.writes[0]!.element.ref;
    const warn = (doc: TripDocument) => scheduleDay(doc, 'd2').warnings.filter((each) => each.kind === 'constraint' && each.itemRef === first.ref && each.message.includes('06:00'));
    expect(warn(added.doc)).toHaveLength(1);
    expect(dayConstraints(added.doc, 'd2').some(({ constraint }) => constraint.ref === ref)).toBe(true);

    const soft = updateConstraint(added.doc, ref, { kind: 'latest_start', dayRef: 'd2', itemRef: first.ref, time: '06:00', severity: 'soft', reason: '' })!;
    expect(warn(soft.doc)[0]!.severity).toBe('soft');
    expect(soft.doc.constraints.find((each) => each.ref === ref)!.reason).toBeUndefined();

    const removed = removeConstraint(soft.doc, ref)!;
    expect(warn(removed.doc)).toHaveLength(0);
    expect(removed.writes[0]!.op).toBe('remove');
  });

  it('ograniczenie całego wyjazdu (bez dnia i punktu) obowiązuje w każdym dniu', () => {
    const tripWide = maroko.constraints.find((each) => each.kind === 'no_driving_after_dark')!;
    expect(tripWide.dayRef).toBeUndefined();
    // Wyjazd z Essaouiry o 22:00 zamiast 17:00 — po zmroku.
    const late: TripDocument = {
      ...maroko,
      constraints: [tripWide],
      items: maroko.items.map((item) => (item.ref === 'd3-wyjazd-sk' ? { ...item, time: { precision: 'exact' as const, start: '22:00' } } : item)),
    };
    const dark = (doc: TripDocument) => scheduleDay(doc, 'd3').warnings.filter((each) => each.kind === 'constraint' && each.message.includes('po zmroku'));
    expect(dark(late)).toHaveLength(1);
    expect(dark({ ...late, constraints: [] })).toHaveLength(0);
  });
});
