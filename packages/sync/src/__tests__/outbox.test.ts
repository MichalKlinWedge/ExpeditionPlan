import { describe, expect, it } from 'vitest';

import { flushOutbox, pendingCount, recordDelay, removeExpense, saveExpense, saveExpenseSplits } from '../outbox.ts';
import { applyPull, pullChanges, serialPuller, syncTrip } from '../pull.ts';
import { type PullPayload, type Remote, RemoteError, type ServerRow } from '../remote.ts';
import { uuidv7 } from '../uuid.ts';
import { nodeDb } from './helpers/node-db.ts';

const TRIP = 'trip-1';

/** Serwer w pamięci: stempluje wersje jak trigger `stamp_row_version` i pomija duplikaty zdarzeń. */
function fakeServer() {
  let version = 1;
  let offline = false;
  const tables = { schedule_events: new Map<string, ServerRow>(), expenses: new Map<string, ServerRow>() };
  const pushes: string[][] = [];
  const remote: Remote = {
    async pull(_trip, since) {
      if (offline) throw new Error('fetch failed');
      const newer = (table: Map<string, ServerRow>) => [...table.values()].filter((row) => row.row_version > since);
      return {
        version,
        planVersion: 1,
        trip: since === 0 ? { id: TRIP, row_version: 1, deleted_at: null } : null,
        tables: { schedule_events: newer(tables.schedule_events), expenses: newer(tables.expenses) },
      } satisfies PullPayload;
    },
    async push(table, rows) {
      if (offline) throw new Error('fetch failed');
      pushes.push(rows.map((row) => row.id as string));
      for (const row of rows) {
        if (table === 'schedule_events' && tables.schedule_events.has(row.id as string)) continue;
        version++;
        (tables as Record<string, Map<string, ServerRow>>)[table]!.set(row.id as string, { ...(row as ServerRow), row_version: version, deleted_at: (row.deleted_at as string | undefined) ?? null });
      }
    },
  };
  return { remote, tables, pushes, setOffline: (value: boolean) => (offline = value) };
}

