"use server";

import { carOccupants, carFromRow } from "@expeditionplan/core";
import { dbErrorMessage, uuidv7 } from "@expeditionplan/sync";
import { refresh } from "next/cache";

import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth";

/**
 * Podział na auta (strona „Uczestnicy i dostęp”, `core/vehicles.ts`): auto z kierowcą, liczbą miejsc i pasażerami.
 * Wiersze `vehicles` zapisuje się wprost, jak uczestników; o prawie decyduje RLS (organizator, edytor).
 * Osoba siedzi w jednym aucie: dopisanie jej do auta zabiera ją z innego. Wydatki i pozycje budżetu auta
 * (`vehicle_id`) dzielą się na jego osoby.
 */

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function tripCars(supabase: Supabase, tripId: string) {
  const [cars, people] = await Promise.all([
    supabase.from("vehicles").select("id, label, driver_traveler_id, seats, passenger_ids, notes").eq("trip_id", tripId).is("deleted_at", null),
    supabase.from("travelers").select("id, name").eq("trip_id", tripId).is("deleted_at", null),
  ]);
  if (cars.error) return { error: dbErrorMessage(cars.error) } as const;
  if (people.error) return { error: dbErrorMessage(people.error) } as const;
  return { cars: cars.data.map(carFromRow), people: people.data } as const;
}

/** Zabiera osoby z innych aut (jako pasażerów); kierowcy innego auta nie da się przesadzić. */
async function takeFromOthers(supabase: Supabase, cars: ReturnType<typeof carFromRow>[], keep: string, ids: string[]): Promise<string | null> {
  for (const car of cars) {
    if (car.id === keep) continue;
    const left = (car.passengerIds ?? []).filter((id) => !ids.includes(id));
    if (left.length === (car.passengerIds ?? []).length) continue;
    const { error } = await supabase.from("vehicles").update({ passenger_ids: left }).eq("id", car.id);
    if (error) return dbErrorMessage(error);
  }
  return null;
}

export async function saveVehicle(tripId: string, vehicleId: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const label = String(form.get("label") ?? "").trim();
  if (label === "") return { error: "Podaj nazwę auta, np. „Skoda Ani”." };
  const seatsText = String(form.get("seats") ?? "").trim();
  const seats = seatsText === "" ? null : Number(seatsText);
  if (seats !== null && (!Number.isInteger(seats) || seats < 1 || seats > 60)) return { error: "Miejsca: liczba od 1 do 60, razem z kierowcą." };
  const driver = String(form.get("driver") ?? "") || null;
  const notes = String(form.get("notes") ?? "").trim() || null;

  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const loaded = await tripCars(supabase, tripId);
  if ("error" in loaded) return { error: loaded.error };
  const { cars, people } = loaded;
  const known = new Set(people.map((person) => person.id));
  const name = (id: string) => people.find((person) => person.id === id)?.name ?? "?";
  const passengers = [...new Set(form.getAll("passenger").map(String))].filter((id) => known.has(id) && id !== driver);
  if (driver !== null && !known.has(driver)) return { error: "Nie ma takiego kierowcy wśród uczestników." };
  if (vehicleId !== null && !cars.some((car) => car.id === vehicleId)) return { error: "Tego auta już nie ma: odśwież stronę." };

  const everyone = [...(driver ? [driver] : []), ...passengers];
  const otherDriver = cars.find((car) => car.id !== vehicleId && car.driverId !== null && everyone.includes(car.driverId!));
  if (otherDriver) return { error: `${name(otherDriver.driverId!)} prowadzi już „${otherDriver.label}”: zmień najpierw tamto auto.` };
  if (seats !== null && everyone.length > seats) return { error: `W aucie z ${seats} miejscami nie zmieści się ${everyone.length} osób.` };

  const moved = await takeFromOthers(supabase, cars, vehicleId ?? "", everyone);
  if (moved) return { error: moved };
  const row = { label, driver_traveler_id: driver, seats, passenger_ids: passengers, notes };
  const { data, error } =
    vehicleId === null
      ? await supabase
          .from("vehicles")
          .insert({ ...row, id: uuidv7(), trip_id: tripId, sort_key: `z${Date.now().toString(36)}` })
          .select("id")
      : await supabase.from("vehicles").update(row).eq("id", vehicleId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (data.length === 0) return { error: "Auta zmienia tylko organizator albo edytor." };
  refresh();
  return { ok: vehicleId === null ? `Dodano: ${label}` : "Zapisano." };
}

/** Dosadzenie jednej osoby do auta (podpowiedź „do auta”): zabiera ją z innego auta. */
export async function seatInVehicle(tripId: string, vehicleId: string, travelerId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  const loaded = await tripCars(supabase, tripId);
  if ("error" in loaded) return { error: loaded.error };
  const car = loaded.cars.find((each) => each.id === vehicleId);
  if (car === undefined) return { error: "Tego auta już nie ma: odśwież stronę." };
  if (!loaded.people.some((person) => person.id === travelerId)) return { error: "Nie ma takiego uczestnika." };
  if (loaded.cars.some((each) => each.driverId === travelerId)) return { error: "Ta osoba prowadzi auto." };
  const taken = carOccupants(car).length;
  if (car.seats && taken >= car.seats) return { error: `„${car.label}” nie ma wolnego miejsca.` };
  const moved = await takeFromOthers(supabase, loaded.cars, vehicleId, [travelerId]);
  if (moved) return { error: moved };
  const { data, error } = await supabase.from("vehicles").update({ passenger_ids: [...(car.passengerIds ?? []), travelerId] }).eq("id", vehicleId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (data.length === 0) return { error: "Auta zmienia tylko organizator albo edytor." };
  refresh();
  return { ok: "Zapisano." };
}

/** Usunięcie auta (miękkie); jego pozycje budżetu i wydatki wracają do podziału na wszystkich albo własnego. */
export async function removeVehicle(tripId: string, vehicleId: string): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/people`);
  for (const table of ["budget_lines", "expenses"] as const) {
    const { error } = await supabase.from(table).update({ vehicle_id: null }).eq("trip_id", tripId).eq("vehicle_id", vehicleId);
    if (error) return { error: dbErrorMessage(error) };
  }
  const { data, error } = await supabase.from("vehicles").update({ deleted_at: new Date().toISOString() }).eq("id", vehicleId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (data.length === 0) return { error: "Auta usuwa tylko organizator albo edytor." };
  refresh();
  return { ok: "Usunięto auto." };
}

/** Wydatek auta (paliwo, winiety): bez własnego podziału dzieli się na osoby tego auta. Prawo: RLS `expenses_update`. */
export async function setExpenseVehicle(tripId: string, expenseId: string, vehicleId: string | null): Promise<FormState> {
  const { supabase } = await requireUser(`/trips/${tripId}/logistics`);
  const { data, error } = await supabase.from("expenses").update({ vehicle_id: vehicleId }).eq("id", expenseId).eq("trip_id", tripId).select("id");
  if (error) return { error: dbErrorMessage(error) };
  if (data.length === 0) return { error: "Brak uprawnień do zmiany tego wydatku." };
  refresh();
  return { ok: "Zapisano." };
}
