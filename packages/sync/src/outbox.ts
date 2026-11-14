import type { LocalDb, OutboxTable } from './local-db.ts';
import { type Remote, RemoteError } from './remote.ts';
import { stableUuid, uuidv7 } from './uuid.ts';

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
  payerTravelerId?: string | null;
  itemId?: string | null;
  note?: string | null;
  paidAt?: string;
  /** Zdjęcie paragonu w buckecie `journal` (`<trip>/receipt-<id>/paragon.<ext>`). */
  receiptPath?: string | null;
};

function enqueue(db: LocalDb, table: OutboxTable, row: Record<string, unknown> & { id: string; trip_id: string }) {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(
      `insert into rows (tbl, id, trip_id, data, row_version, pending, deleted_at) values (?, ?, ?, ?, null, 1, null)
       on conflict (tbl, id) do update set data = excluded.data, pending = 1`,
      [table, row.id, row.trip_id, JSON.stringify(row)],
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

const expenseRow = (id: string, expense: NewExpense) => ({
  id,
  trip_id: expense.tripId,
  amount_minor: expense.amountMinor,
  currency: expense.currency,
  category: expense.category ?? 'other',
  payer_traveler_id: expense.payerTravelerId ?? null,
  item_id: expense.itemId ?? null,
  note: expense.note ?? null,
  paid_at: expense.paidAt ?? new Date().toISOString(),
  // Tylko z paragonem — wydatek bez zdjęcia nie zależy od kolumny (telefon przed migracją w chmurze).
  ...(expense.receiptPath ? { receipt_path: expense.receiptPath } : {}),
});

/** Nowy wydatek albo poprawka istniejącego (ten sam `id`). */
export function saveExpense(db: LocalDb, expense: NewExpense): string {
  const id = expense.id ?? uuidv7();
  enqueue(db, 'expenses', expenseRow(id, expense));
  return id;
}

/**
 * Usunięcie wydatku — miękkie (`deleted_at`), przez outbox, więc działa bez sieci. Telefon od razu
 * przestaje go liczyć (`cachedTrip` pomija wiersze z `deleted_at`). Prawo: RLS `expenses_update`.
 */
export function removeExpense(db: LocalDb, expense: NewExpense & { id: string }): void {
  enqueue(db, 'expenses', { ...expenseRow(expense.id, expense), deleted_at: new Date().toISOString() });
}

/**
 * Na kogo dzieli się wydatek (`expense_splits`). Id stałe dla pary wydatek + uczestnik, więc
 * zmiana wyboru poprawia te same wiersze: wybrani — aktywni, odznaczeni — `deleted_at`.
 * Wszyscy uczestnicy = brak podziału (domyślnie równo na wszystkich), wiersze usunięte.
 */
export function saveExpenseSplits(db: LocalDb, tripId: string, expenseId: string, chosen: readonly string[], everyone: readonly string[]): void {
  const exists = (id: string) => db.all('select 1 from rows where tbl = ? and id = ?', ['expense_splits', id]).length > 0;
  for (const row of expenseSplitRows(tripId, expenseId, chosen, everyone, exists)) enqueue(db, 'expense_splits', row);
}

/**
 * Wiersze podziału wydatku do zapisu, wspólne dla telefonu i weba (ten sam stały id dla pary
 * wydatek + uczestnik): wybrani aktywni, reszta miękko usunięta. Wszyscy wybrani = brak podziału.
 */
export function expenseSplitRows(tripId: string, expenseId: string, chosen: readonly string[], everyone: readonly string[], exists: (id: string) => boolean) {
  const all = chosen.length === 0 || everyone.every((id) => chosen.includes(id));
  const now = new Date().toISOString();
  return everyone.flatMap((travelerId) => {
    const id = stableUuid('split', expenseId, travelerId);
    const active = !all && chosen.includes(travelerId);
    return !active && !exists(id) ? [] : [{ id, trip_id: tripId, expense_id: expenseId, traveler_id: travelerId, weight: 1, deleted_at: active ? null : now }];
  });
}

export type JournalEntry = {
  id?: string;
  tripId: string;
  dayId?: string | null;
  itemId?: string | null;
  body: string;
  /** Ścieżka w buckecie `journal`: `<trip_id>/<entry_id>/<plik>` — plik wysyła się osobno. */
  photoPath?: string | null;
  takenAt?: string;
};

const journalRow = (id: string, entry: JournalEntry) => ({
  id,
  trip_id: entry.tripId,
  day_id: entry.dayId ?? null,
  item_id: entry.itemId ?? null,
  body: entry.body,
  photo_path: entry.photoPath ?? null,
  taken_at: entry.takenAt ?? new Date().toISOString(),
});

/** Wpis dziennika (nowy albo poprawiony) — offline, przez outbox. Prawo: RLS `journal_insert` / `journal_update`. */
export function saveJournalEntry(db: LocalDb, entry: JournalEntry): string {
  const id = entry.id ?? uuidv7();
  enqueue(db, 'journal_entries', journalRow(id, entry));
  return id;
}

/** Usunięcie wpisu — miękkie (`deleted_at`). Plik zdjęcia zostaje w buckecie (bez twardych usunięć). */
export function removeJournalEntry(db: LocalDb, entry: JournalEntry & { id: string }): void {
  enqueue(db, 'journal_entries', { ...journalRow(entry.id, entry), deleted_at: new Date().toISOString() });
}

/** Wykonany przelew rozliczenia („Kuba oddał Ani 120 zł”) — pomniejsza saldo w `settle`. */
export function recordSettlement(db: LocalDb, payment: { tripId: string; fromId: string; toId: string; amountMinor: number; currency: string }): string {
  const id = uuidv7();
  enqueue(db, 'settlements', {
    id,
    trip_id: payment.tripId,
    from_traveler_id: payment.fromId,
    to_traveler_id: payment.toId,
    amount_minor: payment.amountMinor,
    currency: payment.currency,
    settled_at: new Date().toISOString(),
  });
  return id;
}

/**
 * Odhaczenie pozycji pakowania dla uczestnika (albo cofnięcie). Id stałe dla pary pozycja +
 * uczestnik, więc kolejne kliknięcia poprawiają ten sam wiersz (outbox wyśle ostatni stan).
 */
export function setPacked(db: LocalDb, tripId: string, packingItemId: string, travelerId: string, packed: boolean): string {
  const id = stableUuid('packing', packingItemId, travelerId);
  enqueue(db, 'packing_checks', {
    id,
    trip_id: tripId,
    packing_item_id: packingItemId,
    traveler_id: travelerId,
    packed,
    checked_at: new Date().toISOString(),
  });
  return id;
}

/**
 * Wiersz „kto bierze” rzecz wspólną. Id stałe dla pary rzecz + uczestnik, jak przy odhaczaniu:
 * web i telefony poprawiają ten sam wiersz. `quantity = 0` to „nie biorę”.
 */
export const carrierRow = (tripId: string, packingItemId: string, travelerId: string, quantity: number) => ({
  id: stableUuid('carrier', packingItemId, travelerId),
  trip_id: tripId,
  packing_item_id: packingItemId,
  traveler_id: travelerId,
  quantity,
});

/** „Biorę” / „nie biorę” na telefonie, także offline. Prawo: RLS `packing_carriers`, jak przy odhaczaniu. */
export function setCarrying(db: LocalDb, tripId: string, packingItemId: string, travelerId: string, quantity: number): string {
  const row = carrierRow(tripId, packingItemId, travelerId, quantity);
  enqueue(db, 'packing_carriers', row);
  return row.id;
}

/**
 * Głos uczestnika: na wariant w grupie (`variantId` = null — „wszystko mi jedno”) albo dostępność w jednym dniu
 * ankiety terminu. Id stałe dla pary osoba + grupa (albo osoba + dzień), więc web i telefony poprawiają ten sam
 * wiersz; `withdrawn` cofa głos (`deleted_at`, bez twardych usunięć). Prawa: RLS `trip_votes`.
 */
export type VoteChoice = { groupId: string; variantId: string | null } | { day: string; answer: 'yes' | 'maybe' | 'no' };

export function voteRow(tripId: string, travelerId: string, choice: VoteChoice, withdrawn = false) {
  const own: { variant_group_id: string | null; variant_id: string | null; day: string | null; answer: string | null } = 'groupId' in choice ? { variant_group_id: choice.groupId, variant_id: choice.variantId, day: null, answer: null } : { variant_group_id: null, variant_id: null, day: choice.day, answer: choice.answer };
  return {
    id: 'groupId' in choice ? stableUuid('vote', choice.groupId, travelerId) : stableUuid('vote-day', choice.day, travelerId),
    trip_id: tripId,
    traveler_id: travelerId,
    ...own,
    deleted_at: withdrawn ? new Date().toISOString() : null,
  };
}

/** Głos z telefonu, także offline. */
export function setVote(db: LocalDb, tripId: string, travelerId: string, choice: VoteChoice, withdrawn = false): string {
  const row = voteRow(tripId, travelerId, choice, withdrawn);
  enqueue(db, 'trip_votes', row);
  return row.id;
}

/**
 * Odhaczenie zadania z planu (albo cofnięcie) — offline. Zadanie jest wierszem planu, więc na serwer
 * idzie sama zmiana statusu (`supabaseRemote`: update, nie upsert całego wiersza) — nie nadpisze
 * zmian z webu, a widz i tak może zmienić tylko status (trigger `guard_viewer_task`). Wiersz
 * w SQLite dostaje nowy status od razu i czeka (`pending`) na potwierdzenie z serwera.
 */
export function setTaskStatus(db: LocalDb, tripId: string, taskId: string, status: 'open' | 'done'): void {
  updateTask(db, tripId, taskId, { status });
}

/**
 * Zmiana pól zadania z telefonu — tych samych kolumn, co `setTaskStatus`, i przypomnienia
 * (`remind_at`, `null` = bez własnego przypomnienia). Zmianę inną niż status przyjmie tylko
 * organizator i edytor (trigger `guard_viewer_task`), więc widzowi serwer ją odrzuci.
 */
export function updateTask(db: LocalDb, tripId: string, taskId: string, patch: Record<string, unknown>): void {
  const local = db.all<{ data: string }>('select data from rows where tbl = ? and id = ?', ['tasks', taskId])[0];
  if (local === undefined) throw new Error('Tego zadania nie ma w bazie telefonu — odśwież plan');
  const row = { ...(JSON.parse(local.data) as Record<string, unknown>), ...patch };
  db.transaction(() => {
    db.run('update rows set data = ?, pending = 1 where tbl = ? and id = ?', [JSON.stringify(row), 'tasks', taskId]);
    db.run('insert into outbox (tbl, row_id, payload, created_at) values (?, ?, ?, ?)', [
      'tasks',
      taskId,
      JSON.stringify({ id: taskId, trip_id: tripId, ...patch }),
      new Date().toISOString(),
    ]);
  });
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

/** Zapis, którego serwer nie przyjmie (brak uprawnień, naruszone ograniczenie) — wycofany z telefonu. */
export type RejectedWrite = { table: OutboxTable; id: string; error: string };

export type FlushResult = { sent: number; remaining: number; error?: string; rejected?: RejectedWrite[] };

/** Błąd, którego ponowienie nic nie zmieni: uprawnienia (42…), ograniczenia (23…), dane (22…). */
function isPermanent(error: unknown): boolean {
  return error instanceof RemoteError && /^(42|23|22)/.test(error.code ?? '');
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type OutboxRow = { seq: number; tbl: OutboxTable; row_id: string; payload: string };

/**
 * Wysyła outbox w kolejności zapisu, partiami z jednej tabeli. Błąd sieci albo serwera zatrzymuje
 * wysyłkę (kolejność ma znaczenie), a wpisy zostają do następnej próby.
 */
export async function flushOutbox(db: LocalDb, remote: Remote, options: FlushOptions = {}): Promise<FlushResult> {
  const batchSize = options.batchSize ?? 100;
  let sent = 0;
  const rejected: RejectedWrite[] = [];
  const result = (remaining: number, error?: string): FlushResult => ({
    sent,
    remaining,
    ...(error === undefined ? {} : { error }),
    ...(rejected.length === 0 ? {} : { rejected }),
  });

  for (;;) {
    const head = db.all<OutboxRow>('select seq, tbl, row_id, payload from outbox order by seq limit ?', [batchSize]);
    if (head.length === 0) break;
    const table = head[0]!.tbl;
    const end = head.findIndex((row) => row.tbl !== table);
    const batch = end === -1 ? head : head.slice(0, end);
    // Ten sam wiersz poprawiony kilka razy offline: wysyłamy tylko ostatnią wersję.
    const latest = new Map(batch.map((row) => [row.row_id, JSON.parse(row.payload) as Record<string, unknown>]));

    const refused = new Map<string, string>();
    try {
      await remote.push(table, [...latest.values()]);
    } catch (error) {
      if (!isPermanent(error)) {
        db.run('update outbox set attempts = attempts + 1, last_error = ? where seq = ?', [messageOf(error), batch[0]!.seq]);
        return result(pendingCount(db), messageOf(error));
      }
      // Serwer odrzucił partię na stałe: wiersz po wierszu, żeby wycofać tylko te nie do przyjęcia.
      // Bez tego jeden zły zapis (np. widz odhacza cudzą rzecz) blokowałby kolejkę na zawsze.
      for (const [id, row] of latest) {
        try {
          await remote.push(table, [row]);
        } catch (each) {
          if (!isPermanent(each)) {
            db.run('update outbox set attempts = attempts + 1, last_error = ? where seq = ?', [messageOf(each), batch[0]!.seq]);
            return result(pendingCount(db), messageOf(each));
          }
          refused.set(id, messageOf(each));
        }
      }
    }

    sent += batch.length - refused.size;
    options.afterSend?.(sent);

    const lastSeq = batch[batch.length - 1]!.seq;
    db.transaction(() => {
      db.run('delete from outbox where seq <= ?', [lastSeq]);
      for (const [id, error] of refused) {
        // Wiersz z telefonu znika; jeśli nadpisał wiersz z serwera, pełne pobranie przywróci oryginał.
        const local = db.all<{ trip_id: string; row_version: number | null }>('select trip_id, row_version from rows where tbl = ? and id = ?', [table, id])[0];
        db.run('delete from rows where tbl = ? and id = ? and not exists (select 1 from outbox where row_id = ?)', [table, id, id]);
        if (local?.row_version != null) db.run('update sync_state set version = 0 where trip_id = ?', [local.trip_id]);
        rejected.push({ table, id, error });
      }
      for (const id of latest.keys()) {
        if (refused.has(id)) continue;
        // Wiersz zostaje „oczekujący”, jeśli po tej partii poprawiono go jeszcze raz.
        db.run('update rows set pending = 0 where tbl = ? and id = ? and not exists (select 1 from outbox where row_id = ?)', [
          table,
          id,
          id,
        ]);
      }
    });
  }

  return result(0);
}
