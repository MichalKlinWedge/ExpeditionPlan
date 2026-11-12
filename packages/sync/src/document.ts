import { type ScheduleOptions, TripDocument, type TripDocumentInput } from '@expeditionplan/core';

import type { LocalDb } from './local-db.ts';
import type { PullPayload, ServerRow } from './remote.ts';

/**
 * Wiersze bazy ↔ `TripDocument` (migracje `mvp1_*`). Ten sam kod składa dokument na webie
 * (z `pull_changes`) i na telefonie (z SQLite), więc silnik harmonogramu dostaje na obu
 * urządzeniach identyczne wejście. To jedyne miejsce, które zna oba kształty.
 *
 * Zasady mapowania:
 * - pole dokumentu `fooBar` ↔ kolumna `foo_bar`; brak pola ↔ NULL;
 * - odwołanie z pierwszego poziomu (`placeRef`) ↔ klucz obcy (`place_id`) — `ref` jest unikalny
 *   w całym dokumencie, więc jedna mapa ref ↔ id obsługuje wszystkie kolekcje;
 * - odwołania wewnątrz pól jsonb (`leg.fromPlaceRef`, `due.itemRef`, `comparison.rows`) zostają
 *   kluczami `ref`;
 * - kolejność elementów kolekcji trzyma `sort_key` (dni — data, punkty — własny `sortKey`).
 */

type Doc = TripDocument;
export type Collection = Exclude<keyof Doc, 'schemaVersion' | 'trip'>;
type Row = Record<string, unknown>;

/**
 * Pole kolekcji: nazwa pola (kolumna z nazwy), [pole, kolumna], [pole, kolumna, 'many'] dla tablicy
 * odwołań, albo [pole, {kolekcja: kolumna}] dla odwołania do jednej z kilku kolekcji.
 */
type Field =
  | string
  | [doc: string, column: string]
  | [doc: string, column: string, kind: 'ref' | 'many']
  | [doc: string, columns: Partial<Record<Collection, string>>];

type Context = { idOf: (ref: string) => string; refOf: (id: unknown) => string | undefined; collectionOf: (ref: string) => Collection | undefined };

type Spec = {
  table: string;
  fields: Field[];
  /** Pola, które nie mapują się 1:1 (godzina punktu, początek rezerwacji). */
  toRow?: (element: Row, ctx: Context) => Row;
  fromRow?: (row: Row, ctx: Context) => Row;
  /** Kolejność w dokumencie bierze się z `sort_key` (domyślnie) albo z własnego klucza. */
  ownOrder?: true;
};

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Godzina punktu (`ItemTime`) ↔ kolumny `time_*` z §5. */
const itemTime: Pick<Spec, 'toRow' | 'fromRow'> = {
  toRow: (item) => {
    const time = item.time as Record<string, unknown> | undefined;
    if (time === undefined) return {};
    return {
      time_precision: time.precision,
      start_time: time.start,
      end_time: time.end,
      part_of_day: time.partOfDay,
      offset_min: time.offsetMin,
      relative_from: time.from,
      time_tz: time.tz,
    };
  },
  fromRow: (row) => {
    if (row.time_precision === null || row.time_precision === undefined) return {};
    return {
      time: {
        precision: row.time_precision,
        start: row.start_time ?? undefined,
        end: row.end_time ?? undefined,
        partOfDay: row.part_of_day ?? undefined,
        offsetMin: row.offset_min ?? undefined,
        from: row.relative_from ?? undefined,
        tz: row.time_tz ?? undefined,
      },
    };
  },
};

