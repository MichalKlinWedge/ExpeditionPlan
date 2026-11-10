import { flushOutbox, pendingCount, refreshTrip, type RejectedWrite } from '@expeditionplan/sync';
import * as BackgroundTask from 'expo-background-task';
import * as Network from 'expo-network';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { uploadPhotos, waitingPhotos } from '@/features/trip/journal-photos';
import { refreshCurrentReminders, scheduleTripReminders } from '@/features/trip/reminders';
import { localDb, remote } from '@/lib/local-db';
import { supabase } from '@/lib/supabase';

/**
 * Wysyłka zapisów z terenu niezależnie od otwartego ekranu: outbox (wydatki, odhaczenia, zdarzenia
 * dnia, dziennik) i zdjęcia dziennika i paragonów. Rusza przy starcie aplikacji, przy powrocie na
 * pierwszy plan, po powrocie sieci (`expo-network`) i co `EVERY_MS`, ale tylko wtedy, gdy coś czeka —
 * bez zapisów nie pyta sieci. Przy zamkniętej aplikacji to samo robi zadanie w tle (`SYNC_TASK`,
 * `expo-background-task`, Android decyduje o porze, najczęściej co ok. `BACKGROUND_MIN` minut), które
 * przy okazji przesuwa okno przypomnień „Za 15 min” (`refreshCurrentReminders` — 25 do przodu), żeby
 * telefon nieotwierany przez dzień nadal przypominał.
 * Po udanej wysyłce wyjazdy z tymi zapisami doczytują się (`refreshTrip`), a otwarty plan dostaje
 * znać przez `onBackgroundSync` (też o zapisach, których serwer nie przyjął).
 */

const EVERY_MS = 2 * 60_000;
const SYNC_TASK = 'sync-pending';
/** Najkrótszy odstęp zadania w tle, o jaki prosimy Androida (minimum WorkManagera to 15 min). */
const BACKGROUND_MIN = 30;

// `defineTask` przy ładowaniu modułu (import z `_layout.tsx`) — zadanie w tle startuje bez ekranu.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await syncPending();
    await refreshCurrentReminders();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export type BackgroundSync = { tripId: string; rejected: RejectedWrite[] };

const listeners = new Set<(event: BackgroundSync) => void>();

export function onBackgroundSync(listener: (event: BackgroundSync) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Wyjazdy z zapisami czekającymi na wysłanie (wiersz telefonu z `pending`). */
function pendingTrips(): string[] {
  return localDb.all<{ trip_id: string }>('select distinct trip_id from rows where pending = 1').map((row) => row.trip_id);
}

let running: Promise<void> | null = null;

/** Jedna próba wysyłki; równoległe wywołania czekają na tę samą. */
export function syncPending(): Promise<void> {
  running ??= (async () => {
    if (pendingCount(localDb) === 0 && waitingPhotos() === 0) return;
    if ((await supabase.auth.getSession()).data.session === null) return;
    const trips = pendingTrips();
    for (const tripId of trips) {
      const fresh = await refreshTrip(localDb, remote, tripId).catch(() => null);
      // Bez sieci pierwsza próba się nie uda — kolejne wyjazdy też nie, więc koniec tej rundy.
      if (fresh === null) return;
      void scheduleTripReminders(tripId, fresh.state.doc).catch(() => undefined);
      for (const listener of listeners) listener({ tripId, rejected: fresh.rejected });
    }
    // Zapisy bez wiersza w bazie telefonu (nie powinny się zdarzać) — sama wysyłka.
    if (trips.length === 0 && pendingCount(localDb) > 0) await flushOutbox(localDb, remote).catch(() => undefined);
    await uploadPhotos().catch(() => undefined);
  })().finally(() => (running = null));
  return running;
}

let started = false;

/** Start z `_layout.tsx`; drugi raz nic nie robi. */
export function startSyncLoop(): void {
  if (started) return;
  started = true;
  void syncPending();
  setInterval(() => {
    if (AppState.currentState === 'active') void syncPending();
  }, EVERY_MS);
  AppState.addEventListener('change', (state) => state === 'active' && void syncPending());
  // Sieć wróciła (koniec trybu samolotowego, zasięg po zejściu z gór) — od razu, bez czekania na zegar.
  let online: boolean | null = null;
  Network.addNetworkStateListener(({ isConnected, isInternetReachable }) => {
    const now = isConnected === true && isInternetReachable !== false;
    if (now && online === false) void syncPending();
    online = now;
  });
  void registerBackground();
}

async function registerBackground(): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: BACKGROUND_MIN });
  } catch {
    // Bez zadania w tle zostaje wysyłka przy otwartej aplikacji.
  }
}
