import type { LocalDb } from './local-db.ts';
import { flushOutbox, type FlushOptions, type FlushResult } from './outbox.ts';
import type { PullPayload, Remote, ServerRow } from './remote.ts';

/**
 * Pobieranie zmian serwer → telefon (SPECYFIKACJA §6): pierwsza migawka to `since = 0`, potem
 * tylko wiersze o `row_version` wyższej niż ostatnio widziana. Całość z jednego wywołania
 * `pull_changes`, czyli z jednej migawki bazy, i stosowana w jednej transakcji SQLite.
 */

export function localVersion(db: LocalDb, tripId: string): number {
  return db.all<{ version: number }>('select version from sync_state where trip_id = ?', [tripId])[0]?.version ?? 0;
}

function upsertRow(db: LocalDb, table: string, row: ServerRow) {
  // Starsza wersja nie nadpisze nowszej (dwa pobrania w locie), a wiersz wciąż czekający
  // w outboxie zostaje w wersji z telefonu, dopóki serwer go nie przyjmie.
  db.run(
    `insert into rows (tbl, id, trip_id, data, row_version, pending, deleted_at) values (?, ?, ?, ?, ?, 0, ?)
     on conflict (tbl, id) do update set data = excluded.data, row_version = excluded.row_version,
       deleted_at = excluded.deleted_at
     where rows.pending = 0 and coalesce(rows.row_version, 0) < excluded.row_version`,
    [table, row.id, row.trip_id, JSON.stringify(row), row.row_version, row.deleted_at],
  );
}

export function applyPull(db: LocalDb, tripId: string, payload: PullPayload): number {
  let changed = 0;
  db.transaction(() => {
    if (payload.trip !== null) {
      db.run(
        `insert into trips (id, data, row_version, deleted_at) values (?, ?, ?, ?)
         on conflict (id) do update set data = excluded.data, row_version = excluded.row_version,
           deleted_at = excluded.deleted_at
         where trips.row_version < excluded.row_version`,
        [payload.trip.id, JSON.stringify(payload.trip), payload.trip.row_version, payload.trip.deleted_at],
      );
      changed++;
    }
    for (const [table, rows] of Object.entries(payload.tables)) {
      for (const row of rows) {
        upsertRow(db, table, row);
        changed++;
      }
    }
    db.run(
      `insert into sync_state (trip_id, version, plan_version, synced_at) values (?, ?, ?, ?)
       on conflict (trip_id) do update set version = max(sync_state.version, excluded.version),
         plan_version = max(sync_state.plan_version, excluded.plan_version), synced_at = excluded.synced_at`,
      [tripId, payload.version, payload.planVersion, new Date().toISOString()],
    );
  });
  return changed;
}

export type PullResult = { version: number; changed: number };

export async function pullChanges(db: LocalDb, remote: Remote, tripId: string): Promise<PullResult> {
  const since = localVersion(db, tripId);
  const payload = await remote.pull(tripId, since);
  if (payload === null) throw new Error(`Wyjazd ${tripId} jest niedostępny`);
  const changed = applyPull(db, tripId, payload);
  return { version: Math.max(since, payload.version), changed };
}

export type SyncResult = { flush: FlushResult; pull: PullResult | null };

/**
 * Po powrocie sieci: najpierw outbox, potem zmiany z serwera. W tej kolejności telefon dostaje
 * z powrotem własne wiersze już ze stemplem serwera.
 */
export async function syncTrip(db: LocalDb, remote: Remote, tripId: string, options: FlushOptions = {}): Promise<SyncResult> {
  const flush = await flushOutbox(db, remote, options);
  if (flush.error !== undefined) return { flush, pull: null };
  return { flush, pull: await pullChanges(db, remote, tripId) };
}

/**
 * Pobrania wywoływane przez Realtime idą jedno po drugim; kolejne sygnały w trakcie pobierania
 * zlewają się w jedno dodatkowe pobranie.
 */
export function serialPuller(run: () => Promise<unknown>, onError?: (error: unknown) => void): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const loop = async () => {
    do {
      again = false;
      try {
        await run();
      } catch (error) {
        onError?.(error);
      }
    } while (again);
    running = null;
  };
  return () => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  };
}