describe('outbox', () => {
  it('zapis lokalny i wpis w outboxie powstają razem, wysyłka czyści kolejkę', async () => {
    const db = nodeDb();
    const server = fakeServer();
    recordDelay(db, TRIP, 'day-1', 'item-1', 30);
    saveExpense(db, { tripId: TRIP, amountMinor: 4500, currency: 'MAD' });

    expect(pendingCount(db)).toBe(2);
    expect(db.all("select id from rows where tbl = 'schedule_events' and pending = 1")).toHaveLength(1);

    const result = await flushOutbox(db, server.remote);

    expect(result).toEqual({ sent: 2, remaining: 0 });
    expect(server.pushes).toHaveLength(2); // dwie tabele = dwie partie, w kolejności zapisu
    expect(db.all("select id from rows where tbl = 'schedule_events' and pending = 1")).toHaveLength(0);
  });

  it('bez sieci wpisy zostają w kolejce razem z błędem', async () => {
    const db = nodeDb();
    const server = fakeServer();
    server.setOffline(true);
    recordDelay(db, TRIP, 'day-1', 'item-1', 15);

    const result = await flushOutbox(db, server.remote);

    expect(result.remaining).toBe(1);
    expect(result.error).toBe('fetch failed');
    expect(db.all<{ attempts: number }>('select attempts from outbox')[0]?.attempts).toBe(1);
  });

  it('awaria po wysłaniu, a przed potwierdzeniem lokalnym, nie dubluje wierszy', async () => {
    const db = nodeDb();
    const server = fakeServer();
    for (let i = 0; i < 3; i++) recordDelay(db, TRIP, 'day-1', `item-${i}`, 10);
    saveExpense(db, { tripId: TRIP, amountMinor: 100, currency: 'MAD' });

    await expect(
      flushOutbox(db, server.remote, {
        batchSize: 2,
        afterSend: () => {
          throw new Error('zabita aplikacja');
        },
      }),
    ).rejects.toThrow('zabita aplikacja');
    expect(pendingCount(db)).toBe(4);

    await flushOutbox(db, server.remote);

    expect(server.tables.schedule_events.size).toBe(3);
    expect(server.tables.expenses.size).toBe(1);
    expect(pendingCount(db)).toBe(0);
  });

  it('wydatek poprawiony offline kilka razy idzie na serwer raz, w ostatniej wersji', async () => {
    const db = nodeDb();
    const server = fakeServer();
    const id = saveExpense(db, { tripId: TRIP, amountMinor: 100, currency: 'MAD' });
    saveExpense(db, { tripId: TRIP, id, amountMinor: 250, currency: 'MAD', note: 'z napiwkiem' });

    await flushOutbox(db, server.remote);

    expect(server.pushes).toEqual([[id]]);
    expect(server.tables.expenses.get(id)?.amount_minor).toBe(250);
  });

  it('podział wydatku: wybrani aktywni, odznaczeni usunięci, wszyscy = brak podziału', () => {
    const db = nodeDb();
    const id = saveExpense(db, { tripId: TRIP, amountMinor: 100, currency: 'MAD' });
    const alive = () =>
      db.all<{ data: string }>("select data from rows where tbl = 'expense_splits'").map((row) => JSON.parse(row.data) as { traveler_id: string; deleted_at: string | null }).filter((row) => row.deleted_at === null).map((row) => row.traveler_id).sort();
    saveExpenseSplits(db, TRIP, id, ['a', 'b'], ['a', 'b', 'c']);
    expect(alive()).toEqual(['a', 'b']);
    saveExpenseSplits(db, TRIP, id, ['a'], ['a', 'b', 'c']);
    expect(alive()).toEqual(['a']);
    saveExpenseSplits(db, TRIP, id, ['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(alive()).toEqual([]);
  });

  it('usunięty offline wydatek znika z telefonu od razu, a na serwer idzie jako miękkie usunięcie', async () => {
    const db = nodeDb();
    const server = fakeServer();
    const expense = { tripId: TRIP, amountMinor: 100, currency: 'MAD', note: 'pomyłka' };
    const id = saveExpense(db, expense);
    removeExpense(db, { ...expense, id });
    const local = db.all<{ data: string }>("select data from rows where tbl = 'expenses' and id = ?", [id])[0]!;
    expect(JSON.parse(local.data).deleted_at).not.toBeNull();

    await flushOutbox(db, server.remote);

    expect(server.pushes).toEqual([[id]]);
    expect(server.tables.expenses.get(id)?.deleted_at).not.toBeNull();
  });
});

describe('pobieranie zmian', () => {
  it('po wysyłce telefon dostaje własne wiersze ze stemplem serwera', async () => {
    const db = nodeDb();
    const server = fakeServer();
    recordDelay(db, TRIP, 'day-1', 'item-1', 30);

    const result = await syncTrip(db, server.remote, TRIP);

    expect(result.pull?.version).toBe(2);
    expect(db.all<{ row_version: number }>("select row_version from rows where tbl = 'schedule_events'")[0]?.row_version).toBe(2);
    const second = await pullChanges(db, server.remote, TRIP);
    expect(second.changed).toBe(0);
  });

  it('starsze pobranie nie nadpisze nowszego, a wiersz czekający w outboxie zostaje lokalny', () => {
    const db = nodeDb();
    const row = (version: number, amount: number): ServerRow => ({
      id: 'x1',
      trip_id: TRIP,
      row_version: version,
      deleted_at: null,
      amount_minor: amount,
    });
    const payload = (version: number, expenses: ServerRow[]): PullPayload => ({
      version,
      planVersion: 1,
      trip: null,
      tables: { expenses },
    });
    const amount = () => JSON.parse(db.all<{ data: string }>("select data from rows where tbl = 'expenses'")[0]!.data).amount_minor;

    applyPull(db, TRIP, payload(8, [row(8, 800)]));
    applyPull(db, TRIP, payload(7, [row(7, 700)]));
    expect(amount()).toBe(800);
    expect(db.all<{ version: number }>('select version from sync_state')[0]?.version).toBe(8);

    saveExpense(db, { tripId: TRIP, id: 'x1', amountMinor: 999, currency: 'MAD' });
    applyPull(db, TRIP, payload(9, [row(9, 900)]));
    expect(amount()).toBe(999);
  });

  it('sygnały Realtime w trakcie pobierania zlewają się w jedno dodatkowe pobranie', async () => {
    let runs = 0;
    let release: () => void = () => {};
    const pull = serialPuller(
      () =>
        new Promise<void>((resolve) => {
          runs++;
          release = resolve;
        }),
    );
    const first = pull();
    pull();
    pull();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await first;

    expect(runs).toBe(2);
  });
});

describe('uuidv7', () => {
  it('ma wersję 7 i rośnie z czasem', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('outbox: zapis odrzucony przez serwer', () => {
  it('nie blokuje kolejki — wycofany z telefonu, reszta partii i kolejne zapisy przechodzą', async () => {
    const db = nodeDb();
    const server = fakeServer();
    const push = server.remote.push.bind(server.remote);
    let refuse = '';
    server.remote.push = async (table, rows) => {
      if (rows.some((row) => row.id === refuse)) throw new RemoteError('new row violates row-level security policy', '42501');
      await push(table, rows);
    };
    recordDelay(db, TRIP, 'day-1', 'item-1', 15);
    refuse = recordDelay(db, TRIP, 'day-1', 'item-2', 30);
    recordDelay(db, TRIP, 'day-1', 'item-3', 45);

    const result = await flushOutbox(db, server.remote);

    expect(result.remaining).toBe(0);
    expect(result.rejected).toEqual([{ table: 'schedule_events', id: refuse, error: 'new row violates row-level security policy' }]);
    expect(server.tables.schedule_events.size).toBe(2);
    expect(db.all('select id from rows where id = ?', [refuse])).toHaveLength(0);

    recordDelay(db, TRIP, 'day-1', 'item-4', 5);
    expect(await flushOutbox(db, server.remote)).toEqual({ sent: 1, remaining: 0 });
  });

  it('brak sieci to nie odrzucenie — wpis czeka w kolejce', async () => {
    const db = nodeDb();
    const server = fakeServer();
    recordDelay(db, TRIP, 'day-1', 'item-1', 15);
    server.setOffline(true);
    const result = await flushOutbox(db, server.remote);
    expect(result).toMatchObject({ sent: 0, remaining: 1, error: 'fetch failed' });
    expect(result.rejected).toBeUndefined();
  });
});
