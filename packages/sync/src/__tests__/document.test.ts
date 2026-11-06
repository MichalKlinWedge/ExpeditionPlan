import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TripDocument } from '@expeditionplan/core';
import { describe, expect, it } from 'vitest';

import { type Collection, COLLECTIONS, documentFromRows, refIndex, rowForUpdate, rowsFromDocument } from '../document.ts';
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

  it('dane lokalu przy miejscu przechodzą przez wiersze', () => {
    const doc = load(slugs[0]!);
    const venue = { description: 'Mała pizzeria.', prices: [{ name: 'Margherita', currency: 'PLN', minMinor: 3200, maxMinor: 3200 }], rating: { value: 4.6, scale: 5 }, readOn: '2026-11-05' };
    const ref = doc.places[0]!.ref;
    const server = asServer(rowsFromDocument({ ...doc, places: doc.places.map((place) => (place.ref === ref ? { ...place, venue } : place)) }, uuidv7(), uuidv7));
    expect(documentFromRows(server.trip, server.tables).places.find((place) => place.ref === ref)?.venue).toEqual(venue);
  });

  it.each(slugs)('%s: dokument → wiersze → dokument bez strat', (slug) => {
    const doc = load(slug);
    const server = asServer(rowsFromDocument(doc, uuidv7(), uuidv7));
    const back = documentFromRows(server.trip, server.tables);
    // Ograniczenia i notatki bez klucza wracają z kluczem z id wiersza (`id-<uuid>`) — reszta bez zmian.
    const keyless = <T extends { ref?: string }>(list: T[], original: T[]) =>
      list.map((each, i) => {
        if (original[i]?.ref !== undefined) return each;
        expect(each.ref).toMatch(/^id-/);
        const { ref: _, ...rest } = each;
        return rest as T;
      });
    expect({ ...back, items: byRef(back.items), constraints: keyless(back.constraints, doc.constraints), notes: keyless(back.notes, doc.notes) }).toEqual({ ...doc, items: byRef(doc.items) });
  });

  it('linia trasy przejazdu (`leg.geometry`) i własna pinezka wracają z bazy bez zmian', () => {
    const doc = load('maroko');
    const leg = doc.items.find((item) => item.leg !== undefined)!;
    const changed = TripDocument.parse({
      ...doc,
      places: [...doc.places, { ref: 'p-pinezka', name: 'Moja pinezka', lat: 31.625812, lng: -7.989199, provider: 'user' }],
      items: doc.items.map((item) => (item.ref === leg.ref ? { ...item, leg: { ...item.leg!, routed: true, geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } } : item)),
    });
    const server = asServer(rowsFromDocument(changed, uuidv7(), uuidv7));
    const back = documentFromRows(server.trip, server.tables);
    expect(back.items.find((item) => item.ref === leg.ref)!.leg!.geometry).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(back.places.find((place) => place.ref === 'p-pinezka')).toMatchObject({ provider: 'user', lat: 31.625812, lng: -7.989199 });
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

  it('wiersz bez ref (dodany w UI) dostaje klucz z id i można się do niego odwołać', () => {
    const doc = load('maroko');
    const server = asServer(rowsFromDocument(doc, uuidv7(), uuidv7));
    const id = uuidv7();
    const guardian = server.tables.travelers![0]!;
    server.tables.travelers!.push({ id, trip_id: server.trip.id, name: 'Nowy', guardian_id: guardian.id, sort_key: '99999', row_version: 2, deleted_at: null });
    const back = documentFromRows(server.trip, server.tables);
    expect(back.travelers.at(-1)).toMatchObject({ ref: `id-${id}`, name: 'Nowy', guardianRef: guardian.ref });
  });

  it('wiersz do UPDATE: zmienione pola, usunięte pola jako NULL, odwołania jako id', () => {
    const doc = load('maroko');
    const rows = rowsFromDocument(doc, uuidv7(), uuidv7);
    const ids = refIndex(rows.tables);
    const owner = new Map<string, Collection>();
    for (const collection of COLLECTIONS) for (const element of doc[collection] as { ref?: string }[]) if (element.ref) owner.set(element.ref, collection);
    const item = doc.items.find((each) => each.time?.precision === 'exact' && each.placeRef !== undefined)!;
    const edited = { ...item, title: 'Nowa nazwa', time: undefined, durationMin: 45 };
    const row = rowForUpdate('items', edited, { idOf: (ref) => ids[ref]!, collectionOf: (ref) => owner.get(ref) });
    expect(row).toMatchObject({ title: 'Nowa nazwa', duration_min: 45, time_precision: null, start_time: null, place_id: ids[item.placeRef!] });
    expect(row).not.toHaveProperty('ref');
    expect(row).toHaveProperty('booking_group_id');
  });

  it('osoby pozycji budżetu: wracają z wierszy jako klucze, a „wszyscy” to NULL', () => {
    const base = load('dinara');
    const who = [base.travelers[0]!.ref, base.travelers[1]!.ref];
    const doc = { ...base, budgetLines: base.budgetLines.map((line, i) => (i === 0 ? { ...line, participantRefs: who } : line)) };
    const rows = rowsFromDocument(doc, uuidv7(), uuidv7);
    const server = asServer(rows);
    const back = documentFromRows(server.trip, server.tables);
    expect(back.budgetLines.find((line) => line.ref === doc.budgetLines[0]!.ref)!.participantRefs).toEqual(who);
    expect(back.budgetLines.find((line) => line.ref === doc.budgetLines[1]!.ref)!.participantRefs).toBeUndefined();
    const ids = refIndex(rows.tables);
    const row = rowForUpdate('budgetLines', { ...doc.budgetLines[1]! }, { idOf: (ref) => ids[ref]!, collectionOf: () => undefined });
    expect(row.participant_ids).toBeNull();
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