/** Początek/koniec rezerwacji, zapłata i szczegóły per rodzaj. */
const bookingExtras: Pick<Spec, 'toRow' | 'fromRow'> = {
  toRow: (booking) => {
    const row: Row = {};
    for (const side of ['start', 'end'] as const) {
      const at = booking[side] as Record<string, unknown> | undefined;
      if (at === undefined) continue;
      row[`${side}_date`] = at.date;
      row[`${side}_time`] = at.time;
      row[`${side}_precision`] = at.precision;
      row[`${side}_tz`] = at.tz;
    }
    const paid = booking.paid as Record<string, unknown> | undefined;
    if (paid !== undefined) Object.assign(row, { paid_minor: paid.amountMinor, paid_currency: paid.currency, paid_on: paid.date });
    const details = Object.fromEntries((['flight', 'car', 'lodging'] as const).filter((key) => booking[key] !== undefined).map((key) => [key, booking[key]]));
    if (Object.keys(details).length > 0) row.details = details;
    return row;
  },
  fromRow: (row) => {
    const out: Row = {};
    for (const side of ['start', 'end'] as const) {
      if (row[`${side}_date`] === null || row[`${side}_date`] === undefined) continue;
      out[side] = {
        date: row[`${side}_date`],
        time: row[`${side}_time`] ?? undefined,
        precision: row[`${side}_precision`] ?? undefined,
        tz: row[`${side}_tz`],
      };
    }
    if (row.paid_minor !== null && row.paid_minor !== undefined) {
      out.paid = { amountMinor: row.paid_minor, currency: row.paid_currency, date: row.paid_on ?? undefined };
    }
    Object.assign(out, (row.details as Row | null) ?? {});
    return out;
  },
};

/** Szczegóły przejazdu niejawnego, które nie mają własnej kolumny. */
const LEG_DETAILS = ['segments', 'departures', 'alternative', 'roundTrip', 'transit', 'links'] as const;

const legExtras: Pick<Spec, 'toRow' | 'fromRow'> = {
  toRow: (leg) => {
    const details = Object.fromEntries(LEG_DETAILS.filter((key) => leg[key] !== undefined).map((key) => [key, leg[key]]));
    return Object.keys(details).length > 0 ? { details } : {};
  },
  fromRow: (row) => ({ ...((row.details as Row | null) ?? {}) }),
};

