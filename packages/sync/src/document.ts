import { type ScheduleOptions, TripDocument } from '@expeditionplan/core';

import type { LocalDb } from './local-db.ts';
import type { PullPayload, ServerRow } from './remote.ts';

/**
 * Wiersze bazy ↔ `TripDocument`. Ten sam kod składa dokument na webie (z `pull_changes`) i na
 * telefonie (z SQLite), więc silnik harmonogramu dostaje na obu urządzeniach identyczne wejście.
 *
 * Skrót PoC-4: pola dnia i punktu leżą w `content`, reszta dokumentu w `trips.doc_rest`
 * (patrz migracja `poc4_sync`).
 */

type Rows = { trip: Record<string, unknown>; days: ServerRow[]; items: ServerRow[] };

const alive = (row: ServerRow) => row.deleted_at === null;

export function documentFromRows({ trip, days, items }: Rows): TripDocument {
  const liveDays = days.filter(alive);
  const dayRef = new Map(liveDays.map((day) => [day.id, day.ref as string]));
  return TripDocument.parse({
    ...(trip.doc_rest as Record<string, unknown>),
    days: liveDays
      .map((day) => ({ ...(day.content as object), ref: day.ref as string, date: day.date as string }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    items: items
      .filter(alive)
      .map((item) => ({
        ...(item.content as object),
        ref: item.ref as string,
        ...(item.day_id === null ? {} : { dayRef: dayRef.get(item.day_id as string), sortKey: item.sort_key }),
      }))
      .sort((a, b) => (a.ref < b.ref ? -1 : 1)),
  });
}

/** Zdarzenia dnia → wejście silnika: opóźnienia, pominięcia, wybory wariantów. */
export function scheduleInputs(events: ServerRow[], items: ServerRow[]): Required<Pick<ScheduleOptions, 'delays' | 'skipRefs' | 'activeVariants'>> {
  const refById = new Map(items.map((item) => [item.id, item.ref as string]));
  const ordered = events
    .filter(alive)
    .sort((a, b) => (a.occurred_at as string).localeCompare(b.occurred_at as string) || a.id.localeCompare(b.id));
  const inputs = { delays: [] as { itemRef: string; minutes: number }[], skipRefs: [] as string[], activeVariants: {} as Record<string, string> };
  for (const event of ordered) {
    const itemRef = refById.get(event.item_id as string);
    const payload = (event.payload ?? {}) as { groupRef?: string; variantRef?: string };
    if (event.kind === 'delay' && itemRef !== undefined) inputs.delays.push({ itemRef, minutes: event.minutes as number });
    if (event.kind === 'skip' && itemRef !== undefined) inputs.skipRefs.push(itemRef);
    if (event.kind === 'choose_variant' && payload.groupRef && payload.variantRef) {
      inputs.activeVariants[payload.groupRef] = payload.variantRef;
    }
  }
  return inputs;
}

export type TripState = { doc: TripDocument; inputs: ReturnType<typeof scheduleInputs> };

/** Stan wyjazdu na webie: pełna migawka z serwera. */
export function stateFromPayload(payload: PullPayload): TripState {
  if (payload.trip === null) throw new Error('Migawka bez wiersza wyjazdu');
  return {
    doc: documentFromRows({ trip: payload.trip, days: payload.days, items: payload.items }),
    inputs: scheduleInputs(payload.scheduleEvents, payload.items),
  };
}

/** Stan wyjazdu na telefonie: to, co jest w SQLite, razem z zapisami czekającymi w outboxie. */
export function stateFromLocal(db: LocalDb, tripId: string): TripState {
  const read = (table: string) =>
    db.all<{ data: string }>(`select data from ${table} where trip_id = ?`, [tripId]).map(
      (row) => JSON.parse(row.data) as ServerRow,
    );
  const trip = db.all<{ data: string }>('select data from trips where id = ?', [tripId])[0];
  if (trip === undefined) throw new Error(`Brak wyjazdu ${tripId} w bazie lokalnej`);
  const items = read('items');
  // Zdarzenie zapisane offline nie ma jeszcze `deleted_at` od serwera.
  const events = read('schedule_events').map((event) => ({ ...event, deleted_at: event.deleted_at ?? null }));
  return {
    doc: documentFromRows({ trip: JSON.parse(trip.data) as Record<string, unknown>, days: read('days'), items }),
    inputs: scheduleInputs(events, items),
  };
}

/** Dokument → wiersze do zasiania wyjazdu (seed, testy). `newId` nadaje id po `ref`. */
export function rowsFromDocument(doc: TripDocument, tripId: string, newId: () => string) {
  const { days, items, ...rest } = doc;
  const dayIds = new Map(days.map((day) => [day.ref, newId()]));
  return {
    trip: {
      id: tripId,
      title: doc.trip.title,
      start_date: doc.trip.startDate,
      end_date: doc.trip.endDate,
      primary_tz: doc.trip.primaryTz,
      doc_rest: rest,
    },
    days: days.map(({ ref, date, ...content }) => ({ id: dayIds.get(ref)!, trip_id: tripId, ref, date, content })),
    items: items.map(({ ref, dayRef, sortKey, ...content }) => ({
      id: newId(),
      trip_id: tripId,
      ref,
      day_id: dayRef === undefined ? null : dayIds.get(dayRef)!,
      sort_key: sortKey ?? null,
      content,
    })),
  };
}
