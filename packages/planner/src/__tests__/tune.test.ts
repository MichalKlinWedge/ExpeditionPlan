import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dayItems, itemsForDay, PlanPatch, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { applyPatch, patchDiff, tuneContext } from '../tune.ts';

const maroko = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/maroko/plan.json', import.meta.url)), 'utf8')));
let n = 0;
const newId = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
const d2 = dayItems(maroko, 'd2').filter((item) => item.variantRefs.length === 0);
const free = d2.find((item) => !maroko.constraints.some((each) => each.itemRef === item.ref) && !maroko.tasks.some((each) => each.itemRef === item.ref))!;

describe('etap 3 — łatka na planie', () => {
  it('kontekst: dni z kluczami punktów, blokady widoczne dla modelu', () => {
    const context = tuneContext(maroko, new Set([d2[0]!.ref]));
    expect(context.days.map((day) => day.ref)).toEqual(maroko.days.map((day) => day.ref));
    expect(context.days[1]!.items.find((item) => item.ref === d2[0]!.ref)).toMatchObject({ locked: true });
  });

  it('do puli, przeniesienie, nowy punkt z nowym miejscem po wskazanym, zmiana czasu — dokument poprawny', () => {
    const patch: PlanPatch = {
      message: 'ok',
      ops: [
        { op: 'remove_item', itemRef: free.ref, toPool: true },
        { op: 'add_item', dayRef: 'd2', afterItemRef: d2[0]!.ref, item: { title: 'Herbata miętowa na tarasie', kind: 'meal', durationMin: 30, place: 'Café des Épices', searchName: 'Café des Épices' } },
        { op: 'set_field', itemRef: d2[0]!.ref, field: 'durationMin', value: 20 },
        { op: 'move_item', itemRef: dayItems(maroko, 'd3')[1]!.ref, toDayRef: 'd4' },
      ],
    };
    const { doc, results } = applyPatch(maroko, patch, new Set(), newId);
    expect(results.map((result) => result.ok)).toEqual([true, true, true, true]);
    expect(doc.items.find((item) => item.ref === free.ref)!.dayRef).toBeUndefined();
    const day = dayItems(doc, 'd2').map((item) => item.title);
    expect(day[1]).toBe('Herbata miętowa na tarasie');
    expect(doc.places.at(-1)).toMatchObject({ name: 'Café des Épices', searchName: 'Café des Épices' });
    expect(() => TripDocument.parse(doc)).not.toThrow();

    const diff = patchDiff(maroko, doc);
    expect(diff.created.map((entry) => entry.collection)).toEqual(['places', 'items']);
    expect(diff.changed.map((item) => item.ref)).toContain(free.ref);
    expect(diff.removed).toEqual([]);
  });

  it('punkt zablokowany, zły klucz i operacja psująca plan są odrzucane z powodem, reszta przechodzi', () => {
    const constrained = maroko.constraints.find((each) => each.itemRef !== undefined)!.itemRef!;
    const patch: PlanPatch = {
      message: 'ok',
      ops: [
        { op: 'set_field', itemRef: d2[0]!.ref, field: 'title', value: 'Inna nazwa' },
        { op: 'remove_item', itemRef: 'nie-ma-takiego', toPool: true },
        { op: 'remove_item', itemRef: constrained, toPool: false },
        { op: 'set_field', itemRef: d2[1]!.ref, field: 'durationMin', value: 45 },
      ],
    };
    const { doc, results } = applyPatch(maroko, patch, new Set([d2[0]!.ref]), newId);
    expect(results.map((result) => result.ok)).toEqual([false, false, false, true]);
    expect(results[0]!.text).toContain('ręcznie');
    expect(doc.items.find((item) => item.ref === d2[0]!.ref)!.title).toBe(d2[0]!.title);
    expect(doc.items.find((item) => item.ref === d2[1]!.ref)!.durationMin).toBe(45);
  });

  it('plan B na dzień: A = dotychczasowy dzień, B zastępuje wskazane punkty nowymi w tym samym miejscu', () => {
    const day = 'd4';
    const before = itemsForDay(maroko, day).map((item) => item.ref);
    const replaced = before.slice(1, 3);
    const patch = PlanPatch.parse({
      message: 'ok',
      ops: [
        {
          op: 'add_variant',
          dayRef: day,
          title: 'Plan na deszcz',
          conditionKind: 'weather',
          conditionText: 'pada od rana',
          mainLabel: 'Słońce',
          label: 'Deszcz: muzeum',
          replacesItemRefs: replaced,
          items: [
            { title: 'Muzeum (test)', kind: 'visit', durationMin: 90, place: 'Muzeum testowe' },
            { title: 'Herbata (test)', kind: 'meal', durationMin: 30 },
          ],
        },
        { op: 'add_variant', dayRef: day, title: 'Zły', conditionKind: 'choice', mainLabel: 'A', label: 'B', replacesItemRefs: ['nie-ma-takiego'], items: [{ title: 'X', kind: 'free' }] },
      ],
    });
    const { doc, results } = applyPatch(maroko, patch, new Set([replaced[0]!]), newId);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(() => TripDocument.parse(doc)).not.toThrow();

    const group = doc.variantGroups.at(-1)!;
    expect(group).toMatchObject({ scope: 'day', dayRef: day, title: 'Plan na deszcz', conditionKind: 'weather' });
    const [main, alt] = doc.variants.filter((variant) => variant.groupRef === group.ref);
    expect(main).toMatchObject({ label: 'Słońce', excludesRefs: [] });
    expect(alt).toMatchObject({ label: 'Deszcz: muzeum', excludesRefs: replaced });

    // Bez wyboru dzień liczy się jak dotąd; z B — nowe punkty w miejscu zastąpionych.
    expect(itemsForDay(doc, day).map((item) => item.ref)).toEqual(before);
    const withB = itemsForDay(doc, day, { activeVariants: { [group.ref]: alt!.ref } }).map((item) => item.title);
    const expected = maroko.items.filter((item) => before.includes(item.ref) && !replaced.includes(item.ref)).sort((a, b) => before.indexOf(a.ref) - before.indexOf(b.ref)).map((item) => item.title);
    expected.splice(1, 0, 'Muzeum (test)', 'Herbata (test)');
    expect(withB).toEqual(expected);
    // Zastąpiony punkt zablokowany zostaje nietknięty — wariant tylko go wyłącza.
    expect(doc.items.find((item) => item.ref === replaced[0])).toEqual(maroko.items.find((item) => item.ref === replaced[0]));

    const diff = patchDiff(maroko, doc);
    expect(diff.created.map((entry) => entry.collection)).toEqual(['places', 'variantGroups', 'variants', 'variants', 'items', 'items']);
  });

  it('plan B nie wyrzuca noclegu — zameldowanie zostaje w obu wariantach', () => {
    const patch = PlanPatch.parse({
      message: 'ok',
      ops: [{ op: 'add_variant', dayRef: 'd3', title: 'Deszcz', conditionKind: 'weather', mainLabel: 'Słońce', label: 'Deszcz', replacesItemRefs: ['d3-sk-zameldowanie'], items: [{ title: 'Hammam (test)', kind: 'activity', durationMin: 90 }] }],
    });
    const { doc, results } = applyPatch(maroko, patch, new Set(), newId);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0]!.text).toContain('nocleg zostaje');
    expect(doc.variants.at(-1)!.excludesRefs).toEqual([]);
  });
});

