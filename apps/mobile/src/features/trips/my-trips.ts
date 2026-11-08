import { isPostponed, localToday, tripSections } from '@expeditionplan/core';
import type { Tables } from '@expeditionplan/db';
import { pruneLocal, refreshTrip, dbLoadError } from '@expeditionplan/sync';

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
  if (cached === null) return { trips: [], offline: true, error: dbLoadError(error) };
  return { trips: cached, offline: true, error: '' };
}

const ARCHIVED_KEY = 'archived_trips';

/**
 * Wyjazdy przeniesione do archiwum na tym telefonie („Do archiwum” na karcie). Telefon nigdy nie
 * usuwa wyjazdu ani z niego nie wychodzi — to robi się na webie; tu wyjazd tylko zmienia sekcję.
 */
export function archivedTrips(): Set<string> {
  try {
    const stored = localStorage.getItem(ARCHIVED_KEY);
    return new Set(stored === null ? [] : (JSON.parse(stored) as string[]));
  } catch {
    return new Set();
  }
}

export function setTripArchived(id: string, archived: boolean): Set<string> {
  const ids = archivedTrips();
  if (archived) ids.add(id);
  else ids.delete(id);
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...ids]));
  } catch {
    // Bez zapisu wyjazd wróci na swoje miejsce przy następnym otwarciu.
  }
  return ids;
}

/** Wyjazdy aktywne (przed nami i odłożone) — bez archiwum (po dacie końca albo zarchiwizowanych na telefonie) i szkiców AI. */
export function activeTrips(trips: Trip[]): Trip[] {
  const archived = archivedTrips();
  const { ahead, postponed } = tripSections(trips.filter((trip) => !archived.has(trip.id!)), localToday());
  return [...ahead, ...postponed];
}

/** Domyślny wyjazd: trwający dziś, inaczej najbliższy nadchodzący, inaczej ostatni. Odłożony i zarchiwizowany na telefonie — tylko gdy nie ma innych. */
export function pickTrip(trips: Trip[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const archived = archivedTrips();
  const planned = trips.filter((trip) => !isPostponed(trip) && !archived.has(trip.id!));
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