/** Kolejność odpowiada kolejności wstawiania przy imporcie (i tak w jednej transakcji). */
export const SPECS: Record<Collection, Spec> = {
  travelers: {
    table: 'travelers',
    fields: ['name', 'nickname', 'age', 'household', ['guardianRef', 'guardian_id'], 'isDriver', 'heightCm', 'notes', 'tentative', 'fromDate', 'toDate', ['startPlaceRef', 'start_place_id'], ['endPlaceRef', 'end_place_id'], 'passportUntil', 'idCardUntil'],
  },
  places: {
    table: 'places',
    fields: ['name', 'searchName', 'category', 'lat', 'lng', 'address', 'provider', 'openingHours', 'elevationM', 'website', 'links', 'notes', 'venue'],
  },
  variantGroups: {
    table: 'variant_groups',
    fields: ['scope', ['dayRef', 'day_id'], 'title', 'conditionKind', 'conditionText', 'decideBy', ['chosenRef', 'chosen_variant_id'], 'votingOpen', 'rationale', 'comparison'],
  },
  variants: {
    table: 'variants',
    fields: [['groupRef', 'group_id'], 'label', 'summary', 'recommended', 'pros', 'cons', 'metrics', ['excludesRefs', 'excludes_item_ids', 'many']],
  },
  bookings: {
    table: 'bookings',
    fields: [
      'kind', 'status', ['variantGroupRef', 'variant_group_id'], ['variantRef', 'variant_id'], 'recommended', 'provider', 'title',
      'confirmationCode', ['startPlaceRef', 'start_place_id'], ['endPlaceRef', 'end_place_id'], 'checkInFrom', 'checkOutUntil', 'price',
      'paymentMethod', 'payWhen', 'refundable', 'freeCancellationUntil', 'party', 'includes', 'addons', 'language', 'pros', 'cons',
      'rating', 'links', 'notes',
    ],
    ...bookingExtras,
  },
  days: {
    table: 'days',
    fields: [
      'date', 'tz', 'title', 'summary', ['baseRef', 'base_place_id'],
      ['lodgingRef', { bookings: 'lodging_booking_id', variantGroups: 'lodging_group_id' }],
      'anchorTime', 'dayStart', 'dayEnd', 'scenarios', 'statedDriving', 'extras',
    ],
    ownOrder: true,
  },
  tracks: {
    table: 'tracks',
    fields: ['name', 'distanceKm', 'ascentM', 'descentM', 'durationMin', 'durationMaxMin', 'difficulty', 'waymarking', 'routeNotes', 'url', 'route', 'geojson', 'pois'],
  },
  items: {
    table: 'items',
    fields: [
      ['dayRef', 'day_id'], 'sortKey', 'area', 'kind', 'planStatus', ['replacesRefs', 'replaces_item_ids', 'many'],
      ['variantRefs', 'variant_ids', 'many'], 'title', 'leg', ['parentRef', 'parent_id'], ['routeParentRefs', 'route_parent_ids', 'many'], 'description', ['placeRef', 'place_id'],
      'durationMin', 'durationMaxMin', 'stopsMin', 'bufferAfterMin', 'isFixed', 'priority', 'cutRank', 'price', 'payment',
      ['bookingRef', { bookings: 'booking_id', variantGroups: 'booking_group_id' }], 'weather', 'selfCooked', 'transit', 'activity',
      ['participantRefs', 'participant_ids', 'many'], 'links', 'notes',
    ],
    ...itemTime,
    ownOrder: true,
  },
  legs: {
    table: 'legs',
    fields: [
      ['fromRef', { items: 'from_item_id', places: 'from_place_id' }], ['toRef', { items: 'to_item_id', places: 'to_place_id' }],
      'mode', 'durationMin', 'durationMaxMin', 'distanceKm', 'instructions', 'line', 'frequencyMin',
      ['ticketBookingRef', 'ticket_booking_id'], 'price', 'source',
    ],
    ...legExtras,
  },
  constraints: {
    table: 'constraints',
    fields: ['kind', ['dayRef', 'day_id'], ['itemRef', 'item_id'], ['bookingRef', 'booking_id'], 'time', 'tz', 'minutes', 'severity', 'reason'],
  },
  contacts: {
    table: 'contacts',
    fields: ['name', 'role', 'phone', 'email', ['bookingRef', 'booking_id'], 'notes'],
  },
  budgetLines: {
    table: 'budget_lines',
    fields: ['category', 'title', ['bookingRef', 'booking_id'], ['itemRef', 'item_id'], 'status', 'lowMinor', 'highMinor', 'currency', 'perPerson', 'depositMinor', 'balanceDue', ['participantRefs', 'participant_ids', 'many'], ['vehicleRef', 'vehicle_id'], 'note'],
  },
  // `booking_id` (wynajem) na razie bez pola w dokumencie.
  vehicles: {
    table: 'vehicles',
    fields: ['label', ['driverRef', 'driver_traveler_id'], 'seats', ['passengerRefs', 'passenger_ids', 'many'], 'notes'],
  },
  tasks: {
    table: 'tasks',
    fields: [
      'kind', 'title', 'body', 'answer', 'status', 'due', 'remindAt', ['assigneeRefs', 'assignee_ids', 'many'], ['bookingRef', 'booking_id'],
      ['itemRef', 'item_id'], ['variantGroupRef', 'variant_group_id'], ['budgetLineRef', 'budget_line_id'], 'priority',
    ],
  },
  packing: {
    table: 'packing_items',
    fields: ['category', 'title', 'note', 'scope', 'quantity', 'unit', ['assigneeRef', 'assignee_traveler_id'], 'weightG'],
  },
  notes: {
    table: 'notes',
    fields: ['scope', ['targetRef', 'entity_id'], 'kind', 'topic', 'title', 'body', 'slack'],
  },
  sources: {
    table: 'sources',
    fields: ['title', 'url', 'checkedAt', 'note', ['appliesToRefs', 'applies_to_ids', 'many']],
  },
};

export const COLLECTIONS = Object.keys(SPECS) as Collection[];

/** Wyjazd ↔ wiersz `trips`. */
const TRIP_FIELDS: Field[] = ['title', 'subtitle', 'goal', 'summary', 'startDate', 'endDate', 'primaryTz', 'homeTz', 'baseCurrency', 'fx', ['version', 'doc_version']];

function fieldParts(field: Field): { doc: string; column?: string; kind: 'plain' | 'ref' | 'many' | 'poly'; poly?: Partial<Record<Collection, string>> } {
  if (typeof field === 'string') return { doc: field, column: snake(field), kind: 'plain' };
  const [doc, target, kind] = field;
  if (typeof target === 'object') return { doc, kind: 'poly', poly: target };
  if (kind === 'many') return { doc, column: target, kind: 'many' };
  return { doc, column: target, kind: doc.endsWith('Ref') ? 'ref' : 'plain' };
}

