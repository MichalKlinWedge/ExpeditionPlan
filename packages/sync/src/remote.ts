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
   * albo nadpisz (last-write-wins po stronie serwera).
   */
  push(table: OutboxTable, rows: Record<string, unknown>[]): Promise<void>;
}

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
      if (error) throw new RemoteError(error.message, error.code);
      return (data as PullPayload | null) ?? null;
    },
    async push(table, rows) {
      const { error } = await client
        .from(table)
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: table === 'schedule_events' });
      if (error) throw new RemoteError(error.message, error.code);
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
