/**
 * Podział na auta: kto z kim jedzie, wolne miejsca, odbiór pasażerów z ich miejsc startu i odwiezienie na koniec.
 * Działa na samych identyfikatorach (wiersze bazy albo `ref` z dokumentu), jak `traveler-transport.ts`:
 * strona uczestników nie pobiera całego planu. Koszt auta (paliwo, winiety) dzieli się na osoby auta
 * (`vehicleTravelers`): w budżecie przez `DocBudgetLine.vehicleRef`, w rozliczeniu przez `expenses.vehicle_id`.
 */

import type { TransportPerson } from './traveler-transport.ts';

export type CarRow = { id: string; label: string; driverId?: string | null; seats?: number | null; passengerIds?: readonly string[] | null; notes?: string | null };

/** Osoby auta: kierowca i pasażerowie, bez powtórzeń, kierowca pierwszy. */
export function carOccupants(car: Pick<CarRow, 'driverId' | 'passengerIds'>): string[] {
  return [...new Set([...(car.driverId ? [car.driverId] : []), ...(car.passengerIds ?? [])])];
}

/** To samo na dokumencie: `ref` kierowcy i pasażerów auta o danym `ref`; brak auta albo pusto = `[]`. */
export function vehicleTravelers(doc: { vehicles: readonly { ref: string; driverRef?: string | undefined; passengerRefs: readonly string[] }[] }, vehicleRef: string | undefined): string[] {
  const vehicle = vehicleRef === undefined ? undefined : doc.vehicles.find((each) => each.ref === vehicleRef);
  return vehicle === undefined ? [] : carOccupants({ driverId: vehicle.driverRef ?? null, passengerIds: vehicle.passengerRefs });
}

/** Postój po drodze: miejsce i osoby, które tam wsiadają (na początku) albo wysiadają (na końcu). */
export type CarStop<P> = { placeId: string; people: P[] };

export type CarSeating<P extends TransportPerson> = {
  car: CarRow;
  driver: P | undefined;
  passengers: P[];
  /** Zajęte miejsca: kierowca i pasażerowie. */
  taken: number;
  /** Wolne miejsca; `null`, gdy liczba miejsc nieznana. Ujemne = za dużo osób. */
  free: number | null;
  /** Skąd rusza auto: miejsce startu kierowcy. */
  startPlaceId: string | null;
  endPlaceId: string | null;
  /** Pasażerowie wsiadający gdzie indziej niż start kierowcy, po miejscach (najliczniejsze najpierw). */
  pickups: CarStop<P>[];
  dropoffs: CarStop<P>[];
  /** Pasażerowie bez wpisanego startu albo końca: nie wiadomo, skąd ich zabrać. */
  noStart: P[];
  noEnd: P[];
  /** Pasażerowie, którzy jadą w inne dni niż kierowca (dołączają później, wyjeżdżają wcześniej). */
  otherDays: P[];
};

export type CarPlan<P extends TransportPerson> = {
  cars: CarSeating<P>[];
  /** Uczestnicy bez auta (tylko gdy jakieś auto jest). */
  unassigned: P[];
  /** Kto jest w więcej niż jednym aucie. */
  doubled: P[];
  /** Kierowcy (`isDriver`), którzy nie prowadzą żadnego auta. */
  idleDrivers: P[];
  /** Wolne miejsca razem; `null`, gdy któreś auto nie ma liczby miejsc. */
  freeSeats: number | null;
  /** Podpowiedź dla osoby bez auta: auto z wolnym miejscem, najlepiej ruszające z jej miejsca startu. */
  suggestions: { person: P; carId: string; samePlace: boolean }[];
};

function stops<P>(people: P[], place: (person: P) => string | null | undefined, skip: string | null): CarStop<P>[] {
  const byPlace = new Map<string, P[]>();
  for (const person of people) {
    const id = place(person);
    if (!id || id === skip) continue;
    byPlace.set(id, [...(byPlace.get(id) ?? []), person]);
  }
  return [...byPlace].map(([placeId, list]) => ({ placeId, people: list })).sort((a, b) => b.people.length - a.people.length);
}

export function carPlan<P extends TransportPerson>(people: readonly P[], cars: readonly CarRow[]): CarPlan<P> {
  const byId = new Map(people.map((person) => [person.id, person]));
  const seatCount = new Map<string, number>();
  const seated: CarSeating<P>[] = cars.map((car) => {
    const driver = car.driverId ? byId.get(car.driverId) : undefined;
    const passengers = (car.passengerIds ?? []).filter((id) => id !== car.driverId).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    for (const id of carOccupants(car)) if (byId.has(id)) seatCount.set(id, (seatCount.get(id) ?? 0) + 1);
    const taken = (driver ? 1 : 0) + passengers.length;
    const startPlaceId = driver?.startPlaceId ?? null;
    const endPlaceId = driver?.endPlaceId ?? null;
    return {
      car,
      driver,
      passengers,
      taken,
      free: car.seats ? car.seats - taken : null,
      startPlaceId,
      endPlaceId,
      pickups: stops(passengers, (person) => person.startPlaceId, startPlaceId),
      dropoffs: stops(passengers, (person) => person.endPlaceId, endPlaceId),
      noStart: passengers.filter((person) => !person.startPlaceId),
      noEnd: passengers.filter((person) => !person.endPlaceId),
      otherDays: driver === undefined ? [] : passengers.filter((person) => (person.fromDate ?? null) !== (driver.fromDate ?? null) || (person.toDate ?? null) !== (driver.toDate ?? null)),
    };
  });

  const unassigned = cars.length === 0 ? [] : people.filter((person) => !seatCount.has(person.id));
  const left = new Map(seated.map((each) => [each.car.id, each.free]));
  const suggestions: CarPlan<P>['suggestions'] = [];
  for (const person of unassigned) {
    // Najpierw auto z tego samego miejsca startu, potem dowolne z wolnym miejscem; auta bez liczby miejsc się nie podpowiada.
    const open = seated.filter((each) => (left.get(each.car.id) ?? 0) > 0);
    const same = person.startPlaceId ? open.find((each) => each.startPlaceId === person.startPlaceId) : undefined;
    const pick = same ?? open.sort((a, b) => (left.get(b.car.id) ?? 0) - (left.get(a.car.id) ?? 0))[0];
    if (pick === undefined) continue;
    left.set(pick.car.id, (left.get(pick.car.id) ?? 0) - 1);
    suggestions.push({ person, carId: pick.car.id, samePlace: same !== undefined });
  }

  const drivingIds = new Set(cars.flatMap((car) => (car.driverId ? [car.driverId] : [])));
  return {
    cars: seated,
    unassigned,
    doubled: people.filter((person) => (seatCount.get(person.id) ?? 0) > 1),
    idleDrivers: cars.length === 0 ? [] : people.filter((person) => person.isDriver && !drivingIds.has(person.id)),
    freeSeats: seated.some((each) => each.free === null) ? null : seated.reduce((sum, each) => sum + Math.max(each.free ?? 0, 0), 0),
    suggestions,
  };
}

/** Auto z wiersza bazy `vehicles`. */
export function carFromRow(row: Record<string, unknown> & { id: string }): CarRow {
  return {
    id: row.id,
    label: String(row.label ?? ''),
    driverId: (row.driver_traveler_id as string | null) ?? null,
    seats: (row.seats as number | null) ?? null,
    passengerIds: (row.passenger_ids as string[] | null) ?? [],
    notes: (row.notes as string | null) ?? null,
  };
}
