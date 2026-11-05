/**
 * Lokalna baza telefonu (SQLite) widziana przez synchroniczny interfejs — w aplikacji to
 * expo-sqlite (`runSync`, `getAllSync`, `withTransactionSync`), w testach `node:sqlite`.
 * Synchroniczny, bo zapis zdarzenia i wpis do outboxa muszą być jedną transakcją, a `await`
 * w środku transakcji expo-sqlite wykonałby zapytanie dopiero po COMMIT (lekcja z FormaSync).
 */

export type SqlValue = string | number | null;

export interface LocalDb {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
}

/**
 * Wiersze serwera leżą w jednej tabeli `rows` (nazwa tabeli + id) jako JSON — telefon je tylko
 * czyta, a dokument składa `stateFromLocal`. Jedna tabela zamiast lustra każdej z tabel serwera:
 * schemat lokalny nie musi nadążać za migracjami.
 */

/** Tabele, do których telefon dopisuje przez outbox. */
export type OutboxTable = 'schedule_events' | 'expenses' | 'packing_checks' | 'expense_splits' | 'settlements' | 'journal_entries' | 'tasks' | 'packing_carriers';

const SCHEMA = `
create table if not exists trips (
  id text primary key,
  data text not null,
  row_version integer not null,
  deleted_at text
);
create table if not exists rows (
  tbl text not null,
  id text not null,
  trip_id text not null,
  data text not null,
  row_version integer,
  pending integer not null default 0,
  deleted_at text,
  primary key (tbl, id)
);
create index if not exists rows_trip on rows (trip_id, tbl);
create table if not exists sync_state (
  trip_id text primary key,
  version integer not null,
  plan_version integer not null,
  synced_at text not null
);
create table if not exists outbox (
  seq integer primary key autoincrement,
  tbl text not null,
  row_id text not null,
  payload text not null,
  created_at text not null,
  attempts integer not null default 0,
  last_error text
);
`;

export function migrateLocal(db: LocalDb): void {
  db.exec(SCHEMA);
}