function toRow(element: Row, fields: Field[], ctx: Context): Row {
  const row: Row = {};
  for (const field of fields) {
    const { doc, column, kind, poly } = fieldParts(field);
    const value = element[doc];
    if (value === undefined) continue;
    if (kind === 'plain') row[column!] = value;
    if (kind === 'ref') row[column!] = ctx.idOf(value as string);
    if (kind === 'many') row[column!] = (value as string[]).map(ctx.idOf);
    if (kind === 'poly') {
      const collection = ctx.collectionOf(value as string);
      const target = collection === undefined ? undefined : poly![collection];
      if (target === undefined) throw new Error(`„${value}” nie pasuje do pola ${doc}`);
      row[target] = ctx.idOf(value as string);
    }
  }
  return row;
}

function fromRow(row: Row, fields: Field[], ctx: Context): Row {
  const element: Row = {};
  for (const field of fields) {
    const { doc, column, kind, poly } = fieldParts(field);
    if (kind === 'poly') {
      const id = Object.values(poly!).map((each) => row[each!]).find((value) => value !== null && value !== undefined);
      if (id !== undefined) element[doc] = ctx.refOf(id);
      continue;
    }
    const value = row[column!];
    if (value === null || value === undefined) continue;
    if (kind === 'plain') element[doc] = value;
    if (kind === 'ref') element[doc] = ctx.refOf(value);
    if (kind === 'many') element[doc] = (value as string[]).map(ctx.refOf);
  }
  return element;
}

const alive = (row: Row) => row.deleted_at === null || row.deleted_at === undefined;

/** Wiersze tabel (po nazwie tabeli) → dokument. Usunięte wiersze się pomija. */
export type TableRows = Record<string, Row[]>;

/**
 * Kolekcje, w których wiersz bez `ref` zostaje bez klucza (przejścia — nikt ich nie edytuje po kluczu).
 * Ograniczenia i notatki dostają klucz z `id` jak reszta — inaczej te z importu i dodane w edytorze
 * (wiersz z pustym `ref`) nie dałyby się po odświeżeniu zmienić ani usunąć.
 */
const OPTIONAL_REF = new Set<Collection>(['legs']);

/**
 * Klucz dokumentu wiersza. Wiersze z UI (uczestnik dodany na webie, później edytor) nie mają
 * `ref` — dostają stały klucz z `id` (UUID pasuje do składni `Ref`), więc odwołania do nich działają.
 */
const rowRef = (collection: Collection, row: Row): string | undefined =>
  row.ref !== null && row.ref !== undefined ? (row.ref as string) : OPTIONAL_REF.has(collection) ? undefined : `id-${row.id as string}`;

export function documentFromRows(trip: Row, tables: TableRows): Doc {
  const live = Object.fromEntries(COLLECTIONS.map((c) => [c, (tables[SPECS[c].table] ?? []).filter(alive)]));
  const refById = new Map<string, string>();
  for (const collection of COLLECTIONS) {
    for (const row of live[collection]!) {
      const ref = rowRef(collection, row);
      if (ref !== undefined) refById.set(row.id as string, ref);
    }
  }
  // Odwołanie do usuniętego albo cudzego wiersza zostaje wykryte przez walidację dokumentu.
  const ctx: Context = {
    idOf: () => {
      throw new Error('idOf przy składaniu dokumentu');
    },
    refOf: (id) => refById.get(id as string) ?? `brak-${String(id).slice(-8)}`,
    collectionOf: () => undefined,
  };
  const doc: Row = { schemaVersion: 1, trip: fromRow(trip, TRIP_FIELDS, ctx) };
  for (const collection of COLLECTIONS) {
    const spec = SPECS[collection];
    const rows = [...live[collection]!].sort((a, b) => String(a.sort_key ?? '').localeCompare(String(b.sort_key ?? '')) || String(a.ref ?? a.id).localeCompare(String(b.ref ?? b.id)));
    let elements: Row[] = rows.map((row) => ({
      ...(rowRef(collection, row) === undefined ? {} : { ref: rowRef(collection, row) }),
      ...fromRow(row, spec.fields, ctx),
      ...(spec.fromRow?.(row, ctx) ?? {}),
    }));
    if (collection === 'days') elements = elements.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (collection === 'items') elements = elements.sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
    doc[collection] = elements;
  }
  return TripDocument.parse(doc);
}

