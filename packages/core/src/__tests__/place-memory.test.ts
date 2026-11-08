import { describe, expect, it } from 'vitest';

import {
  memoriesOf,
  memorySummary,
  type PlaceMemoryRow,
  placesAcrossTrips,
  placeVisitYears,
  plannerMemory,
  plannerMemoryLine,
  rememberedInPlan,
  visitLabel,
} from '../index.ts';

const row = (id: string, user: string, name: string, extra: Partial<PlaceMemoryRow> = {}): PlaceMemoryRow => ({
  id,
  user_id: user,
  author_name: user.toUpperCase(),
  name,
  lat: null,
  lng: null,
  verdict: null,
  note: null,
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const trips = [
  { id: 't1', title: 'Tatry 2024', startDate: '2024-07-01' },
  { id: 't2', title: 'Tatry 2025', startDate: '2025-08-10' },
  { id: 't3', title: 'Tatry 2027', startDate: '2027-02-01' },
  { id: 't4', title: 'Odłożone', startDate: '2023-05-01', status: 'postponed' },
];
const place = (id: string, trip_id: string, name: string, at?: [number, number]) => ({ id, trip_id, ref: `${id}-ref`, name, address: null, lat: at?.[0] ?? null, lng: at?.[1] ?? null });
const shared = placesAcrossTrips({
  trips,
  places: [
    place('a', 't1', 'Morskie Oko', [49.2, 20.07]),
    place('b', 't2', 'morskie oko', [49.2005, 20.0705]),
    place('c', 't3', 'Morskie Oko'),
    place('d', 't4', 'Kasprowy Wierch', [49.23, 19.98]),
    place('e', 't3', 'Gubałówka', [49.3, 19.94]),
  ],
  items: [],
  guides: [],
});
const oko = shared.find((each) => each.name === 'Morskie Oko')!;

describe('pamięć miejsc', () => {
  it('wpis łączy się z miejscem po nazwie i bliskich współrzędnych, daleki wpis to inne miejsce', () => {
    const rows = [
      row('1', 'ola', 'MORSKIE OKO', { lat: 49.2001, lng: 20.0701 }),
      row('2', 'kuba', 'Morskie Oko'),
      row('3', 'ola', 'Morskie Oko', { lat: 45, lng: 10 }),
      row('4', 'ola', 'Gubałówka'),
    ];
    expect(memoriesOf(oko, rows).map((each) => each.id).sort()).toEqual(['1', '2']);
    expect(oko.at).toEqual([20.07, 49.2]);
    expect(oko.trips.map((each) => each.placeId)).toEqual(['a', 'b', 'c']);
    expect(shared.find((each) => each.name === 'Gubałówka')!.placeId).toBe('e');
  });

  it('pamięć zapisuje się przez wystąpienie ze współrzędnymi', () => {
    const list = placesAcrossTrips({ trips, places: [place('x', 't1', 'Rusinowa Polana'), place('y', 't2', 'Rusinowa polana', [49.26, 20.09])], items: [], guides: [] });
    expect(list[0]).toMatchObject({ placeId: 'y', at: [20.09, 49.26] });
  });

  it('podsumowanie: jeden głos na osobę (najnowszy), moje pierwsze, remis to „mixed”', () => {
    const summary = memorySummary(
      [
        row('1', 'ola', 'X', { verdict: 'worth', updated_at: '2026-01-01T00:00:00Z' }),
        row('2', 'ola', 'X', { verdict: 'not_worth', note: ' rano tłumy ', updated_at: '2026-02-01T00:00:00Z' }),
        row('3', 'kuba', 'X', { verdict: 'worth' }),
        row('4', 'ania', 'X'),
      ],
      'kuba',
    );
    expect(summary.entries.map((each) => [each.author, each.verdict, each.note ?? null])).toEqual([
      ['KUBA', 'worth', null],
      ['OLA', 'not_worth', 'rano tłumy'],
    ]);
    expect(summary).toMatchObject({ worth: 1, notWorth: 1, verdict: 'mixed', mine: { userId: 'kuba' } });
    expect(memorySummary([]).verdict).toBeUndefined();
  });

  it('lata wizyt z wyjazdów, które już się zaczęły, bez odłożonych i bez planowanego', () => {
    expect(placeVisitYears(oko, '2026-11-08')).toEqual([2024, 2025]);
    expect(placeVisitYears(oko, '2026-11-08', 't2')).toEqual([2024]);
    expect(placeVisitYears(shared.find((each) => each.name === 'Kasprowy Wierch')!, '2026-11-08')).toEqual([]);
    expect(visitLabel([2025])).toBe('byliśmy w 2025');
    expect(visitLabel([2021, 2023, 2025])).toBe('byliśmy w 2021, 2023 i 2025');
    expect(visitLabel([])).toBeUndefined();
  });

  it('kontekst dla AI: „nie warto” na górze, odwiedzone do unikania, samo „warto” bez wizyty to podpowiedź', () => {
    const rows = [row('1', 'ola', 'Gubałówka', { verdict: 'not_worth', note: 'komercja' }), row('2', 'ola', 'Kasprowy Wierch', { verdict: 'worth' })];
    const memory = plannerMemory(shared, rows, '2026-11-08', 't3');
    expect(memory.map((each) => [each.name, each.avoid])).toEqual([
      ['Gubałówka', true],
      ['Morskie Oko', true],
      ['Kasprowy Wierch', false],
    ]);
    expect(plannerMemoryLine(memory[0]!)).toBe('[unikaj] Gubałówka — 1 × nie warto; notatka: „komercja”');
    expect(plannerMemoryLine(memory[1]!)).toBe('[unikaj] Morskie Oko — byliśmy w 2024 i 2025');
  });

  it('miejsca szkicu do unikania wyłapuje po nazwie i bliskości', () => {
    const memory = plannerMemory(shared, [], '2026-11-08', 't3');
    expect(rememberedInPlan([{ name: 'Morskie oko', lat: 49.2, lng: 20.07 }, { name: 'Gubałówka' }], memory).map((each) => each.name)).toEqual(['Morskie Oko']);
    expect(rememberedInPlan([{ name: 'Morskie Oko', lat: 40, lng: 20 }], memory)).toEqual([]);
  });
});
