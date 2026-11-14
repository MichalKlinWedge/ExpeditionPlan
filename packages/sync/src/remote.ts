import type { SupabaseClient } from '@supabase/supabase-js';

import type { OutboxTable } from './local-db.ts';

/** Wiersz tabeli wyjazdu tak, jak zwraca go `pull_changes` (kolumny snake_case). */
export type ServerRow = {
  id: string;
  trip_id: string;
  row_version: number;
  deleted_at: string | null;
  [column: string]: unknown;
};

export type TripRow = {
  id: string;
  row_version: number;
  deleted_at: string | null;
  [column: string]: unknown;
};

export type PullPayload = {
  version: number;
  planVersion: number;
  trip: TripRow | null;
  /** Zmienione wiersze po nazwie tabeli (`synced_tables()` w migracji `mvp1_access`). */
  tables: Record<string, ServerRow[]>;
};

/** To, czego synchronizacja potrzebuje od serwera; w testach jednostkowych łatwe do podmiany. */
export interface Remote {
  /** `null` = wyjazdu nie ma albo użytkownik nie ma do niego dostępu. */
  pull(tripId: string, since: number): Promise<PullPayload | null>;
  /**
   * Idempotentny zapis wierszy z outboxa. Zdarzenia dnia: wstaw, duplikat pomiń. Wydatki: wstaw
   * albo nadpisz (last-write-wins po stronie serwera). Zadania: tylko zmiana statusu istniejącego wiersza.
   */
  push(table: OutboxTable, rows: Record<string, unknown>[]): Promise<void>;
}

const OWN_ERROR_CODES = new Set(['P0001', 'P0002', 'EP001', '22023']);

/**
 * Komunikat błędu bazy dla użytkownika. Nasze funkcje SQL rzucają własne, polskie komunikaty (te
 * przechodzą); odmowa RLS to „brak uprawnień”, a reszta to angielski tekst techniczny, więc
 * użytkownik dostaje `fallback`, a szczegóły idą do logu.
 */
export function dbErrorMessage(error: { message: string; code?: string | undefined }, fallback = 'Nie udało się wykonać tej operacji. Spróbuj jeszcze raz.'): string {
  if (error.code === '42501') return /row-level security|permission denied/i.test(error.message) ? 'Brak uprawnień do tej zmiany.' : error.message;
  if (error.code !== undefined && OWN_ERROR_CODES.has(error.code)) return error.message;
  if (/fetch failed|failed to fetch|network request failed/i.test(error.message)) return 'Brak połączenia z serwerem. Sprawdź internet.';
  console.warn(error);
  return fallback;
}

/** Błąd odczytu na stronie. */
export const dbLoadError = (error: { message: string; code?: string | undefined }): string => dbErrorMessage(error, 'Nie udało się wczytać danych. Odśwież stronę.');

export class RemoteError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = 'RemoteError';
    this.code = code;
  }
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async pull(tripId, since) {
      const { data, error } = await client.rpc('pull_changes', { p_trip: tripId, p_since: since });
      if (error) throw new RemoteError(dbErrorMessage(error), error.code);
      return (data as PullPayload | null) ?? null;
    },
    async push(table, rows) {
      if (table === 'tasks') {
        for (const row of rows) {
          // Tylko pola z outboxa (status, przypomnienie) — reszta wiersza zostaje taka, jak na serwerze.
          const patch = Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'id' && column !== 'trip_id'));
          const { data, error } = await client.from('tasks').update(patch).eq('id', row.id).eq('trip_id', row.trip_id).select('id');
          if (error) throw new RemoteError(dbErrorMessage(error), error.code);
          // RLS po cichu pomija wiersz, którego nie wolno zmienić — dla outboxa to odmowa, nie sukces.
          if ((data ?? []).length === 0) {
            const only = Object.keys(patch).length === 1 && patch.status !== undefined;
            throw new RemoteError(only ? 'Brak uprawnień do odhaczenia tego zadania' : 'Brak uprawnień do zmiany tego zadania', '42501');
          }
        }
        return;
      }
      const { error } = await client
        .from(table)
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: table === 'schedule_events' });
      if (error) throw new RemoteError(dbErrorMessage(error), error.code);
    },
  };
}

/**
 * Telefon słucha jednego wiersza — swojego wyjazdu. Każda zmiana w wyjeździe podbija jego
 * `sync_version`, a odpowiedzią jest pobranie przyrostowe, nie stosowanie payloadu z Realtime.
 *
 * `onChange` przychodzi też wtedy, gdy subskrypcja zmian Postgresa jest gotowa (także po
 * ponownym połączeniu): zmiany z czasu bez nasłuchu wyłapuje to dodatkowe pobranie. Bez niego
 * pierwszy sygnał po zimnym starcie Realtime potrafi przepaść (widać to w PoC-4).
 */
export function watchTrip(
  client: SupabaseClient,
  tripId: string,
  onChange: () => void,
  onStatus?: (status: string) => void,
): () => Promise<void> {
  const channel = client
    .channel(`trip:${tripId}`)
    .on('system', {}, (payload: { extension?: string; status?: string }) => {
      if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
        onStatus?.('READY');
        onChange();
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, () =>
      onChange(),
    )
    .subscribe((status) => onStatus?.(status));
  return async () => {
    await client.removeChannel(channel);
  };
}