/** `ref` → `id` wszystkich wierszy migawki (także tych bez `ref` — klucz `id-<uuid>`). */
/** Punkty zablokowane przed AI (`user_locked`), po `ref` z dokumentu. */
export function lockedRefs(tables: TableRows): Set<string> {
  const rows = (tables.items ?? []) as unknown as { id: string; ref: string | null; user_locked?: boolean; deleted_at: string | null }[];
  return new Set(rows.filter((row) => row.user_locked && row.deleted_at === null).map((row) => row.ref ?? `id-${row.id}`));
}

export function refIndex(tables: TableRows): Record<string, string> {
  const index: Record<string, string> = {};
  for (const collection of COLLECTIONS) {
    for (const row of tables[SPECS[collection].table] ?? []) {
      const ref = rowRef(collection, row);
      if (ref !== undefined) index[ref] = row.id as string;
    }
  }
  return index;
}

/** Kolumny ustawiane przez `toRow` danej kolekcji (poza polami z listy `fields`). */
const EXTRA_COLUMNS: Partial<Record<Collection, Record<string, unknown>>> = {
  items: { time_precision: null, start_time: null, end_time: null, part_of_day: null, offset_min: null, relative_from: null, time_tz: null },
  bookings: {
    start_date: null, start_time: null, start_precision: null, start_tz: null,
    end_date: null, end_time: null, end_precision: null, end_tz: null,
    paid_minor: null, paid_currency: null, paid_on: null, details: {},
  },
  legs: { details: {} },
};

/**
 * Element dokumentu → wiersz do UPDATE (edytor planu). W przeciwieństwie do importu każda
 * mapowana kolumna jest w wierszu — pole usunięte w edycji staje się NULL (albo pustym jsonb).
 * `ref` i `trip_id` się nie zmieniają, więc ich tu nie ma.
 */
export function rowForUpdate(
  collection: Collection,
  element: Row,
  index: { idOf: (ref: string) => string; collectionOf: (ref: string) => Collection | undefined },
): Row {
  const spec = SPECS[collection];
  const blank: Row = { ...EXTRA_COLUMNS[collection] };
  for (const field of spec.fields) {
    const { column, kind, poly } = fieldParts(field);
    if (kind === 'poly') for (const target of Object.values(poly!)) blank[target!] = null;
    else blank[column!] = null;
  }
  const ctx: Context = { idOf: index.idOf, refOf: () => undefined, collectionOf: index.collectionOf };
  return { ...blank, ...toRow(element, spec.fields, ctx), ...(spec.toRow?.(element, ctx) ?? {}) };
}

/** Klucz kolejności z pozycji w tablicy: „00000”, „00001”… — porównywany jak tekst. */
const orderKey = (index: number) => String(index).padStart(5, '0');

/**
 * Dokument → wiersze do zapisu nowego wyjazdu (`import_trip`, seed, testy). `newId` nadaje id;
 * w wierszu są tylko pola obecne w dokumencie, więc domyślne wartości kolumn działają.
 */
export function rowsFromDocument(input: TripDocumentInput | Doc, tripId: string, newId: () => string): { trip: Row; tables: Record<string, Row[]> } {
  const doc = TripDocument.parse(input);
  const ids = new Map<string, string>();
  const owner = new Map<string, Collection>();
  for (const collection of COLLECTIONS) {
    for (const element of doc[collection] as Row[]) {
      if (typeof element.ref === 'string') {
        ids.set(element.ref, newId());
        owner.set(element.ref, collection);
      }
    }
  }
  const ctx: Context = {
    idOf: (ref) => {
      const id = ids.get(ref);
      if (id === undefined) throw new Error(`Nie ma elementu „${ref}”`);
      return id;
    },
    refOf: () => undefined,
    collectionOf: (ref) => owner.get(ref),
  };
  const tables: Record<string, Row[]> = {};
  for (const collection of COLLECTIONS) {
    const spec = SPECS[collection];
    tables[spec.table] = (doc[collection] as Row[]).map((element, index) => ({
      id: typeof element.ref === 'string' ? ids.get(element.ref) : newId(),
      trip_id: tripId,
      ...(typeof element.ref === 'string' ? { ref: element.ref } : {}),
      ...(spec.ownOrder ? {} : { sort_key: orderKey(index) }),
      ...toRow(element, spec.fields, ctx),
      ...(spec.toRow?.(element, ctx) ?? {}),
    }));
  }
  return { trip: { id: tripId, ...toRow(doc.trip as Row, TRIP_FIELDS, ctx) }, tables };
}

