import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { removeItem, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { rowsFromDocument } from '../document.ts';
import type { Remote, ServerRow, TripRow } from '../remote.ts';
import { saveExpense, setPacked } from '../outbox.ts';
import { cachedTrip, forgetLocal, forgetTrip, pruneLocal, recordDayEvent, refreshTrip } from '../trip-cache.ts';
import { stableUuid, uuidv7 } from '../uuid.ts';
import { nodeDb } from './helpers/node-db.ts';

const TRIP = 'trip-offline';
const load = (slug: string) =>
  TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

/** Serwer w pamięci z całym planem: każda zmiana podbija wersję jak trigger w bazie. */
function planServer(slug: string, tripId = TRIP) {
  const rows = rowsFromDocument(load(slug), tripId, uuidv7);
  let version = 1;
  let offline = false;
  const trip: TripRow = { ...rows.trip, id: tripId, row_version: 1, deleted_at: null };
  const tables: Record<string, ServerRow[]> = Object.fromEntries(
    Object.entries(rows.tables).map(([table, list]) => [table, list.map((row) => ({ ...row, id: row.id as string, trip_id: tripId, row_version: 1, deleted_at: null }))]),
  );
  const remote: Remote = {
    async pull(_trip, since) {
      if (offline) throw new Error('fetch failed');
      const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
      return json({
        version,
        planVersion: version,
        trip: trip.row_version > since ? trip : null,
        tables: Object.fromEntries(Object.entries(tables).map(([table, list]) => [table, list.filter((row) => row.row_version > since)])),
      });
    },
    async push() {},
  };
  const change = (table: string, match: (row: ServerRow) => boolean, patch: Partial<ServerRow>) => {
    version++;
    const row = tables[table]!.find(match)!;
    Object.assign(row, patch, { row_version: version });
  };
  return { remote, change, setOffline: (value: boolean) => (offline = value) };
}

describe('plan offline na telefonie', () => {
  it('pierwsza synchronizacja zapisuje plan, potem dociąga tylko zmiany', async () => {
    const db = nodeDb();
    const server = planServer('maroko');
    expect(cachedTrip(db, TRIP)).toBeNull();

    const first = await refreshTrip(db, server.remote, TRIP);
    expect(first.changed).toBeGreaterThan(100);
    expect(first.state.doc.days.length).toBe(load('maroko').days.length);

    const again = await refreshTrip(db, server.remote, TRIP);
    expect(again.changed).toBe(0);

    const ref = first.state.doc.items.find((item) => item.dayRef !== undefined)!.ref;
    server.change('items', (row) => row.ref === ref, { title: 'Zmienione na webie' });
    const third = await refreshTrip(db, server.remote, TRIP);
    expect(third.changed).toBe(1);
    expect(third.state.doc.items.find((item) => item.ref === ref)?.title).toBe('Zmienione na webie');
  });

  it('bez sieci zostaje ostatni stan z godziną synchronizacji', async () => {
    const db = nodeDb();
    const server = planServer('dinara');
    const online = await refreshTrip(db, server.remote, TRIP);
    server.setOffline(true);

    await expect(refreshTrip(db, server.remote, TRIP)).rejects.toThrow('fetch failed');
    const offline = cachedTrip(db, TRIP)!;
    expect(offline.state.doc).toEqual(online.state.doc);
    expect(offline.syncedAt).toBe(online.syncedAt);
  });

  it('usunięty na webie punkt znika z planu na telefonie', async () => {
    const db = nodeDb();
    const server = planServer('maroko');
    const first = await refreshTrip(db, server.remote, TRIP);
    // Punkt, na który nic nie wskazuje — usunięcie innych edytor dopełnia zmianami w wariantach i źródłach.
    const free = first.state.doc.items.find((item) => {
      try {
        return (removeItem(first.state.doc, item.ref)?.others ?? []).length === 0;
      } catch {
        return false;
      }
    })!;
    server.change('items', (row) => row.ref === free.ref, { deleted_at: new Date().toISOString() });
    const after = await refreshTrip(db, server.remote, TRIP);
    expect(after.changed).toBe(1);
    expect(after.state.doc.items.some((item) => item.ref === free.ref)).toBe(false);
    expect(after.state.doc.items).toHaveLength(first.state.doc.items.length - 1);
  });

  it('„Zostajemy dłużej” i „Pomiń” offline: plan liczy się od razu, zdarzenia czekają w outboxie', async () => {
    const db = nodeDb();
    const server = planServer('maroko');
    await refreshTrip(db, server.remote, TRIP);
    server.setOffline(true);
    const before = cachedTrip(db, TRIP)!;
    const item = before.state.doc.items.find((each) => each.dayRef === 'd2' && each.parentRef === undefined)!;

    recordDayEvent(db, TRIP, before, 'd2', item.ref, { kind: 'delay', minutes: 30 });
    recordDayEvent(db, TRIP, before, 'd2', 'd2-bahia', { kind: 'skip' });
    const after = cachedTrip(db, TRIP)!;
    expect(after.state.inputs.delays).toEqual([{ itemRef: item.ref, minutes: 30 }]);
    expect(after.state.inputs.skipRefs).toEqual(['d2-bahia']);
    expect(after.pending).toBe(2);

    recordDayEvent(db, TRIP, after, 'd2', item.ref, { kind: 'delay', minutes: -30 });
    expect(cachedTrip(db, TRIP)!.state.inputs.delays.reduce((sum, each) => sum + each.minutes, 0)).toBe(0);
  });

  it('portfel i pakowanie offline: wydatek i odhaczenie od razu w stanie, ta sama para = ten sam wiersz', async () => {
    const db = nodeDb();
    const server = planServer('dinara');
    await refreshTrip(db, server.remote, TRIP);
    server.setOffline(true);

    saveExpense(db, { tripId: TRIP, amountMinor: 4500, currency: 'EUR', category: 'food' });
    const first = setPacked(db, TRIP, 'item-1', 'traveler-1', true);
    const again = setPacked(db, TRIP, 'item-1', 'traveler-1', false);
    const cached = cachedTrip(db, TRIP)!;

    expect(again).toBe(first);
    expect(cached.live.expenses).toHaveLength(1);
    expect(cached.live.packingChecks).toEqual([expect.objectContaining({ id: first, packed: false })]);
    expect(cached.live.travelers.length).toBe(cached.state.doc.travelers.length);
    expect(cached.pending).toBe(3);
  });

  it('stałe id: ta sama para daje to samo id, inna — inne, format UUID', () => {
    expect(stableUuid('a', 'b')).toBe(stableUuid('a', 'b'));
    expect(stableUuid('a', 'b')).not.toBe(stableUuid('a', 'c'));
    expect(stableUuid('a', 'b')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('po zmianie konta na telefonie nie zostaje nic', async () => {
    const db = nodeDb();
    await refreshTrip(db, planServer('dinara').remote, TRIP);
    forgetLocal(db);
    expect(cachedTrip(db, TRIP)).toBeNull();
    expect(db.all('select 1 from rows')).toHaveLength(0);
  });

  it('usunięty wyjazd znika z telefonu razem z zapisami w outboxie, inne zostają', async () => {
    const db = nodeDb();
    await refreshTrip(db, planServer('dinara').remote, TRIP);
    await refreshTrip(db, planServer('maroko', 'trip-drugi').remote, 'trip-drugi');
    saveExpense(db, { tripId: TRIP, amountMinor: 100, currency: 'EUR', category: 'food' });
    saveExpense(db, { tripId: 'trip-drugi', amountMinor: 200, currency: 'MAD', category: 'food' });

    forgetTrip(db, TRIP);
    expect(cachedTrip(db, TRIP)).toBeNull();
    expect(db.all('select 1 from rows where trip_id = ?', [TRIP])).toHaveLength(0);
    expect(cachedTrip(db, 'trip-drugi')!.live.expenses).toHaveLength(1);
    expect(db.all('select 1 from outbox')).toHaveLength(1);
  });

  it('wyjazdy spoza listy „moich wyjazdów” są czyszczone, pozostałe zostają', async () => {
    const db = nodeDb();
    await refreshTrip(db, planServer('dinara').remote, TRIP);
    await refreshTrip(db, planServer('maroko', 'trip-drugi').remote, 'trip-drugi');

    expect(pruneLocal(db, ['trip-drugi'])).toEqual([TRIP]);
    expect(cachedTrip(db, TRIP)).toBeNull();
    expect(cachedTrip(db, 'trip-drugi')).not.toBeNull();
    expect(pruneLocal(db, ['trip-drugi'])).toEqual([]);
  });
});
