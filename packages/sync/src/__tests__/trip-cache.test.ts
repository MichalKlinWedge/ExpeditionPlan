import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { removeItem, TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { rowsFromDocument } from '../document.ts';
import type { Remote, ServerRow, TripRow } from '../remote.ts';
import { cachedTrip, forgetLocal, refreshTrip } from '../trip-cache.ts';
import { uuidv7 } from '../uuid.ts';
import { nodeDb } from './helpers/node-db.ts';

const TRIP = 'trip-offline';
const load = (slug: string) =>
  TripDocument.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../fixtures/plans/${slug}/plan.json`, import.meta.url)), 'utf8')));

/** Serwer w pamięci z całym planem: każda zmiana podbija wersję jak trigger w bazie. */
function planServer(slug: string) {
  const rows = rowsFromDocument(load(slug), TRIP, uuidv7);
  let version = 1;
  let offline = false;
  const trip: TripRow = { ...rows.trip, id: TRIP, row_version: 1, deleted_at: null };
  const tables: Record<string, ServerRow[]> = Object.fromEntries(
    Object.entries(rows.tables).map(([table, list]) => [table, list.map((row) => ({ ...row, id: row.id as string, trip_id: TRIP, row_version: 1, deleted_at: null }))]),
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

  it('po zmianie konta na telefonie nie zostaje nic', async () => {
    const db = nodeDb();
    await refreshTrip(db, planServer('dinara').remote, TRIP);
    forgetLocal(db);
    expect(cachedTrip(db, TRIP)).toBeNull();
    expect(db.all('select 1 from rows')).toHaveLength(0);
  });
});
