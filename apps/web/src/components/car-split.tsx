"use client";

import { carPlan, type CarRow, plural } from "@expeditionplan/core";
import { useActionState, useState, useTransition } from "react";

import type { FormState } from "@/app/actions";
import { removeVehicle, saveVehicle, seatInVehicle } from "@/app/vehicle-actions";
import { travelerPresence } from "@/lib/labels";
import { IconAction } from "@/components/icon-action";

/**
 * Podział na auta (`core/vehicles.ts`): kto z kim jedzie, wolne miejsca, kogo odebrać po drodze (miejsce startu
 * pasażera inne niż kierowcy) i kogo odwieźć na koniec. Paliwo i winiety dzielą się na osoby auta: przy pozycji
 * budżetu i przy wydatku wybiera się auto (strona „Rezerwacje i budżet”).
 */

export type CarPerson = {
  id: string;
  name: string;
  is_driver: boolean | null;
  tentative: boolean | null;
  start_place_id: string | null;
  end_place_id: string | null;
  from_date: string | null;
  to_date: string | null;
};

const input = "field min-w-0 px-2 py-1 text-sm";

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-green-700 dark:text-green-400">{state.ok}</p>;
  return null;
}

function VehicleForm({ tripId, car, people, onDone }: { tripId: string; car?: CarRow; people: CarPerson[]; onDone?: () => void }) {
  const [driver, setDriver] = useState(car?.driverId ?? "");
  const [state, action, pending] = useActionState(async (prev: FormState, form: FormData) => {
    const result = await saveVehicle(tripId, car?.id ?? null, prev, form);
    if (result.ok && onDone) onDone();
    return result;
  }, {});
  return (
    <form action={action} className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <input name="label" required defaultValue={car?.label} placeholder="np. Skoda Ani" className={`${input} min-w-40 flex-1`} aria-label="Nazwa auta" />
        <label className="flex items-center gap-1">
          kierowca
          <select name="driver" value={driver} onChange={(event) => setDriver(event.target.value)} className={input}>
            <option value="">— nie wiadomo —</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.is_driver ? " (kierowca)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          miejsca
          <input name="seats" type="number" min={1} max={60} defaultValue={car?.seats ?? ""} placeholder="5" className={`${input} w-16`} aria-label="Miejsca razem z kierowcą" />
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <legend className="sr-only">Pasażerowie</legend>
        pasażerowie:
        {people
          .filter((person) => person.id !== driver)
          .map((person) => (
            <label key={person.id} className="flex items-center gap-1">
              <input type="checkbox" name="passenger" value={person.id} defaultChecked={car?.passengerIds?.includes(person.id) ?? false} /> {person.name}
            </label>
          ))}
      </fieldset>
      <input name="notes" defaultValue={car?.notes ?? ""} placeholder="uwagi, np. bagażnik dachowy, fotelik" className={input} aria-label="Uwagi" />
      <p className="text-xs text-zinc-500">Miejsca liczą się razem z kierowcą. Osoba zaznaczona tutaj przesiada się z innego auta.</p>
      <div className="flex gap-2">
        <button disabled={pending} className="btn-primary btn-sm">
          {pending ? "Zapisuję…" : car ? "Zapisz" : "Dodaj auto"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="btn-secondary btn-sm">
            Anuluj
          </button>
        )}
      </div>
      <Status state={state} />
    </form>
  );
}

