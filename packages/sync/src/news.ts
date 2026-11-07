import type { SupabaseClient } from '@supabase/supabase-js';

import { dbErrorMessage, RemoteError } from './remote.ts';

/**
 * „Co nowego od ostatniej wizyty” (RPC `trip_news`): zmiany innych osób z `activity_log` złożone
 * w linie „Anna dodała punkt „Zamek”” — po jednej na element, z polami po polsku. Treść (nazwa)
 * z aktualnego wiersza: na webie z serwera (`newsRows`), na telefonie z bazy lokalnej.
 */

export type NewsEntry = { entity: string; entity_id: string; action: 'insert' | 'update' | 'delete'; actor_id: string | null; actor_name: string | null; at: string; fields: string[] };
export type TripNews = { since: string; entries: NewsEntry[] };
export type NewsRow = Record<string, unknown> & { id: string };

export type NewsLine = {
  entity: string;
  id: string;
  /** Klucz elementu w dokumencie (`ref` albo `id-<uuid>`), np. do linku do karty punktu. */
  ref: string;
  /** „punkt”, „rezerwacja”, „wydatek”… */
  kind: string;
  title: string;
  action: 'added' | 'changed' | 'removed';
  /** Zmienione pola po polsku (tylko przy „changed”), bez powtórzeń. */
  fields: string[];
  actors: string[];
  at: string;
};
export type NewsSummary = { since: string; lines: NewsLine[]; /** Elementy, którym zmieniła się tylko kolejność. */ reordered: number };

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
const amount = (row: NewsRow) => (typeof row.amount_minor === 'number' ? `${(row.amount_minor / 100).toFixed(2).replace('.', ',')} ${String(row.currency ?? '')}`.trim() : undefined);

/** Tabela → nazwa rodzaju i tytuł z wiersza. Tabel spoza listy (techniczne) nie pokazujemy. */
const ENTITY: Record<string, { kind: string | ((row: NewsRow) => string); title: (row: NewsRow) => string | undefined }> = {
  items: { kind: 'punkt', title: (row) => text(row.title) },
  places: { kind: 'miejsce', title: (row) => text(row.name) },
  bookings: { kind: 'rezerwacja', title: (row) => text(row.title) ?? text(row.provider) },
  travelers: { kind: 'uczestnik', title: (row) => text(row.name) },
  days: { kind: 'dzień', title: (row) => text(row.title) ?? text(row.date) },
  tracks: { kind: 'ślad', title: (row) => text(row.name) },
  legs: { kind: 'przejazd', title: (row) => text(row.mode) },
  constraints: { kind: 'ograniczenie', title: (row) => text(row.reason) },
  contacts: { kind: 'kontakt', title: (row) => text(row.name) },
  budget_lines: { kind: 'pozycja budżetu', title: (row) => text(row.title) },
  tasks: { kind: 'zadanie', title: (row) => text(row.title) },
  packing_items: { kind: (row) => (row.category === 'zakupy' ? 'zakup' : 'rzecz do spakowania'), title: (row) => text(row.title) },
  notes: { kind: 'notatka', title: (row) => text(row.title) ?? text(row.topic) },
  sources: { kind: 'źródło', title: (row) => text(row.title) ?? text(row.url) },
  vehicles: { kind: 'pojazd', title: (row) => text(row.label) },
  documents: { kind: 'dokument', title: (row) => text(row.file_name) },
  expenses: { kind: 'wydatek', title: (row) => [text(row.note), amount(row)].filter(Boolean).join(' · ') || undefined },
  settlements: { kind: 'rozliczenie', title: (row) => amount(row) },
  trip_brief: { kind: 'brief', title: () => 'brief wyjazdu' },
  variant_groups: { kind: 'wybór wariantu', title: (row) => text(row.title) },
  variants: { kind: 'wariant', title: (row) => text(row.label) },
};

/** Kolumna → pole po polsku; nieznane pomijamy (zmiana i tak jest pokazana). */
const FIELD: Record<string, string> = {
  title: 'nazwa', name: 'nazwa', label: 'nazwa', description: 'opis', summary: 'opis', body: 'treść', note: 'uwaga', notes: 'uwagi',
  day_id: 'dzień', date: 'data', start_time: 'godzina', end_time: 'godzina', time_precision: 'godzina', part_of_day: 'godzina',
  offset_min: 'godzina', relative_from: 'godzina', start_date: 'termin', end_date: 'termin', duration_min: 'czas trwania',
  duration_max_min: 'czas trwania', price: 'cena', low_minor: 'kwota', high_minor: 'kwota', amount_minor: 'kwota', currency: 'waluta',
  status: 'status', plan_status: 'status w planie', priority: 'priorytet', place_id: 'miejsce', lat: 'położenie', lng: 'położenie',
  address: 'adres', phone: 'telefon', email: 'e-mail', category: 'kategoria', confirmation_code: 'kod potwierdzenia', paid_minor: 'płatność',
  paid_on: 'płatność', payment: 'płatność', due: 'termin', answer: 'odpowiedź', assignee_ids: 'kto', assignee_traveler_id: 'kto',
  participant_ids: 'uczestnicy', geojson: 'ślad', chosen_variant_id: 'wybrany wariant', mode: 'środek transportu', quantity: 'ilość',
  links: 'linki', weather: 'pogoda', is_fixed: 'stała godzina', self_cooked: 'gotujemy sami', payer_traveler_id: 'kto zapłacił',
  split_mode: 'podział', receipt_path: 'paragon', settled_at: 'rozliczone', brief: 'brief', visibility: 'widoczność',
};

