import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { carriesFromRows, defaultTake, formatWeight, gearCarriers, gearGaps, gearLoads, gearShare, parseWeightKg } from '../gear.ts';
import { TripDocument } from '../schemas/trip-document.ts';
import { tripReadiness } from '../trip-readiness.ts';

type Item = TripDocument['packing'][number];

const dinara = TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/plans/dinara/plan.json', import.meta.url)), 'utf8')));
const item = (over: Partial<Item> = {}): Item => ({ ref: 'pot', category: 'kuchnia', title: 'Garnek', scope: 'shared', ...over });
const plan = (packing: Item[]): TripDocument => ({
  ...dinara,
  travelers: [
    { ref: 'a', name: 'A' },
    { ref: 'b', name: 'B' },
  ],
  packing,
});

describe('kto bierze rzecz wspólną', () => {
  it('nikt nie bierze, ktoś bierze, a dwie osoby przy jednej sztuce to dublowanie', () => {
    expect(gearShare(item(), []).status).toBe('open');
    expect(gearShare(item(), [{ itemRef: 'pot', travelerRef: 'a', quantity: 1 }]).status).toBe('covered');
    const twice = gearShare(item(), [
      { itemRef: 'pot', travelerRef: 'a', quantity: 1 },
      { itemRef: 'pot', travelerRef: 'b', quantity: 1 },
    ]);
    expect(twice).toMatchObject({ status: 'over', taken: 2, left: 0 });
  });

  it('rzecz dzieli się po kawałku: liczy się, ile jeszcze zostało', () => {
    const water = item({ ref: 'water', quantity: 28, unit: 'l' });
    const share = gearShare(water, [
      { itemRef: 'water', travelerRef: 'a', quantity: 10 },
      { itemRef: 'water', travelerRef: 'b', quantity: 0 },
    ]);
    expect(share).toMatchObject({ status: 'partial', taken: 10, left: 18 });
    expect(share.carriers.map((each) => each.travelerRef)).toEqual(['a']);
  });

  it('osoba wskazana w planie bierze całość, inni mogą dołączyć, a zdejmuje ją tylko jej własne „nie biorę”', () => {
    const planned = item({ assigneeRef: 'a', quantity: 2 });
    expect(gearCarriers(planned, [])).toEqual([{ travelerRef: 'a', quantity: 2 }]);
    expect(gearCarriers(planned, [{ itemRef: 'pot', travelerRef: 'b', quantity: 1 }]).map((each) => each.travelerRef)).toEqual(['a', 'b']);
    expect(gearCarriers(planned, [{ itemRef: 'pot', travelerRef: 'a', quantity: 0 }])).toEqual([]);
    expect(gearCarriers(planned, [{ itemRef: 'pot', travelerRef: 'a', quantity: 1 }])).toEqual([{ travelerRef: 'a', quantity: 1 }]);
  });

  it('rzecz osobista nie ma nosicieli, nawet ze starym wierszem po zmianie zakresu', () => {
    expect(gearCarriers(item({ scope: 'personal' }), [{ itemRef: 'pot', travelerRef: 'a', quantity: 1 }])).toEqual([]);
  });

  it('„biorę” to sztuka, a gdy zostało mniej — reszta', () => {
    expect(defaultTake({ left: 3 })).toBe(1);
    expect(defaultTake({ left: 0.5 })).toBe(0.5);
    expect(defaultTake({ left: 0 })).toBe(1);
  });

  it('wiersze bazy na klucze dokumentu; wiersz usuniętej rzeczy odpada', () => {
    const ids = { pot: 'id-pot', a: 'id-a' };
    expect(
      carriesFromRows(
        [
          { packing_item_id: 'id-pot', traveler_id: 'id-a', quantity: '2.5', deleted_at: null },
          { packing_item_id: 'id-pot', traveler_id: 'id-a', quantity: 1, deleted_at: '2026-11-05T10:00:00Z' },
          { packing_item_id: 'id-usuniete', traveler_id: 'id-a', quantity: 1, deleted_at: null },
        ],
        ids,
      ),
    ).toEqual([{ itemRef: 'pot', travelerRef: 'a', quantity: 2.5 }]);
  });
});

describe('obciążenie', () => {
  it('osobiste każdego plus wspólne, które niesie; waga razy ilość, brak wagi policzony osobno', () => {
    const loads = gearLoads(
      plan([
        item({ ref: 'kask', scope: 'personal', weightG: 300 }),
        item({ ref: 'skarpety', scope: 'personal', quantity: 3, weightG: 100 }),
        item({ ref: 'tylko-b', scope: 'personal', assigneeRef: 'b', weightG: 1000 }),
        item({ ref: 'water', quantity: 28, weightG: 1000 }),
        item({ ref: 'noz' }),
        item({ ref: 'makaron', category: 'zakupy', weightG: 500 }),
      ]),
      [
        { itemRef: 'water', travelerRef: 'a', quantity: 10 },
        { itemRef: 'water', travelerRef: 'b', quantity: 18 },
        { itemRef: 'noz', travelerRef: 'a', quantity: 1 },
        { itemRef: 'makaron', travelerRef: 'a', quantity: 1 },
      ],
    );
    expect(loads[0]).toMatchObject({ travelerRef: 'a', weightG: 10_600, noWeight: 1 });
    expect(loads[0]!.shared.map((each) => each.item.ref)).toEqual(['water', 'noz']);
    expect(loads[1]).toMatchObject({ travelerRef: 'b', weightG: 19_600, noWeight: 0 });
    expect(loads[1]!.personal.map((each) => each.ref)).toEqual(['kask', 'skarpety', 'tylko-b']);
  });

  it('do ustalenia: wspólne bez kompletu, bez osobistych i zakupów', () => {
    const packing = [item({ ref: 'noz' }), item({ ref: 'water', quantity: 2 }), item({ ref: 'kask', scope: 'personal' }), item({ ref: 'mleko', category: 'zakupy' }), item({ ref: 'pila', assigneeRef: 'a' })];
    expect(gearGaps(plan(packing), [{ itemRef: 'water', travelerRef: 'a', quantity: 1 }]).map((each) => each.ref)).toEqual(['noz', 'water']);
  });

  it('gotowość wymienia sprzęt bez osoby, gdy zna podział', () => {
    const doc = plan([item({ ref: 'noz', title: 'Nóż' }), item({ ref: 'pila', title: 'Piła' })]);
    const gear = (carries?: { itemRef: string; travelerRef: string; quantity: number }[]) => tripReadiness(doc, doc.trip.startDate, undefined, carries).filter((each) => each.group === 'gear');
    expect(gear()).toEqual([]);
    expect(gear([{ itemRef: 'pila', travelerRef: 'a', quantity: 1 }]).map((each) => each.title)).toEqual(['Nóż']);
  });
});

describe('waga', () => {
  it('z pola w kilogramach na gramy', () => {
    expect(parseWeightKg('1,5')).toBe(1500);
    expect(parseWeightKg(' 0.25 ')).toBe(250);
    expect(parseWeightKg('')).toBeUndefined();
    expect(parseWeightKg('dużo')).toBeNull();
    expect(parseWeightKg('-1')).toBeNull();
  });

  it('w gramach i kilogramach', () => {
    expect(formatWeight(800)).toBe('800 g');
    expect(formatWeight(1500)).toBe('1,5 kg');
    expect(formatWeight(12_000)).toBe('12 kg');
  });
});
