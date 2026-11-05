import { describe, expect, it } from 'vitest';

import { transportPlan } from '../traveler-transport.ts';

const names = (list: { name: string }[]) => list.map((each) => each.name);

describe('wspólny transport', () => {
  const people = [
    { id: '1', name: 'Ania', startPlaceId: 'wroclaw', endPlaceId: 'jakuszyce' },
    { id: '2', name: 'Bartek', startPlaceId: 'szewce', endPlaceId: 'jakuszyce', toDate: '2026-12-12' },
    { id: '3', name: 'Celina', startPlaceId: 'wroclaw', endPlaceId: 'jakuszyce' },
    { id: '4', name: 'Darek', startPlaceId: 'wroclaw', fromDate: '2026-12-12' },
    { id: '5', name: 'Ela' },
  ];

  it('grupuje po miejscu i dniu: największe grupy pierwsze, inny dzień to osobny transport', () => {
    const plan = transportPlan(people);
    expect(plan.starts.map((group) => [group.placeId, group.date, names(group.people)])).toEqual([
      ['wroclaw', null, ['Ania', 'Celina']],
      ['szewce', null, ['Bartek']],
      ['wroclaw', '2026-12-12', ['Darek']],
    ]);
    expect(plan.ends.map((group) => [group.placeId, group.date, names(group.people)])).toEqual([
      ['jakuszyce', null, ['Ania', 'Celina']],
      ['jakuszyce', '2026-12-12', ['Bartek']],
    ]);
  });

  it('pokazuje, kogo jeszcze brakuje', () => {
    const plan = transportPlan(people);
    expect(names(plan.noStart)).toEqual(['Ela']);
    expect(names(plan.noEnd)).toEqual(['Darek', 'Ela']);
  });

  it('pusty plan bez miejsc', () => {
    expect(transportPlan([{ id: '1', name: 'Ania', startPlaceId: null, endPlaceId: null }]).starts).toEqual([]);
  });
});