/** Linie od najnowszej: dodanie i potem usunięcie znikają, sama zmiana kolejności — tylko w liczniku. */
export function summarizeNews(news: TripNews, rowOf: (table: string, id: string) => NewsRow | undefined): NewsSummary {
  const groups = new Map<string, NewsEntry[]>();
  for (const entry of news.entries) {
    if (ENTITY[entry.entity] === undefined) continue;
    const key = `${entry.entity}:${entry.entity_id}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const lines: NewsLine[] = [];
  let reordered = 0;
  for (const entries of groups.values()) {
    const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at));
    const newest = sorted[0]!;
    const added = sorted.some((entry) => entry.action === 'insert');
    if (added && newest.action === 'delete') continue;
    const action = added ? 'added' : newest.action === 'delete' ? 'removed' : 'changed';
    const raw = new Set(sorted.flatMap((entry) => entry.fields).filter((field) => field !== 'deleted_at'));
    if (action === 'changed' && raw.size > 0 && [...raw].every((field) => field === 'sort_key')) {
      reordered += 1;
      continue;
    }
    const spec = ENTITY[newest.entity]!;
    const row = rowOf(newest.entity, newest.entity_id);
    lines.push({
      entity: newest.entity,
      id: newest.entity_id,
      ref: typeof row?.ref === 'string' ? row.ref : `id-${newest.entity_id}`,
      kind: row === undefined ? (typeof spec.kind === 'string' ? spec.kind : 'element') : typeof spec.kind === 'string' ? spec.kind : spec.kind(row),
      title: (row && spec.title(row)) ?? '',
      action,
      fields: action === 'changed' ? [...new Set([...raw].map((field) => FIELD[field]).filter((label): label is string => label !== undefined))] : [],
      actors: [...new Set(sorted.map((entry) => entry.actor_name ?? 'ktoś'))],
      at: newest.at,
    });
  }
  return { since: news.since, lines: lines.sort((a, b) => b.at.localeCompare(a.at)), reordered };
}

/** Zmiany innych od ostatniej wizyty (null — brak dostępu albo serwer przed migracją). */
export async function fetchTripNews(client: SupabaseClient, tripId: string): Promise<TripNews | null> {
  const { data, error } = await client.rpc('trip_news', { p_trip: tripId });
  if (error) throw new RemoteError(dbErrorMessage(error), error.code);
  return (data as TripNews | null) ?? null;
}

/** Aktualne wiersze elementów z listy (także usunięte — dla nazwy), po 80 id na zapytanie. */
export async function newsRows(client: SupabaseClient, news: TripNews): Promise<(table: string, id: string) => NewsRow | undefined> {
  const ids = new Map<string, Set<string>>();
  for (const entry of news.entries) if (ENTITY[entry.entity] !== undefined) ids.set(entry.entity, (ids.get(entry.entity) ?? new Set()).add(entry.entity_id));
  const rows = new Map<string, NewsRow>();
  const requests: Promise<void>[] = [];
  for (const [table, set] of ids) {
    const all = [...set];
    for (let start = 0; start < all.length; start += 80) {
      requests.push(
        Promise.resolve(client.from(table).select('*').in('id', all.slice(start, start + 80))).then(({ data, error }) => {
          if (error) throw new RemoteError(dbErrorMessage(error), error.code);
          for (const row of (data ?? []) as NewsRow[]) rows.set(`${table}:${row.id}`, row);
        }),
      );
    }
  }
  await Promise.all(requests);
  return (table, id) => rows.get(`${table}:${id}`);
}

/** „Przejrzane” — od teraz nowe są tylko późniejsze zmiany. */
export async function markNewsSeen(client: SupabaseClient, tripId: string): Promise<void> {
  const { error } = await client.rpc('mark_changes_seen', { p_trip: tripId });
  if (error) throw new RemoteError(dbErrorMessage(error), error.code);
}

/** Czasownik bez rodzaju osoby: „dodano punkt „Zamek” — Anna”. */
export const NEWS_ACTION: Record<NewsLine['action'], string> = { added: 'dodano', changed: 'zmieniono', removed: 'usunięto' };