describe('etap 3 — linki', () => {
  const lodging = maroko.items.find((item) => item.kind === 'lodging')!;
  const visit = maroko.items.find((item) => item.kind === 'visit')!;
  const airbnb = 'https://www.airbnb.pl/rooms/123?adults=4';

  it('link wolno dodać także do punktu zmienionego ręcznie; nocleg dostaje link „Obiekt”, inne punkty zwykły', () => {
    const patch = PlanPatch.parse({
      message: 'Dodaję linki.',
      ops: [
        { op: 'add_link', itemRef: lodging.ref, url: airbnb },
        { op: 'add_link', itemRef: visit.ref, url: 'https://example.com/bilety', label: 'Bilety' },
        { op: 'set_field', itemRef: lodging.ref, field: 'description', value: 'x' },
      ],
    });
    const { doc, results } = applyPatch(maroko, patch, new Set([lodging.ref, visit.ref]), newId);
    expect(results.map((each) => each.ok)).toEqual([true, true, false]);
    expect(doc.items.find((item) => item.ref === lodging.ref)!.links[0]).toEqual({ label: 'Airbnb', url: airbnb });
    expect(doc.items.find((item) => item.ref === visit.ref)!.links.at(-1)).toEqual({ label: 'Bilety', url: 'https://example.com/bilety' });
    expect(applyPatch(doc, PlanPatch.parse({ message: 'x', ops: [{ op: 'add_link', itemRef: lodging.ref, url: airbnb }] }), new Set(), newId).results[0]!.ok).toBe(false);
  });

  it('link spoza http(s) odrzuca już schemat', () => {
    expect(PlanPatch.safeParse({ message: 'x', ops: [{ op: 'add_link', itemRef: visit.ref, url: 'javascript:alert(1)' }] }).success).toBe(false);
  });
});
