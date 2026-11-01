import { refIndex, type TripState, stateFromLocal } from './document.ts';
import type { LocalDb } from './local-db.ts';
import { pendingCount, recordEvent } from './outbox.ts';
import { syncTrip } from './pull.ts';
import type { Remote, ServerRow } from './remote.ts';

/**
 * Plan offline na telefonie (MVP-1): ekran najpierw pokazuje to, co leży w SQLite, potem dociąga
 * zmiany (`syncTrip`: outbox, potem pobranie przyrostowe) i składa dokument od nowa. Bez sieci
 * zostaje ostatni stan razem z godziną synchronizacji.
 */

/** `ids`: ref → id wierszy (zdarzenia dnia i edycja planu zapisują się po id); `pending` — zapisy czekające na sieć. */
export type CachedTrip = { state: TripState; syncedAt: string; ids: Record<string, string>; pending: number };

/** Stan z SQLite albo `null`, gdy wyjazd nie był jeszcze pobrany na telefon. */
export function cachedTrip(db: LocalDb, tripId: string): CachedTrip | null {
  const synced = db.all<{ synced_at: string }>('select synced_at from sync_state where trip_id = ?', [tripId])[0];
  if (synced === undefined) return null;
  if (db.all('select id from trips where id = ?', [tripId]).length === 0) return null;
  // Wszystkie tabele: edycja planu aktualizuje też warianty i źródła wskazujące usuwany punkt.
  const rows = db.all<{ tbl: string; data: string }>('select tbl, data from rows where trip_id = ?', [tripId]);
  const tables: Record<string, ServerRow[]> = {};
  for (const row of rows) (tables[row.tbl] ??= []).push(JSON.parse(row.data) as ServerRow);
  return { state: stateFromLocal(db, tripId), syncedAt: synced.synced_at, ids: refIndex(tables), pending: pendingCount(db) };
}

/**
 * „Zostajemy dłużej” (`minutes`) albo „Pomiń” — zdarzenie dnia do outboxa (działa offline),
 * a plan od razu liczy się z nim, bo `stateFromLocal` czyta też wiersze czekające na wysyłkę.
 * Cofnięcie opóźnienia to kolejne zdarzenie z ujemnymi minutami (zdarzenia są tylko dopisywane).
 */
export function recordDayEvent(db: LocalDb, tripId: string, cached: CachedTrip, dayRef: string, itemRef: string, event: { kind: 'delay'; minutes: number } | { kind: 'skip' }): void {
  const dayId = cached.ids[dayRef];
  const itemId = cached.ids[itemRef];
  if (dayId === undefined || itemId === undefined) throw new Error(`Brak id dla „${itemRef}” w bazie telefonu`);
  recordEvent(db, { tripId, dayId, itemId, kind: event.kind, minutes: event.kind === 'delay' ? event.minutes : null });
}

export type RefreshedTrip = CachedTrip & { changed: number };

/** Synchronizacja i świeży stan. Błąd sieci przechodzi wyżej — stan w SQLite zostaje nietknięty. */
export async function refreshTrip(db: LocalDb, remote: Remote, tripId: string): Promise<RefreshedTrip> {
  const result = await syncTrip(db, remote, tripId);
  if (result.pull === null) throw new Error(result.flush.error ?? 'Nie udało się wysłać zapisów z telefonu');
  const cached = cachedTrip(db, tripId);
  if (cached === null) throw new Error(`Wyjazd ${tripId} nie trafił do bazy lokalnej`);
  return { ...cached, changed: result.pull.changed };
}

/** Zmiana konta na telefonie: plany poprzedniego konta nie zostają dla następnego. */
export function forgetLocal(db: LocalDb): void {
  db.transaction(() => {
    for (const table of ['outbox', 'rows', 'trips', 'sync_state']) db.run(`delete from ${table}`);
  });
}