/**
 * Zdarzenia dnia → wejście silnika: opóźnienia, pominięcia, „Zrobione”, wybory wariantów.
 * Zdarzenia są tylko dopisywane, więc cofnięcie „Zrobione” to kolejne `done` z `payload.undo`.
 */
export function scheduleInputs(events: ServerRow[], items: ServerRow[]): Required<Pick<ScheduleOptions, 'delays' | 'skipRefs' | 'activeVariants' | 'done' | 'pulled'>> {
  const refById = new Map(items.map((item) => [item.id, item.ref as string]));
  const ordered = events
    .filter(alive)
    .sort((a, b) => (a.occurred_at as string).localeCompare(b.occurred_at as string) || a.id.localeCompare(b.id));
  const inputs = {
    delays: [] as { itemRef: string; minutes: number }[],
    skipRefs: [] as string[],
    activeVariants: {} as Record<string, string>,
    done: [] as { itemRef: string; at: number }[],
    pulled: [] as { itemRef: string; dayRef: string; afterRef?: string; at: number }[],
  };
  const done = new Map<string, number>();
  const pulled = new Map<string, { itemRef: string; dayRef: string; afterRef?: string; at: number }>();
  for (const event of ordered) {
    const itemRef = refById.get(event.item_id as string);
    const payload = (event.payload ?? {}) as { groupRef?: string; variantRef?: string; undo?: boolean; dayRef?: string; afterRef?: string };
    if (event.kind === 'delay' && itemRef !== undefined) inputs.delays.push({ itemRef, minutes: event.minutes as number });
    if (event.kind === 'skip' && itemRef !== undefined) inputs.skipRefs.push(itemRef);
    if (event.kind === 'pull_from_pool' && itemRef !== undefined) {
      if (payload.undo === true) pulled.delete(itemRef);
      else if (payload.dayRef) pulled.set(itemRef, { itemRef, dayRef: payload.dayRef, ...(payload.afterRef ? { afterRef: payload.afterRef } : {}), at: Date.parse(event.occurred_at as string) });
    }
    if (event.kind === 'done' && itemRef !== undefined) {
      if (payload.undo === true) done.delete(itemRef);
      else done.set(itemRef, Date.parse(event.occurred_at as string));
    }
    if (event.kind === 'choose_variant' && payload.groupRef && payload.variantRef) {
      inputs.activeVariants[payload.groupRef] = payload.variantRef;
    }
  }
  inputs.done = [...done].map(([itemRef, at]) => ({ itemRef, at }));
  inputs.pulled = [...pulled.values()];
  return inputs;
}

export type TripState = { doc: Doc; inputs: ReturnType<typeof scheduleInputs> };

/** Stan wyjazdu na webie: pełna migawka z serwera. */
export function stateFromPayload(payload: PullPayload): TripState {
  if (payload.trip === null) throw new Error('Migawka bez wiersza wyjazdu');
  return {
    doc: documentFromRows(payload.trip, payload.tables),
    inputs: scheduleInputs(payload.tables.schedule_events ?? [], payload.tables.items ?? []),
  };
}

/** Stan wyjazdu na telefonie: to, co jest w SQLite, razem z zapisami czekającymi w outboxie. */
export function stateFromLocal(db: LocalDb, tripId: string): TripState {
  const trip = db.all<{ data: string }>('select data from trips where id = ?', [tripId])[0];
  if (trip === undefined) throw new Error(`Brak wyjazdu ${tripId} w bazie lokalnej`);
  const rows = db.all<{ tbl: string; data: string }>('select tbl, data from rows where trip_id = ?', [tripId]);
  const tables: Record<string, ServerRow[]> = {};
  for (const row of rows) (tables[row.tbl] ??= []).push(JSON.parse(row.data) as ServerRow);
  // Zdarzenie zapisane offline nie ma jeszcze `deleted_at` od serwera.
  const events = (tables.schedule_events ?? []).map((event) => ({ ...event, deleted_at: event.deleted_at ?? null }));
  return {
    doc: documentFromRows(JSON.parse(trip.data) as Row, tables),
    inputs: scheduleInputs(events, tables.items ?? []),
  };
}
