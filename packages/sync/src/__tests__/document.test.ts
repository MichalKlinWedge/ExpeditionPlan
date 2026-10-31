import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { documentFromRows, rowsFromDocument } from '../document.ts';
import { uuidv7 } from '../uuid.ts';

const plansDir = fileURLToPath(new URL('../../../../fixtures/plans/', import.meta.url));
const slugs = readdirSync(plansDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const load = (slug: string) => TripDocument.parse(JSON.parse(readFileSync(`${plansDir}${slug}/plan.json`, 'utf8')));

/** Wiersze tak, jak wróciłyby z bazy: z kolumnami technicznymi i przez JSON (jak `pull_changes`). */
function asServer(rows: ReturnType<typeof rowsFromDocument>) {
  const stamp = (row: Record<string, unknown>) => ({ ...row, row_version: 1, deleted_at: null });
  const tables = Object.fromEntries(Object.entries(rows.tables).map(([table, list]) => [table, list.map(stamp)]));
  return JSON.parse(JSON.stringify({ trip: stamp(rows.trip), tables })) as { trip: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> };
}

const byRef = <T extends { ref: string }>(list: T[]) => [...list].sort((a, b) => a.ref.localeCompare(b.ref));

describe('dokument ↔ wiersze tabel (MVP-1)', () => {
  it('jest pięć planów wzorcowych', () => expect(slugs).toHaveLength(5));

  it.each(slugs)('%s: dokument → wiersze → dokument bez strat', (slug) => {
    const doc = load(slug);
    const server = asServer(rowsFromDocument(doc, uuidv7(), uuidv7));
    const back = documentFromRows(server.trip, server.tables);
    expect({ ...back, items: byRef(back.items) }).toEqual({ ...doc, items: byRef(doc.items) });
  });

  it('odwołania stają się kluczami obcymi, a noclegi z grupy kandydatów trafiają do osobnej kolumny', () => {
    const doc = load('maroko');
    const rows = rowsFromDocument(doc, uuidv7(), uuidv7);
    const ids = new Map(Object.values(rows.tables).flat().filter((row) => row.ref).map((row) => [row.ref as string, row.id as string]));
    const item = doc.items.find((each) => each.placeRef !== undefined)!;
    expect(rows.tables.items!.find((row) => row.ref === item.ref)!.place_id).toBe(ids.get(item.placeRef!));
    const day = doc.days.find((each) => each.lodgingRef !== undefined)!;
    const dayRow = rows.tables.days!.find((row) => row.ref === day.ref)!;
    const groupLodging = doc.variantGroups.some((group) => group.ref === day.lodgingRef);
    expect(dayRow[groupLodging ? 'lodging_group_id' : 'lodging_booking_id']).toBe(ids.get(day.lodgingRef!));
  });

  it('usunięty wiersz znika z dokumentu', () => {
    const doc = load('chatka');
    const server = asServer(rowsFromDocument(doc, uuidv7(), uuidv7));
    const pool = server.tables.items!.find((row) => row.day_id === undefined && !server.tables.items!.some((other) => other.parent_id === row.id));
    if (pool === undefined) return;
    pool.deleted_at = '2026-11-01T10:00:00Z';
    expect(documentFromRows(server.trip, server.tables).items.map((each) => each.ref)).not.toContain(pool.ref);
  });
});
