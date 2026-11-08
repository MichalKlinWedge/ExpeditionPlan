import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { budgetSummary, carPlan, lineTravelers, settle, settleInputFromRows, TripDocument, vehicleTravelers } from '../index.ts';

const load = (slug: string) =>
  TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

const people = [
  { id: 'a', name: 'Ania', isDriver: true, startPlaceId: 'krk', endPlaceId: 'krk' },
  { id: 'b', name: 'Bartek', startPlaceId: 'krk', endPlaceId: 'krk' },
  { id: 'c', name: 'Celina', startPlaceId: 'kat', endPlaceId: 'krk' },
  { id: 'd', name: 'Darek', isDriver: true, startPlaceId: 'waw' },
  { id: 'e', name: 'Ewa', startPlaceId: 'waw', fromDate: '2026-07-03' },
  { id: 'f', name: 'Franek', startPlaceId: 'kat' },
];

describe('podział na auta', () => {
  it('kto z kim, wolne miejsca, odbiór po drodze, inne dni, bez auta i podpowiedź', () => {
    const plan = carPlan(people, [
      { id: 'skoda', label: 'Skoda', driverId: 'a', seats: 5, passengerIds: ['b', 'c'] },
      { id: 'fiat', label: 'Fiat', driverId: 'd', seats: 2, passengerIds: ['e'] },
    ]);
    const [skoda, fiat] = plan.cars;
    expect(skoda!.driver?.name).toBe('Ania');
    expect(skoda!.passengers.map((person) => person.name)).toEqual(['Bartek', 'Celina']);
    expect(skoda!.free).toBe(2);
    // Bartek rusza z Krakowa jak kierowca; Celinę trzeba odebrać w Katowicach.
    expect(skoda!.pickups).toEqual([{ placeId: 'kat', people: [people[2]] }]);
    expect(skoda!.dropoffs).toEqual([]);
    expect(fiat!.free).toBe(0);
    expect(fiat!.otherDays.map((person) => person.name)).toEqual(['Ewa']);
    expect(fiat!.noEnd.map((person) => person.name)).toEqual(['Ewa']);
    expect(plan.unassigned.map((person) => person.name)).toEqual(['Franek']);
    expect(plan.freeSeats).toBe(2);
    expect(plan.suggestions).toEqual([{ person: people[5], carId: 'skoda', samePlace: false }]);
    expect(plan.idleDrivers).toEqual([]);
    expect(plan.doubled).toEqual([]);
  });

  it('za dużo osób, osoba w dwóch autach, kierowca bez auta, auto bez liczby miejsc', () => {
    const plan = carPlan(people, [
      { id: 'mini', label: 'Mini', driverId: 'a', seats: 2, passengerIds: ['b', 'c'] },
      { id: 'van', label: 'Bus', passengerIds: ['c', 'e', 'f'] },
    ]);
    expect(plan.cars[0]!.free).toBe(-1);
    expect(plan.cars[1]!.free).toBeNull();
    expect(plan.freeSeats).toBeNull();
    expect(plan.doubled.map((person) => person.name)).toEqual(['Celina']);
    expect(plan.idleDrivers.map((person) => person.name)).toEqual(['Darek']);
    expect(plan.unassigned.map((person) => person.name)).toEqual(['Darek']);
    expect(plan.suggestions).toEqual([]);
  });

  it('bez aut nic nie ma: ani osób bez auta, ani kierowców bez auta', () => {
    const plan = carPlan(people, []);
    expect(plan).toMatchObject({ cars: [], unassigned: [], idleDrivers: [], freeSeats: 0, suggestions: [] });
  });
});

describe('koszt auta dzielony na jego osoby', () => {
  it('budżet: pozycja auta dotyczy kierowcy i pasażerów, a „na osobę” nie mnoży przez wszystkich', () => {
    const base = load('dinara');
    const [driver, passenger, ...rest] = base.travelers;
    const doc = TripDocument.parse({
      ...base,
      vehicles: [{ ref: 'auto-1', label: 'Skoda', driverRef: driver!.ref, seats: 5, passengerRefs: [passenger!.ref] }],
      budgetLines: [{ ref: 'paliwo', category: 'transport', title: 'Paliwo i winiety', status: 'estimate', lowMinor: 60_000, highMinor: 60_000, currency: 'PLN', vehicleRef: 'auto-1' }],
    });
    expect(vehicleTravelers(doc, 'auto-1')).toEqual([driver!.ref, passenger!.ref]);
    expect(lineTravelers(doc, doc.budgetLines[0]!)).toEqual([driver!.ref, passenger!.ref]);
    const summary = budgetSummary(doc);
    const share = Object.fromEntries(summary.perTraveler.map((each) => [each.ref, each.lowMinor]));
    expect(share[driver!.ref]).toBe(30_000);
    expect(share[passenger!.ref]).toBe(30_000);
    for (const other of rest) expect(share[other.ref] ?? 0).toBe(0);
  });

  it('auto bez osób w budżecie liczy się jak pozycja dla wszystkich', () => {
    const base = load('dinara');
    const doc = TripDocument.parse({ ...base, vehicles: [{ ref: 'auto-1', label: 'Skoda' }], budgetLines: [{ ref: 'paliwo', category: 'transport', title: 'Paliwo', status: 'estimate', lowMinor: 100, highMinor: 100, currency: 'PLN', vehicleRef: 'auto-1' }] });
    expect(lineTravelers(doc, doc.budgetLines[0]!)).toHaveLength(base.travelers.length);
  });

  it('dokument odrzuca auto z nieznanym kierowcą i pozycję wskazującą coś, co nie jest autem', () => {
    const base = load('dinara');
    expect(TripDocument.safeParse({ ...base, vehicles: [{ ref: 'auto-1', label: 'Skoda', driverRef: 'nikt' }] }).success).toBe(false);
    const line = { ref: 'paliwo', category: 'transport', title: 'Paliwo', status: 'estimate', lowMinor: 1, highMinor: 1, currency: 'PLN', vehicleRef: base.travelers[0]!.ref };
    expect(TripDocument.safeParse({ ...base, budgetLines: [line] }).success).toBe(false);
  });

  it('rozliczenie: paliwo zapłacone przez kierowcę dzielą tylko osoby jego auta, własny podział ma pierwszeństwo', () => {
    const input = settleInputFromRows({
      travelers: [
        { id: 'a', name: 'Ania' },
        { id: 'b', name: 'Bartek' },
        { id: 'c', name: 'Celina' },
        { id: 'd', name: 'Darek' },
      ],
      expenses: [
        { id: 'paliwo', payer_traveler_id: 'a', amount_minor: 30_000, currency: 'PLN', vehicle_id: 'skoda' },
        { id: 'winieta', payer_traveler_id: 'a', amount_minor: 10_000, currency: 'PLN', vehicle_id: 'skoda' },
      ],
      splits: [
        { expense_id: 'winieta', traveler_id: 'a', weight: 1 },
        { expense_id: 'winieta', traveler_id: 'd', weight: 1 },
      ],
      payments: [],
      vehicles: [{ id: 'skoda', label: 'Skoda', driver_traveler_id: 'a', passenger_ids: ['b', 'c'] }],
    });
    const result = settle({ ...input, toBase: (amount) => amount });
    const balance = Object.fromEntries(result.parties.map((party) => [party.name, party.balanceMinor]));
    // Paliwo 300 zł na Anię, Bartka i Celinę; winieta 100 zł na Anię i Darka (własny podział).
    expect(balance).toEqual({ Ania: 40_000 - 10_000 - 5_000, Bartek: -10_000, Celina: -10_000, Darek: -5_000 });
  });
});
