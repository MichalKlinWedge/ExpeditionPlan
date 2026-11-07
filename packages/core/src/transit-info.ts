import { z } from 'zod';

import { isTransitItem, PUBLIC_MODES, type PublicMode } from './item-kind.ts';
import { formatMinutes } from './plan-info.ts';
import { LocalTime } from './schemas/common.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Przejazd komunikacją publiczną: szczegóły odczytane przez AI z tekstu, który wkleił użytkownik
 * (Google Maps, Jakdojade, strona przewoźnika, rozkład). Link do trasy to `transitRouteUrl`
 * (`item-route.ts`). Wyników Google nie wolno przechowywać (docs/USLUGI.md §3), a wklejony tekst to
 * dane użytkownika. Szkic idzie przez podgląd, jak przy noclegu (`lodging-info.ts`).
 */

type Doc = TripDocument;
type Item = Doc['items'][number];
type Leg = NonNullable<Item['leg']>;
type Segment = NonNullable<Leg['segments']>[number];

const MODE_NAME: Record<string, string> = { ...Object.fromEntries(PUBLIC_MODES), walk: 'pieszo' };
const SEGMENT_MODES = ['walk', ...PUBLIC_MODES.map(([key]) => key)] as [string, ...string[]];

/** „metro L5 Sagrada Família → Diagonal”. */
function segmentLine(segment: Pick<Segment, 'mode' | 'line' | 'from' | 'to' | 'durationMin'>): string {
  // Przejście w obrębie jednej stacji (przesiadka) to „na Diagonal”, a nie „Diagonal → Diagonal”.
  const same = segment.from !== undefined && segment.from === segment.to;
  const ends = same ? `na ${segment.from}` : segment.from && segment.to ? `${segment.from} → ${segment.to}` : segment.to ? `do ${segment.to}` : (segment.from ?? '');
  const head = [MODE_NAME[segment.mode] ?? segment.mode, segment.line].filter(Boolean).join(' ');
  return [head, ends].filter(Boolean).join(' ') + (segment.durationMin ? ` (${formatMinutes(segment.durationMin)})` : '');
}

/** Odcinki trasy jednym tekstem: „metro L5 … → Diagonal, przesiadka: metro L3 … → Espanya”. */
export function segmentsLabel(segments: readonly Pick<Segment, 'mode' | 'line' | 'from' | 'to' | 'durationMin'>[]): string {
  return segments.map((segment, index) => (index > 0 && segment.mode !== 'walk' && segments.slice(0, index).some((each) => each.mode !== 'walk') ? `przesiadka: ${segmentLine(segment)}` : segmentLine(segment))).join(', ');
}

/** Linie po kolei, do wiersza planu: „L5 → L3”, „R2 Nord → L4”. `null` = brak linii. */
export function transitLines(item: Pick<Item, 'kind' | 'leg'>): string | null {
  const leg = item.leg;
  if (!isTransitItem(item) || leg === undefined) return null;
  const lines = (leg.segments ?? []).filter((segment) => segment.mode !== 'walk' && segment.line).map((segment) => segment.line!);
  const all = lines.length > 0 ? lines : leg.line ? [leg.line] : [];
  return all.length === 0 ? null : all.join(' → ');
}

/** Szczegóły przejazdu komunikacją na kartę punktu: odcinki, częstotliwość, odjazdy, wskazówki, plan B. */
export function transitDetails(item: Pick<Item, 'kind' | 'leg'>): string[] {
  const leg = item.leg;
  if (!isTransitItem(item) || leg === undefined) return [];
  const segments = leg.segments ?? [];
  return [
    segments.length > 0 ? segmentsLabel(segments) : leg.line ? `${MODE_NAME[leg.mode] ?? leg.mode} ${leg.line}` : null,
    leg.frequencyMin ? `kursuje co ok. ${formatMinutes(leg.frequencyMin)}` : null,
    leg.departures?.length ? `odjazdy: ${leg.departures.join(', ')}` : null,
    leg.instructions ?? null,
    leg.alternative?.instructions ? `plan B: ${leg.alternative.instructions}` : null,
  ].filter((line): line is string => line !== null);
}

const short = (max: number) => z.string().trim().min(1).max(max).nullable();

export const TransitDraft = z.object({
  /** Czy w tekście w ogóle jest trasa komunikacją. */
  isRoute: z.boolean(),
  segments: z
    .array(
      z.object({
        mode: z.enum(SEGMENT_MODES),
        line: short(40),
        from: short(80),
        to: short(80),
        durationMin: z.number().int().positive().max(1440).nullable(),
      }),
    )
    .max(10),
  durationMin: z.number().int().positive().max(1440).nullable(),
  frequencyMin: z.number().int().positive().max(720).nullable(),
  /** Godziny odjazdów z pierwszego przystanku, które są w tekście. */
  departures: z.array(LocalTime).max(30),
  instructions: short(400),
  alternative: short(300),
});
export type TransitDraft = z.infer<typeof TransitDraft>;

export const TRANSIT_FIELDS = ['segments', 'durationMin', 'frequencyMin', 'departures', 'instructions', 'alternative'] as const;
export type TransitField = (typeof TRANSIT_FIELDS)[number];

/** Wiersz podglądu; `current` — inna wartość, która już jest w planie (nie zaznaczamy jej domyślnie). */
export type TransitDraftRow = { key: TransitField; label: string; value: string; current?: string };

