import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fieldLog, hasFieldLog } from '../field-log.ts';
import { TripDocument } from '../schemas/trip-document.ts';

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

describe('przebieg dnia z terenu na webie', () => {
  it('opóźnienia, pominięcia, „zrobione”, pula i wariant — tylko z tego dnia', () => {
    const maroko = load('maroko');
    const [first, second] = maroko.items.filter((item) => item.dayRef === 'd1');
    const other = maroko.items.find((item) => item.dayRef === 'd2')!;
    const fromPool = maroko.items.find((item) => item.dayRef === undefined)!;
    const group = maroko.variantGroups.find((each) => each.ref === 'd1-start')!;
    const variant = maroko.variants.find((each) => each.groupRef === group.ref)!;

    const log = fieldLog(maroko, 'd1', {
      delays: [
        { itemRef: first!.ref, minutes: 15 },
        { itemRef: first!.ref, minutes: 30 },
        { itemRef: other.ref, minutes: 15 },
      ],
      skipRefs: [second!.ref, other.ref],
      done: [{ itemRef: first!.ref, at: 1000 }],
      pulled: [{ itemRef: fromPool.ref, dayRef: 'd1', at: 2000 }],
      activeVariants: { [group.ref]: variant.ref, 'd2-ciecia': maroko.variants.find((each) => each.groupRef === 'd2-ciecia')!.ref },
    });

    expect(log.delays).toEqual([{ itemRef: first!.ref, title: first!.title, minutes: 45 }]);
    expect(log.skipped).toEqual([{ itemRef: second!.ref, title: second!.title }]);
    expect(log.done).toEqual([{ itemRef: first!.ref, title: first!.title, at: 1000 }]);
    expect(log.pulled).toEqual([{ itemRef: fromPool.ref, title: fromPool.title }]);
    expect(log.variants).toEqual([{ groupRef: group.ref, group: group.title, variantRef: variant.ref, variant: variant.label }]);
    expect(hasFieldLog(log)).toBe(true);
  });

  it('bez zdarzeń — pusto', () => {
    expect(hasFieldLog(fieldLog(load('chatka'), 'd1', {}))).toBe(false);
  });
});
