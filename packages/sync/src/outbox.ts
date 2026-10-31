import type { LocalDb, OutboxTable } from './local-db.ts';
import type { Remote } from './remote.ts';
import { uuidv7 } from './uuid.ts';

/**
 * Zapisy z telefonu (SPECYFIKACJA §6): wiersz lokalny i wpis w outboxie powstają w jednej
 * transakcji SQLite, a wysyłka jest idempotentna (id z klienta + upsert). Dzięki temu przerwanie
 * w dowolnym miejscu — brak sieci, zabicie aplikacji po wysłaniu, a przed potwierdzeniem
 * lokalnym — kończy się co najwyżej ponowną wysyłką tego samego wiersza, nigdy duplikatem.
 */

type EventKind = 'delay' | 'skip' | 'done' | 'choose_variant' | 'pull_from_pool';

export type NewScheduleEvent = {
  tripId: string;
  dayId?: string | null;
  itemId?: string | null;
  kind: EventKind;
  minutes?: number | null;
  payload?: Record<string, unknown>;
  deviceId?: string | null;
  occurredAt?: string;
};

export type NewExpense = {
  tripId: string;
  id?: string;
  amountMinor: number;
  currency: string;
  category?: string;
  payerRef?: string | null;
  itemId?: string | null;
  note?: string | null;
  paidAt?: string;
};

function enqueue(db: LocalDb, table: OutboxTable, row: Record<string, unknown> & { id: string; trip_id: string }) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `insert into ${table} (id, trip_id, data, row_version, pending, deleted_at) values (?, ?, ?, null, 1, null)
       on conflict (id) do update set data = excluded.data, pending = 1`,
      [row.id, row.trip_id, JSON.stringify(row)],
    );
    db.run('insert into outbox (tbl, row_id, payload, created_at) values (?, ?, ?, ?)', [
      table,
      row.id,
      JSON.stringify(row),
      now,
    ]);
  });
}

export function recordEvent(db: LocalDb, event: NewScheduleEvent): string {
  const id = uuidv7();
  enqueue(db, 'schedule_events', {
    id,
    trip_id: event.tripId,
    day_id: event.dayId ?? null,
    item_id: event.itemId ?? null,
    kind: event.kind,
    minutes: event.minutes ?? null,
    payload: event.payload ?? {},
    device_id: event.deviceId ?? null,
    occurred_at: event.occurredAt ?? new Date().toISOString(),
  });
  return id;
}

/** „Zostajemy dłużej” — opóźnienie punktu o `minutes`. */
export function recordDelay(db: LocalDb, tripId: string, dayId: string, itemId: string, minutes: number): string {
  return recordEvent(db, { tripId, dayId, itemId, kind: 'delay', minutes });
}

/** Nowy wydatek albo poprawka istniejącego (ten sam `id`). */
export function saveExpense(db: LocalDb, expense: NewExpense): string {
  const id = expense.id ?? uuidv7();
  enqueue(db, 'expenses', {
    id,
    trip_id: expense.tripId,
    amount_minor: expense.amountMinor,
    currency: expense.currency,
    category: expense.category ?? 'other',
    payer_ref: expense.payerRef ?? null,
    item_id: expense.itemId ?? null,
    note: expense.note ?? null,
    paid_at: expense.paidAt ?? new Date().toISOString(),
  });
  return id;
}

export function pendingCount(db: LocalDb): number {
  return db.all<{ n: number }>('select count(*) as n from outbox')[0]?.n ?? 0;
}

export type FlushOptions = {
  batchSize?: number;
  /**
   * Wywoływane po udanej wysyłce partii, a przed potwierdzeniem jej w SQLite — w testach
   * symuluje zabicie aplikacji dokładnie w najgorszym momencie.
   */
  afterSend?: (sent: number) => void;
};

export type FlushResult = { sent: number; remaining: number; error?: string };

type OutboxRow = { seq: number; tbl: OutboxTable; row_id: string; payload: string };

/**
 * Wysyła outbox w kolejności zapisu, partiami z jednej tabeli. Błąd sieci albo serwera zatrzymuje
 * wysyłkę (kolejność ma znaczenie), a wpisy zostają do następnej próby.
 */
export async function flushOutbox(db: LocalDb, remote: Remote, options: FlushOptions = {}): Promise<FlushResult> {
  const batchSize = options.batchSize ?? 100;
  let sent = 0;

  for (;;) {
    const head = db.all<OutboxRow>('select seq, tbl, row_id, payload from outbox order by seq limit ?', [batchSize]);
    if (head.length === 0) break;
    const table = head[0]!.tbl;
    const end = head.findIndex((row) => row.tbl !== table);
    const batch = end === -1 ? head : head.slice(0, end);
    // Ten sam wiersz poprawiony kilka razy offline: wysyłamy tylko ostatnią wersję.
    const latest = new Map(batch.map((row) => [row.row_id, JSON.parse(row.payload) as Record<string, unknown>]));

    try {
      await remote.push(table, [...latest.values()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.run('update outbox set attempts = attempts + 1, last_error = ? where seq = ?', [message, batch[0]!.seq]);
      return { sent, remaining: pendingCount(db), error: message };
    }

    sent += batch.length;
    options.afterSend?.(sent);

    const lastSeq = batch[batch.length - 1]!.seq;
    db.transaction(() => {
      db.run('delete from outbox where seq <= ?', [lastSeq]);
      for (const id of latest.keys()) {
        // Wiersz zostaje „oczekujący”, jeśli po tej partii poprawiono go jeszcze raz.
        db.run(`update ${table} set pending = 0 where id = ? and not exists (select 1 from outbox where row_id = ?)`, [
          id,
          id,
        ]);
      }
    });
  }

  return { sent, remaining: 0 };
}
