import { type TripState, stateFromLocal } from './document.ts';
import type { LocalDb } from './local-db.ts';
import { syncTrip } from './pull.ts';
import type { Remote } from './remote.ts';

/**
 * Plan offline na telefonie (MVP-1): ekran najpierw pokazuje to, co leży w SQLite, potem dociąga
 * zmiany (`syncTrip`: outbox, potem pobranie przyrostowe) i składa dokument od nowa. Bez sieci
 * zostaje ostatni stan razem z godziną synchronizacji.
 */

export type CachedTrip = { state: TripState; syncedAt: string };

/** Stan z SQLite albo `null`, gdy wyjazd nie był jeszcze pobrany na telefon. */
export function cachedTrip(db: LocalDb, tripId: string): CachedTrip | null {
  const synced = db.all<{ synced_at: string }>('select synced_at from sync_state where trip_id = ?', [tripId])[0];
  if (synced === undefined) return null;
  if (db.all('select id from trips where id = ?', [tripId]).length === 0) return null;
  return { state: stateFromLocal(db, tripId), syncedAt: synced.synced_at };
}

export type RefreshedTrip = CachedTrip & { changed: number; pending: number };

/** Synchronizacja i świeży stan. Błąd sieci przechodzi wyżej — stan w SQLite zostaje nietknięty. */
export async function refreshTrip(db: LocalDb, remote: Remote, tripId: string): Promise<RefreshedTrip> {
  const result = await syncTrip(db, remote, tripId);
  if (result.pull === null) throw new Error(result.flush.error ?? 'Nie udało się wysłać zapisów z telefonu');
  const cached = cachedTrip(db, tripId);
  if (cached === null) throw new Error(`Wyjazd ${tripId} nie trafił do bazy lokalnej`);
  return { ...cached, changed: result.pull.changed, pending: result.flush.remaining };
}

/** Zmiana konta na telefonie: plany poprzedniego konta nie zostają dla następnego. */
export function forgetLocal(db: LocalDb): void {
  db.transaction(() => {
    for (const table of ['outbox', 'rows', 'trips', 'sync_state']) db.run(`delete from ${table}`);
  });
}
