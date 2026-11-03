import { describe, expect, it } from 'vitest';

import { type NewsEntry, type NewsRow, summarizeNews } from '../news.ts';

const entry = (over: Partial<NewsEntry>): NewsEntry => ({
  entity: 'items',
  entity_id: 'a',
  action: 'update',
  actor_id: 'u1',
  actor_name: 'Anna',
  at: '2026-11-05T10:00:00Z',
  fields: [],
  ...over,
});

const rows: Record<string, NewsRow> = {
  'items:a': { id: 'a', ref: 'zamek', title: 'Zamek' },
  'items:b': { id: 'b', ref: 'muzeum', title: 'Muzeum' },
  'packing_items:c': { id: 'c', title: 'Chleb', category: 'zakupy' },
  'expenses:d': { id: 'd', note: 'Obiad', amount_minor: 12550, currency: 'PLN' },
};
const rowOf = (table: string, id: string) => rows[`${table}:${id}`];

describe('summarizeNews', () => {
  it('składa zmiany jednego elementu w jedną linię z polami po polsku i osobami', () => {
    const summary = summarizeNews(
      {
        since: '2026-11-04T00:00:00Z',
        entries: [
          entry({ fields: ['start_time', 'offset_min'], at: '2026-11-05T11:00:00Z' }),
          entry({ fields: ['description', 'weird_column'], actor_name: null }),
        ],
      },
      rowOf,
    );
    expect(summary.lines).toEqual([
      { entity: 'items', id: 'a', ref: 'zamek', kind: 'punkt', title: 'Zamek', action: 'changed', fields: ['godzina', 'opis'], actors: ['Anna', 'ktoś'], at: '2026-11-05T11:00:00Z' },
    ]);
  });

  it('dodane — „dodano”, dodane i usunięte — znika, sama kolejność — tylko licznik', () => {
    const summary = summarizeNews(
      {
        since: '2026-11-04T00:00:00Z',
        entries: [
          entry({ entity: 'packing_items', entity_id: 'c', action: 'insert', at: '2026-11-05T12:00:00Z' }),
          entry({ entity: 'packing_items', entity_id: 'c', fields: ['quantity'], at: '2026-11-05T12:05:00Z' }),
          entry({ entity_id: 'b', action: 'insert' }),
          entry({ entity_id: 'b', action: 'delete', fields: ['deleted_at'], at: '2026-11-05T13:00:00Z' }),
          entry({ fields: ['sort_key'] }),
          entry({ entity: 'expenses', entity_id: 'd', action: 'delete', fields: ['deleted_at'], at: '2026-11-05T09:00:00Z' }),
          entry({ entity: 'schedule_events', entity_id: 'e', action: 'insert' }),
        ],
      },
      rowOf,
    );
    expect(summary.reordered).toBe(1);
    expect(summary.lines.map((line) => [line.kind, line.title, line.action, line.fields])).toEqual([
      ['zakup', 'Chleb', 'added', []],
      ['wydatek', 'Obiad · 125,50 PLN', 'removed', []],
    ]);
  });

  it('element bez wiersza (np. brak dostępu) — rodzaj bez nazwy, ref z id', () => {
    const summary = summarizeNews({ since: '2026-11-04T00:00:00Z', entries: [entry({ entity_id: 'x', action: 'insert' })] }, rowOf);
    expect(summary.lines[0]).toMatchObject({ kind: 'punkt', title: '', ref: 'id-x', action: 'added' });
  });
});
