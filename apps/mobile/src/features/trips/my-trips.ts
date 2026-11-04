import { isPostponed } from '@expeditionplan/core';
import type { Tables } from '@expeditionplan/db';
import { forgetTrip, pruneLocal, refreshTrip } from '@expeditionplan/sync';

import { localDb, remote, TRIPS_KEY } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Lista wyjazdów z zapasem na brak sieci: udane pobranie ląduje w `localStorage`, a bez sieci
 * wraca ostatnia lista. Po udanym pobraniu plany wszystkich wyjazdów synchronizują się w tle —
 * na wyjeździe plan jest na telefonie, nawet jeśli nikt go wcześniej nie otworzył. Wyjazdy, których
 * na pobranej liście już nie ma (usunięte na webie, opuszczone), znikają z bazy telefonu.
 */

export type Trip = Tables<'my_trips'>;
export type MyTrips = { trips: Trip[]; offline: boolean; error: string };

let prefetching: Promise<void> | null = null;

function prefetch(trips: Trip[]) {
  if (prefetching !== null) return;
  prefetching = (async () => {
    for (const trip of trips) await refreshTrip(localDb, remote, trip.id!).catch(() => undefined);
  })().finally(() => (prefetching = null));
}

/** Ostatnia pobrana lista — bez sieci albo bez logowania. */
export function cachedTrips(): Trip[] | null {
  const cached = localStorage.getItem(TRIPS_KEY);
  return cached === null ? null : (JSON.parse(cached) as Trip[]);
}

/** `signedIn = false`: tylko lista z telefonu, bez pytania serwera. */
export async function loadMyTrips(signedIn = true): Promise<MyTrips> {
  if (!signedIn) return { trips: cachedTrips() ?? [], offline: true, error: '' };
  const { data, error } = await supabase.from('my_trips').select('*').order('start_date');
  if (!error) {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(data));
    pruneLocal(localDb, data.map((trip) => trip.id!));
    prefetch(data);
    return { trips: data, offline: false, error: '' };
  }
  const cached = cachedTrips();
  if (cached === null) return { trips: [], offline: true, error: error.message };
  return { trips: cached, offline: true, error: '' };
}

/**
 * Właściciel usuwa wyjazd, pozostali z niego wychodzą — tylko z siecią (decyduje serwer). Po
 * sukcesie wyjazd znika z listy w `localStorage` i z bazy telefonu. Zwraca komunikat błędu albo `null`.
 */
export async function removeTrip(trip: Trip): Promise<string | null> {
  const { error } = await supabase.rpc(trip.role === 'owner' ? 'delete_trip' : 'leave_trip', { p_trip: trip.id! });
  if (error) return error.message;
  localStorage.setItem(TRIPS_KEY, JSON.stringify((cachedTrips() ?? []).filter((each) => each.id !== trip.id)));
  forgetTrip(localDb, trip.id!);
  return null;
}

/** Domyślny wyjazd: trwający dziś, inaczej najbliższy nadchodzący, inaczej ostatni. Odłożony — tylko gdy nie ma innych. */
export function pickTrip(trips: Trip[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const planned = trips.filter((trip) => !isPostponed(trip));
  const ongoing = planned.find((trip) => trip.start_date! <= today && today <= trip.end_date!);
  const upcoming = planned.find((trip) => trip.start_date! > today);
  return (ongoing ?? upcoming ?? planned.at(-1) ?? trips.at(-1))?.id ?? null;
}

const CURRENT_KEY = 'current_trip';

/**
 * Wybrany wyjazd — wspólny dla zakładek Wyjazdy, Plan i Mapa (zapamiętany na telefonie). Bez
 * wyboru albo gdy wybranego nie ma już na liście — `pickTrip`.
 */
export function currentTrip(trips: Trip[]): string | null {
  const stored = localStorage.getItem(CURRENT_KEY);
  return stored !== null && trips.some((trip) => trip.id === stored) ? stored : pickTrip(trips);
}

export function setCurrentTrip(id: string) {
  localStorage.setItem(CURRENT_KEY, id);
}
