import type { MergeEdit, PlanEdit } from '@expeditionplan/core';
import type { SupabaseClient } from '@supabase/supabase-js';

import { type Collection, COLLECTIONS, rowForUpdate, SPECS } from './document.ts';
import { RemoteError } from './remote.ts';

/**
 * Zapis zmiany planu z edytora (`plan-edits` w packages/core). Zmieniony punkt dostaje
 * `user_locked` — AI go nie nadpisze (SPECYFIKACJA §4). Usunięcie jest miękkie (`deleted_at`).
 * `ids` to mapa ref → id z migawki (`refIndex`); nowy punkt dopisuje się do niej.
 */
export async function savePlanEdit(client: SupabaseClient, tripId: string, edit: PlanEdit, ids: Record<string, string>): Promise<Record<string, string>> {
  const owner = new Map<string, Collection>();
  for (const collection of COLLECTIONS) {
    for (const element of edit.doc[collection] as { ref?: string }[]) if (element.ref) owner.set(element.ref, collection);
  }
  const known = { ...ids };
  // Nowy punkt ma ref `id-<uuid>` — wiersz w bazie dostaje to samo id i pusty `ref`.
  if (edit.created) known[edit.created.ref] = edit.created.ref.slice(3);
  const index = {
    idOf: (ref: string) => {
      const id = known[ref];
      if (id === undefined) throw new Error(`Brak id dla „${ref}”`);
      return id;
    },
    collectionOf: (ref: string) => owner.get(ref),
  };
  const check = ({ error }: { error: { message: string; code?: string } | null }) => {
    if (error) throw new RemoteError(error.code === '42501' ? 'Brak uprawnień do zmiany planu.' : error.message, error.code);
  };

  if (edit.created) {
    const row = rowForUpdate('items', edit.created, index);
    check(await client.from('items').insert({ ...row, id: index.idOf(edit.created.ref), trip_id: tripId, source: 'user', user_locked: true }));
  }
  // Przy usuwaniu zmienione punkty to skutki uboczne (zamknięta luka, blok bez rodzica), nie edycja
  // człowieka — nie blokują ich przed AI ani przed „Zastąp dzień”.
  const lock = edit.removed === undefined ? { user_locked: true } : {};
  for (const item of edit.changed) {
    check(await client.from('items').update({ ...rowForUpdate('items', item, index), ...lock }).eq('id', index.idOf(item.ref)));
  }
  // Elementy, które wskazywały usuwany punkt (wariant go wyrzucał, źródło go dotyczyło).
  for (const other of edit.others ?? []) {
    check(await client.from(SPECS[other.collection].table).update(rowForUpdate(other.collection, other.element, index)).eq('id', index.idOf(other.element.ref)));
  }
  if (edit.removed) {
    check(await client.from('items').update({ deleted_at: new Date().toISOString() }).eq('id', index.idOf(edit.removed)));
  }
  return known;
}

/**
 * Zapis przeniesienia ze szkicu AI (`plan-merge` w packages/core): nowe miejsca, dni i punkty
 * (punkty `source: 'ai'` bez `user_locked` — blokadę daje dopiero ręczna edycja, więc kolejne
 * zastąpienie dnia nowszym szkicem je wymieni), poprawki punktów i elementów
 * wskazujących usuwane, miękkie usunięcia. Kolejne zapytania, nie jedna transakcja: przerwany
 * zapis zostawia część punktów, a widok po odświeżeniu pokazuje stan z bazy.
 */
export async function saveMergeEdit(client: SupabaseClient, tripId: string, edit: MergeEdit, ids: Record<string, string>): Promise<Record<string, string>> {
  const owner = new Map<string, Collection>();
  for (const collection of COLLECTIONS) {
    for (const element of edit.doc[collection] as { ref?: string }[]) if (element.ref) owner.set(element.ref, collection);
  }
  const known = { ...ids };
  for (const { element } of edit.created) known[element.ref] = element.ref.slice(3);
  const index = {
    idOf: (ref: string) => {
      const id = known[ref];
      if (id === undefined) throw new Error(`Brak id dla „${ref}”`);
      return id;
    },
    collectionOf: (ref: string) => owner.get(ref),
  };
  const check = ({ error }: { error: { message: string; code?: string } | null }) => {
    if (error) throw new RemoteError(error.code === '42501' ? 'Brak uprawnień do zmiany planu.' : error.message, error.code);
  };

  // Wiersz bez `ref` dostaje w dokumencie klucz `id-<uuid>` — ten sam, który nadał plan-merge.
  // Dni składają się w dokumencie po dacie, więc nowy dzień nie potrzebuje `sort_key`.
  for (const { collection, element } of edit.created) {
    const row: Record<string, unknown> = { ...rowForUpdate(collection, element, index), id: index.idOf(element.ref), trip_id: tripId };
    if (collection === 'items') Object.assign(row, { source: 'ai', user_locked: false });
    check(await client.from(SPECS[collection].table).insert(row));
  }
  for (const item of edit.changed) {
    check(await client.from('items').update(rowForUpdate('items', item, index)).eq('id', index.idOf(item.ref)));
  }
  for (const other of edit.others) {
    check(await client.from(SPECS[other.collection].table).update(rowForUpdate(other.collection, other.element, index)).eq('id', index.idOf(other.element.ref)));
  }
  if (edit.removed.length > 0) {
    check(await client.from('items').update({ deleted_at: new Date().toISOString() }).in('id', edit.removed.map(index.idOf)));
  }
  return known;
}
