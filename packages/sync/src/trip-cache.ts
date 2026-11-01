import { refIndex, type TripState, stateFromLocal } from './document.ts';
import type { LocalDb } from './local-db.ts';
import { pendingCount, recordEvent, type RejectedWrite } from './outbox.ts';
import { syncTrip } from './pull.ts';
import type { Remote, ServerRow } from './remote.ts';

/**
 * Plan offline na telefonie (MVP-1): ekran najpierw pokazuje to, co leży w SQLite, potem dociąga
 * zmiany (`syncTrip`: outbox, potem pobranie przyrostowe) i składa dokument od nowa. Bez sieci
 * zostaje ostatni stan razem z godziną synchronizacji.
 */

/**
 * `ids`: ref → id wierszy (zdarzenia dnia i edycja planu zapisują się po id); `pending` — zapisy
 * czekające na sieć; `live` — wiersze spoza dokumentu planu (portfel, odhaczenia pakowania,
 * uczestnicy z kontem), bez usuniętych, razem z zapisami z telefonu.
 */
export type CachedTrip = {
  state: TripState;
  syncedAt: string;
  ids: Record<string, string>;
  pending: number;
  live: { expenses: ServerRow[]; packingChecks: ServerRow[]; travelers: ServerRow[] };
};

/** Stan z SQLite albo `null`, gdy wyjazd nie był jeszcze pobrany na telefon. */
export function cachedTrip(db: LocalDb, tripId: string): CachedTrip | null {
  const synced = db.all<{ synced_at: string }>('select synced_at from sync_state where trip_id = ?', [tripId])[0];
  if (synced === undefined) return null;
  if (db.all('select id from trips where id = ?', [tripId]).length === 0) return null;
  // Wszystkie tabele: edycja planu aktualizuje też warianty i źródła wskazujące usuwany punkt.
  const rows = db.all<{ tbl: string; data: string }>('select tbl, data from rows where trip_id = ?', [tripId]);
  const tables: Record<string, ServerRow[]> = {};
  for (const row of rows) (tables[row.tbl] ??= []).push(JSON.parse(row.data) as ServerRow);
  const alive = (table: string) => (tables[table] ?? []).filter((row) => row.deleted_at === null || row.deleted_at === undefined);
  return {
    state: stateFromLocal(db, tripId),
    syncedAt: synced.synced_at,
    ids: refIndex(tables),
    pending: pendingCount(db),
    live: { expenses: alive('expenses'), packingChecks: alive('packing_checks'), travelers: alive('travelers') },
  };
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

/** `rejected` — zapisy z telefonu, których serwer nie przyjął (już wycofane z bazy telefonu). */
export type RefreshedTrip = CachedTrip & { changed: number; rejected: RejectedWrite[] };

/** Synchronizacja i świeży stan. Błąd sieci przechodzi wyżej — stan w SQLite zostaje nietknięty. */
export async function refreshTrip(db: LocalDb, remote: Remote, tripId: string): Promise<RefreshedTrip> {
  const result = await syncTrip(db, remote, tripId);
  if (result.pull === null) throw new Error(result.flush.error ?? 'Nie udało się wysłać zapisów z telefonu');
  const cached = cachedTrip(db, tripId);
  if (cached === null) throw new Error(`Wyjazd ${tripId} nie trafił do bazy lokalnej`);
  return { ...cached, changed: result.pull.changed, rejected: result.flush.rejected ?? [] };
}

/**
 * Wyjazd usunięty albo opuszczony: jego plan, zapisy czekające w outboxie (serwer i tak by ich
 * nie przyjął) i stan synchronizacji znikają z telefonu.
 */
export function forgetTrip(db: LocalDb, tripId: string): void {
  db.transaction(() => {
    db.run("delete from outbox where json_extract(payload, '$.trip_id') = ?", [tripId]);
    for (const table of ['rows', 'sync_state']) db.run(`delete from ${table} where trip_id = ?`, [tripId]);
    db.run('delete from trips where id = ?', [tripId]);
  });
}

/**
 * Po pobraniu listy „moich wyjazdów”: wyjazdy, których na niej już nie ma (usunięte na webie,
 * opuszczone, odebrany dostęp), znikają z telefonu. Zwraca id zapomnianych.
 */
export function pruneLocal(db: LocalDb, keepTripIds: string[]): string[] {
  const keep = new Set(keepTripIds);
  const local = db.all<{ id: string }>('select id from trips union select trip_id as id from sync_state union select distinct trip_id as id from rows');
  const gone = local.map((row) => row.id).filter((id) => !keep.has(id));
  for (const id of gone) forgetTrip(db, id);
  return gone;
}

/** Zmiana konta na telefonie: plany poprzedniego konta nie zostają dla następnego. */
export function forgetLocal(db: LocalDb): void {
  db.transaction(() => {
    for (const table of ['outbox', 'rows', 'trips', 'sync_state']) db.run(`delete from ${table}`);
  });
}
