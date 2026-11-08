import { pluralForm } from './format.ts';
import { plainName, SAME_NAME_M, type SharedPlace } from './place-list.ts';
import { distanceM } from './polyline.ts';

/**
 * Pamięć miejsc między wyjazdami (strona „Wszystkie miejsca”): każdy uczestnik ocenia miejsce „warto / nie
 * warto” i zostawia notatkę na przyszłość; lata wizyt liczą się z dat wyjazdów, w których miejsce było w planie.
 * Wpisy są w tabeli `place_memories` (poza `TripDocument`), po jednym na osobę i miejsce. Miejsce łączy
 * się jak w `placesAcrossTrips`: ta sama nazwa, chyba że współrzędne są dalej niż `SAME_NAME_M`.
 * Pamięć trafia też do „Zaplanuj z AI” (`plannerMemory`).
 */

export type PlaceVerdict = 'worth' | 'not_worth';

export const PLACE_VERDICT: Record<PlaceVerdict, string> = { worth: 'warto', not_worth: 'nie warto' };

/** Wiersz `place_memories` widoczny dla mnie (RLS: moje i z miejsc moich wyjazdów). */
export type PlaceMemoryRow = {
  id: string;
  user_id: string;
  author_name: string;
  name: string;
  lat: number | null;
  lng: number | null;
  verdict: string | null;
  note: string | null;
  updated_at: string;
};

const verdictOf = (value: string | null): PlaceVerdict | undefined => (value === 'worth' || value === 'not_worth' ? value : undefined);

/** Czy wpis pamięci dotyczy tej grupy miejsc: ta sama nazwa i (brak współrzędnych po którejś stronie albo blisko). */
export function memoryMatches(place: Pick<SharedPlace, 'name' | 'at'>, row: Pick<PlaceMemoryRow, 'name' | 'lat' | 'lng'>): boolean {
  const key = plainName(place.name);
  if (key === '' || key !== plainName(row.name)) return false;
  if (place.at === undefined || row.lat === null || row.lng === null) return true;
  return distanceM(place.at, [row.lng, row.lat]) <= SAME_NAME_M;
}