export function CarSplit({ tripId, people, cars, places, canEdit }: { tripId: string; people: CarPerson[]; cars: CarRow[]; places: { id: string; name: string }[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<FormState>({});
  const [pending, start] = useTransition();
  const plan = carPlan(
    people.map((person) => ({ ...person, isDriver: person.is_driver, startPlaceId: person.start_place_id, endPlaceId: person.end_place_id, fromDate: person.from_date, toDate: person.to_date })),
    cars,
  );
  const placeName = (id: string | null) => (id ? (places.find((place) => place.id === id)?.name ?? "?") : null);
  const names = (list: { name: string }[]) => list.map((person) => person.name).join(", ");
  const carLabel = (id: string) => cars.find((car) => car.id === id)?.label ?? "?";
  const run = (action: () => Promise<FormState>, confirm?: string) => {
    if (confirm !== undefined && !window.confirm(confirm)) return;
    start(async () => setResult(await action()));
  };

  if (cars.length === 0 && !canEdit) return <p className="text-sm text-zinc-500">Nikt jeszcze nie podzielił osób na auta. Zmiana po „Edytuj”.</p>;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {cars.length > 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          {plural(cars.length, ["auto", "auta", "aut"])}
          {plan.freeSeats !== null ? ` · wolne miejsca: ${plan.freeSeats}` : ""}
          {plan.unassigned.length > 0 ? ` · bez auta: ${plan.unassigned.length}` : " · wszyscy mają miejsce"}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {plan.cars.map((seat) =>
          editing === seat.car.id ? (
            <li key={seat.car.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <VehicleForm tripId={tripId} car={seat.car} people={people} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={seat.car.id} className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">🚗 {seat.car.label}</span>
                <span
                  className={`rounded-full px-2 text-xs font-medium ${
                    seat.free === null ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : seat.free < 0 ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" : seat.free === 0 ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  }`}
                >
                  {seat.free === null ? `${seat.taken} os., miejsc nie podano` : seat.free < 0 ? `za dużo o ${-seat.free}` : seat.free === 0 ? `komplet (${seat.taken})` : `wolne: ${seat.free} z ${seat.car.seats}`}
                </span>
                <span className="flex-1" />
                {canEdit && (
                  <span className="flex gap-1">
                    <IconAction kind="edit" onClick={() => setEditing(seat.car.id)} />
                    <IconAction kind="remove" onClick={() => run(() => removeVehicle(tripId, seat.car.id), `Usunąć auto „${seat.car.label}”? Jego paliwo i wydatki wrócą do podziału na wszystkich.`)} disabled={pending} />
                  </span>
                )}
              </div>
              <p>
                <span className="text-zinc-500">kierowca:</span> {seat.driver?.name ?? <span className="text-amber-700 dark:text-amber-400">nie wiadomo</span>}
                {seat.passengers.length > 0 && (
                  <>
                    {" "}
                    · <span className="text-zinc-500">jadą:</span> {seat.passengers.map((person) => `${person.name}${person.tentative ? " (waha się)" : ""}`).join(", ")}
                  </>
                )}
              </p>
              {(seat.startPlaceId || seat.pickups.length > 0) && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  start{seat.startPlaceId ? `: ${placeName(seat.startPlaceId)}` : ""}
                  {seat.pickups.map((stop) => ` → odbiór: ${placeName(stop.placeId)} (${names(stop.people)})`).join("")}
                </p>
              )}
              {(seat.endPlaceId || seat.dropoffs.length > 0) && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  na koniec{seat.dropoffs.map((stop) => `: ${placeName(stop.placeId)} (${names(stop.people)}) →`).join("")} {seat.endPlaceId ? placeName(seat.endPlaceId) : ""}
                </p>
              )}
              {seat.startPlaceId && seat.noStart.length > 0 && <p className="text-xs text-zinc-500">Bez miejsca startu (skąd zabrać?): {names(seat.noStart)}</p>}
              {seat.otherDays.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Jadą w inne dni niż kierowca: {seat.otherDays.map((person) => `${person.name}${travelerPresence(person.fromDate ?? null, person.toDate ?? null) ? ` (${travelerPresence(person.fromDate ?? null, person.toDate ?? null)})` : ""}`).join(", ")}
                </p>
              )}
              {seat.car.notes && <p className="text-xs whitespace-pre-line text-zinc-600 dark:text-zinc-400">{seat.car.notes}</p>}
            </li>
          ),
        )}
      </ul>
      {plan.unassigned.length > 0 && (
        <div className="flex flex-col gap-1">
          <p>
            <span className="font-medium">Bez auta:</span> {names(plan.unassigned)}
          </p>
          {canEdit &&
            plan.suggestions.map((each) => (
              <p key={each.person.id} className="flex flex-wrap items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                {each.person.name} → „{carLabel(each.carId)}”{each.samePlace ? " (rusza z tego samego miejsca)" : ""}
                <button onClick={() => run(() => seatInVehicle(tripId, each.carId, each.person.id))} disabled={pending} className="btn-mini">
                  dosadź
                </button>
              </p>
            ))}
        </div>
      )}
      {plan.doubled.length > 0 && <p className="text-xs text-red-600">W dwóch autach naraz: {names(plan.doubled)}. Popraw jedno z nich.</p>}
      {plan.idleDrivers.length > 0 && <p className="text-xs text-zinc-500">Kierowcy bez auta: {names(plan.idleDrivers)}</p>}
      <Status state={result} />
      {canEdit &&
        (adding ? (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <VehicleForm tripId={tripId} people={people} onDone={() => setAdding(false)} />
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn-secondary btn-sm self-start">
            + Dodaj auto
          </button>
        ))}
      {cars.length > 0 && <p className="text-xs text-zinc-500">Paliwo i winiety: przy pozycji budżetu albo wydatku wybierz auto, a koszt podzieli się na osoby tego auta.</p>}
    </div>
  );
}
