import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { type LocalDb, migrateLocal } from '../../local-db.ts';

/** SQLite z Node w roli expo-sqlite — ten sam synchroniczny interfejs, plik albo pamięć. */
export function nodeDb(path = ':memory:'): LocalDb & { close(): void } {
  const db = new DatabaseSync(path);
  const local: LocalDb & { close(): void } = {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },
    all: <T>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as SQLInputValue[])) as T[],
    transaction<T>(fn: () => T): T {
      db.exec('begin immediate');
      try {
        const result = fn();
        db.exec('commit');
        return result;
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
    close: () => db.close(),
  };
  migrateLocal(local);
  return local;
}