/** Wpisy pamięci tej grupy miejsc, najnowsze na górze. */
export function memoriesOf(place: Pick<SharedPlace, 'name' | 'at'>, rows: readonly PlaceMemoryRow[]): PlaceMemoryRow[] {
  return rows.filter((row) => memoryMatches(place, row)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export type MemoryEntry = { userId: string; author: string; verdict?: PlaceVerdict; note?: string; mine: boolean };

export type PlaceMemorySummary = {
  worth: number;
  notWorth: number;
  /** Przeważająca ocena; `mixed` przy remisie, brak bez ocen. */
  verdict?: PlaceVerdict | 'mixed';
  /** Po jednym na osobę (najnowszy wpis, gdy z dwóch wystąpień miejsca wyszły dwa). */
  entries: MemoryEntry[];
  mine?: MemoryEntry;
};

export function memorySummary(rows: readonly PlaceMemoryRow[], me?: string): PlaceMemorySummary {
  const byUser = new Map<string, MemoryEntry>();
  for (const row of [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    if (byUser.has(row.user_id)) continue;
    const verdict = verdictOf(row.verdict);
    const note = row.note?.trim();
    if (verdict === undefined && !note) continue;
    byUser.set(row.user_id, { userId: row.user_id, author: row.author_name, ...(verdict ? { verdict } : {}), ...(note ? { note } : {}), mine: row.user_id === me });
  }
  const entries = [...byUser.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.author.localeCompare(b.author, 'pl'));
  const worth = entries.filter((entry) => entry.verdict === 'worth').length;
  const notWorth = entries.filter((entry) => entry.verdict === 'not_worth').length;
  const verdict = worth + notWorth === 0 ? undefined : worth === notWorth ? 'mixed' : worth > notWorth ? 'worth' : 'not_worth';
  const mine = entries.find((entry) => entry.mine);
  return { worth, notWorth, ...(verdict ? { verdict } : {}), entries, ...(mine ? { mine } : {}) };
}

/**
 * Lata, w których byliśmy w miejscu: wyjazdy, które już się zaczęły (`startDate` ≤ dziś), bez odłożonych.
 * `skipTripId` pomija wyjazd, który właśnie planujemy.
 */
export function placeVisitYears(place: Pick<SharedPlace, 'trips'>, today: string, skipTripId?: string): number[] {
  const years = place.trips
    .filter((trip) => trip.tripId !== skipTripId && trip.postponed !== true && trip.startDate !== undefined && trip.startDate <= today)
    .map((trip) => Number(trip.startDate!.slice(0, 4)));
  return [...new Set(years)].sort((a, b) => a - b);
}

/** „byliśmy w 2025”, „byliśmy w 2023 i 2025”, „byliśmy w 2021, 2023 i 2025”. */
export function visitLabel(years: readonly number[]): string | undefined {
  if (years.length === 0) return undefined;
  const list = years.length === 1 ? String(years[0]) : `${years.slice(0, -1).join(', ')} i ${years.at(-1)}`;
  return `byliśmy w ${list}`;
}

/** „2 × warto, 1 × nie warto”. */
export function verdictLabel(summary: Pick<PlaceMemorySummary, 'worth' | 'notWorth'>): string | undefined {
  const parts = [summary.worth > 0 ? `${summary.worth} × warto` : '', summary.notWorth > 0 ? `${summary.notWorth} × nie warto` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Pamięć jednego miejsca dla „Zaplanuj z AI”. */
export type PlannerPlaceMemory = {
  name: string;
  years: number[];
  worth: number;
  notWorth: number;
  notes: string[];
  /** Nie proponować ponownie bez wyraźnego uzasadnienia: przeważa „nie warto” albo już tam byliśmy (także z „warto”). */
  avoid: boolean;
  at?: [number, number];
};

/** Tyle miejsc najwyżej idzie do promptu (najpierw „nie warto”, potem z notatkami, potem odwiedzone). */
export const PLANNER_MEMORY_LIMIT = 60;

/**
 * Pamięć miejsc jako kontekst planowania: miejsca z oceną, notatką albo wizytą w poprzednich wyjazdach.
 * Samo „warto” bez wizyty i notatki też idzie (to podpowiedź, co się podobało).
 */
export function plannerMemory(places: readonly SharedPlace[], rows: readonly PlaceMemoryRow[], today: string, skipTripId?: string): PlannerPlaceMemory[] {
  const found: PlannerPlaceMemory[] = [];
  for (const place of places) {
    const summary = memorySummary(memoriesOf(place, rows));
    const years = placeVisitYears(place, today, skipTripId);
    const notes = summary.entries.flatMap((entry) => (entry.note ? [entry.note] : []));
    if (years.length === 0 && summary.entries.length === 0) continue;
    found.push({
      name: place.name,
      years,
      worth: summary.worth,
      notWorth: summary.notWorth,
      notes,
      avoid: summary.notWorth > summary.worth || years.length > 0,
      ...(place.at ? { at: place.at } : {}),
    });
  }
  const rank = (each: PlannerPlaceMemory) => (each.notWorth > each.worth ? 0 : each.notes.length > 0 ? 1 : each.avoid ? 2 : 3);
  return found.sort((a, b) => rank(a) - rank(b) || (b.years.at(-1) ?? 0) - (a.years.at(-1) ?? 0) || a.name.localeCompare(b.name, 'pl')).slice(0, PLANNER_MEMORY_LIMIT);
}

/** Jedna linia pamięci do promptu: „Morskie Oko — byliśmy w 2025; 1 × nie warto; notatki: „tłumy””. */
export function plannerMemoryLine(memory: PlannerPlaceMemory): string {
  const parts = [visitLabel(memory.years), verdictLabel(memory), memory.notes.length > 0 ? `${pluralForm(memory.notes.length, ['notatka', 'notatki', 'notatki'])}: ${memory.notes.map((note) => `„${note.replace(/\s+/g, ' ')}”`).join('; ')}` : undefined].filter(Boolean);
  return `${memory.avoid ? '[unikaj] ' : ''}${memory.name} — ${parts.join('; ')}`;
}

/** Miejsca szkicu, które pamięć każe omijać, a AI je i tak zaproponowało (do ostrzeżenia w szkicu). */
export function rememberedInPlan(places: readonly { name: string; lat?: number | undefined; lng?: number | undefined }[], memory: readonly PlannerPlaceMemory[]): PlannerPlaceMemory[] {
  return memory.filter(
    (each) =>
      each.avoid &&
      places.some((place) =>
        memoryMatches({ name: each.name, ...(each.at ? { at: each.at } : {}) }, { name: place.name, lat: place.lat ?? null, lng: place.lng ?? null }),
      ),
  );
}