const draftSegments = (draft: TransitDraft): Segment[] =>
  draft.segments.map((segment) => ({
    mode: segment.mode as Segment['mode'],
    ...(segment.line ? { line: segment.line } : {}),
    ...(segment.from ? { from: segment.from } : {}),
    ...(segment.to ? { to: segment.to } : {}),
    ...(segment.durationMin ? { durationMin: segment.durationMin } : {}),
  }));

/** Środek pierwszego odcinka, który nie jest pieszo: „autobus” w planie, a w tekście metro. */
const mainMode = (segments: readonly Segment[]): PublicMode | undefined => segments.find((segment) => segment.mode !== 'walk')?.mode as PublicMode | undefined;

const itemMinutes = (item: Item) => item.durationMin ?? item.leg?.durationMin;

/** Co szkic zmieniłby w planie; pola bez odczytanej wartości i te już takie same nie trafiają na listę. */
export function transitDraftRows(item: Item, draft: TransitDraft): TransitDraftRow[] {
  const leg = item.leg;
  const segments = draftSegments(draft);
  const mode = mainMode(segments);
  const route = segments.length === 0 ? null : segmentsLabel(segments) + (mode !== undefined && mode !== leg?.mode ? ` (środek w planie zmieni się na: ${MODE_NAME[mode]})` : '');
  const minutes = itemMinutes(item);
  const candidates: { key: TransitField; label: string; value: string | null; current: string | undefined }[] = [
    { key: 'segments', label: 'Trasa', value: route, current: leg?.segments?.length ? segmentsLabel(leg.segments) : undefined },
    { key: 'durationMin', label: 'Czas przejazdu', value: draft.durationMin === null ? null : formatMinutes(draft.durationMin), current: minutes === undefined ? undefined : formatMinutes(minutes) },
    { key: 'frequencyMin', label: 'Kursuje co', value: draft.frequencyMin === null ? null : formatMinutes(draft.frequencyMin), current: leg?.frequencyMin ? formatMinutes(leg.frequencyMin) : undefined },
    { key: 'departures', label: 'Odjazdy', value: draft.departures.length > 0 ? draft.departures.join(', ') : null, current: leg?.departures?.length ? leg.departures.join(', ') : undefined },
    { key: 'instructions', label: 'Wskazówki', value: draft.instructions, current: leg?.instructions },
    { key: 'alternative', label: 'Plan B', value: draft.alternative, current: leg?.alternative?.instructions },
  ];
  return candidates.flatMap(({ key, label, value, current }) => (value === null || value === current ? [] : [{ key, label, value, ...(current ? { current } : {}) }]));
}

/** Górna granica czasu zostaje tylko, gdy nadal jest powyżej nowego czasu. */
const keepMax = (max: number | undefined, min: number) => (max !== undefined && max >= min ? { durationMaxMin: max } : {});

/**
 * Zapis zaznaczonych pól w przejeździe. Czas trafia tam, skąd silnik go bierze: do punktu, gdy był
 * wpisany ręcznie, inaczej do `leg` z `routed: false` („z podanej trasy”). Odcinki ustawiają też
 * linię i środek przejazdu (pierwszy odcinek, który nie jest pieszo). `null` = nie ma punktu albo
 * nie jest przejazdem komunikacją.
 */
export function applyTransitDraft(doc: Doc, itemRef: string, draft: TransitDraft, fields: readonly TransitField[]): { doc: Doc; item: Item } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  if (item === undefined || !isTransitItem(item) || item.leg === undefined) return null;
  const picked = new Set(fields);
  let leg: Leg = item.leg;
  let next: Item = item;

  if (picked.has('segments') && draft.segments.length > 0) {
    const segments = draftSegments(draft);
    const line = segments.find((segment) => segment.mode !== 'walk' && segment.line)?.line;
    // Linia na mapie była z poprzednich odcinków: nowa powstaje z OpenStreetMap po zapisie (`applyTransitShape`).
    const { line: _line, geometry: _geometry, ...rest } = leg;
    leg = { ...rest, segments, mode: mainMode(segments) ?? leg.mode, ...(line !== undefined ? { line } : {}) };
  }
  if (picked.has('frequencyMin') && draft.frequencyMin !== null) leg = { ...leg, frequencyMin: draft.frequencyMin };
  if (picked.has('departures') && draft.departures.length > 0) leg = { ...leg, departures: draft.departures };
  if (picked.has('instructions') && draft.instructions !== null) leg = { ...leg, instructions: draft.instructions };
  if (picked.has('alternative') && draft.alternative !== null) leg = { ...leg, alternative: { ...leg.alternative, instructions: draft.alternative } };

  const minutes = picked.has('durationMin') ? draft.durationMin : null;
  if (minutes !== null) {
    if (item.durationMin !== undefined) {
      const { durationMaxMin, ...others } = next;
      next = { ...others, durationMin: minutes, ...keepMax(durationMaxMin, minutes) };
    } else {
      const { routed: _routed, geometry: _geometry, durationMaxMin, ...rest } = leg;
      leg = { ...rest, routed: false, durationMin: minutes, ...keepMax(durationMaxMin, minutes) };
    }
  }

  next = { ...next, leg };
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next };
}
