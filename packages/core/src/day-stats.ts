import type { DaySchedule } from './engine/schedule.ts';
import { dayGaps } from './day-gaps.ts';
import { formatKm, plural } from './format.ts';
import { formatMinutes } from './plan-info.ts';
import { distanceM, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Statystyki dnia pod planem: ile drogi i czasu pieszo, rowerem, autem, komunikacją i samolotem, ile czasu
 * na zwiedzanie, posiłki i inne punkty oraz wolny czas między nimi. Czasy z silnika (`scheduleDay`, ten sam
 * scenariusz i warianty co plan), kilometry i przewyższenia z planu: odcinek przejazdu, liczby wędrówki
 * albo jej ślad z „Tras”, przejścia niejawne (`legs`) między punktami dnia.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type MoveKind = 'foot' | 'bike' | 'drive' | 'transit' | 'flight';
export type StayKind = 'sights' | 'meals' | 'other';

export type MoveStats = {
  kind: MoveKind;
  /** Ile odcinków (przejazdy, wędrówki, przejścia). */
  count: number;
  km: number;
  /** Ile odcinków nie ma kilometrów w planie (liczą się tylko do czasu). */
  noKm: number;
  /** Czas w drodze bez postojów w trasie. */
  minutes: number;
  /** Postoje w trasie (atrakcje po drodze, przerwy). */
  stopsMin: number;
  ascentM: number;
  descentM: number;
};

/** `untimed` = punkty bez czasu trwania w planie (liczą się tylko do liczby). */
export type StayStats = { kind: StayKind; count: number; minutes: number; untimed: number };

export type DayStatistics = {
  /** Pierwsza i ostatnia godzina dnia z silnika. */
  start: string;
  end: string;
  /** Data końca, gdy dzień kończy się po północy. */
  endDate: string;
  spanMin: number;
  /** Punkty dnia bez podpunktów i postojów w trasie. */
  points: number;
  moves: MoveStats[];
  stays: StayStats[];
  freeMin: number;
  freeCount: number;
  /** Zapasy po punktach (bufory). */
  bufferMin: number;
};

export const MOVE_LABEL: Record<MoveKind, string> = { foot: 'Pieszo', bike: 'Rowerem', drive: 'Autem', transit: 'Komunikacją', flight: 'Samolotem' };
export const STAY_LABEL: Record<StayKind, string> = { sights: 'Zwiedzanie i atrakcje', meals: 'Posiłki', other: 'Inne punkty' };

const FOOT = new Set(['walk', 'hike']);
const DRIVE = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);

function moveKind(mode: string): MoveKind {
  if (FOOT.has(mode)) return 'foot';
  if (mode === 'bike') return 'bike';
  if (DRIVE.has(mode)) return 'drive';
  if (mode === 'flight') return 'flight';
  return 'transit';
}

const ORDER: MoveKind[] = ['foot', 'bike', 'drive', 'transit', 'flight'];

export function dayStatistics(doc: Doc, schedule: DaySchedule): DayStatistics | null {
  const rows = schedule.items.filter((row) => row.child !== true && row.routeStop !== true);
  if (rows.length === 0) return null;
  const items = new Map(doc.items.map((item) => [item.ref, item]));
  const tracks = new Map(doc.tracks.map((track) => [track.ref, track]));
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const coords = (ref: string | undefined): LngLat | undefined => {
    const place = ref === undefined ? undefined : places.get(ref);
    return place?.lat !== undefined && place.lng !== undefined ? [place.lng, place.lat] : undefined;
  };
  // Lot bez dystansu w planie: odległość po łuku między lotniskami (tak liczy się dystans lotu).
  const flightKm = (item: Item): number | undefined => {
    if (item.leg?.mode !== 'flight') return undefined;
    const from = coords(item.leg.fromPlaceRef ?? item.placeRef);
    const to = coords(item.leg.toPlaceRef);
    return from === undefined || to === undefined ? undefined : Math.round(distanceM(from, to) / 1000);
  };
  const moves = new Map<MoveKind, MoveStats>();
  const stays = new Map<StayKind, StayStats>();
  const move = (kind: MoveKind) => {
    const found = moves.get(kind) ?? { kind, count: 0, km: 0, noKm: 0, minutes: 0, stopsMin: 0, ascentM: 0, descentM: 0 };
    moves.set(kind, found);
    return found;
  };
  const stay = (kind: StayKind, minutes: number) => {
    const found = stays.get(kind) ?? { kind, count: 0, minutes: 0, untimed: 0 };
    found.count += 1;
    found.minutes += minutes;
    if (minutes === 0) found.untimed += 1;
    stays.set(kind, found);
  };
  const climb = (target: MoveStats, item: Item) => {
    const track = [item.activity?.trackRef, item.leg?.trackRef].map((ref) => (ref === undefined ? undefined : tracks.get(ref))).find(Boolean);
    target.ascentM += item.activity?.ascentM ?? track?.ascentM ?? 0;
    target.descentM += item.activity?.descentM ?? track?.descentM ?? 0;
    return track;
  };

  let bufferMin = 0;
  for (const row of rows) {
    const item = items.get(row.ref);
    if (item === undefined) continue;
    bufferMin += item.bufferAfterMin ?? 0;
    if (item.kind === 'transport' && item.leg !== undefined) {
      const target = move(moveKind(item.leg.mode));
      const stopsMin = row.routeStopsMin ?? 0;
      target.count += 1;
      target.minutes += Math.max(0, row.durationMin - stopsMin);
      target.stopsMin += stopsMin;
      const track = climb(target, item);
      const km = item.leg.distanceKm ?? item.activity?.distanceKm ?? track?.distanceKm ?? flightKm(item);
      if (km === undefined) target.noKm += 1;
      else target.km += km;
      continue;
    }
    // Wędrówka zapisana jako atrakcja z dystansem albo śladem: liczy się pieszo.
    const track = item.activity?.trackRef === undefined ? undefined : tracks.get(item.activity.trackRef);
    const walkKm = item.activity?.distanceKm ?? track?.distanceKm;
    if (item.kind === 'activity' && walkKm !== undefined) {
      const target = move('foot');
      target.count += 1;
      target.km += walkKm;
      target.minutes += row.durationMin;
      climb(target, item);
      continue;
    }
    if (item.kind === 'lodging') continue;
    stay(item.kind === 'visit' || item.kind === 'activity' ? 'sights' : item.kind === 'meal' ? 'meals' : 'other', row.durationMin);
  }

  // Przejścia niejawne między kolejnymi punktami dnia („zejście 40 min do Sagrady”).
  for (let i = 0; i + 1 < rows.length; i++) {
    const leg = doc.legs.find((each) => each.fromRef === rows[i]!.ref && each.toRef === rows[i + 1]!.ref);
    if (leg === undefined) continue;
    const target = move(moveKind(leg.mode));
    target.count += 1;
    target.minutes += (schedule.scenario === 'pessimistic' ? (leg.durationMaxMin ?? leg.durationMin) : leg.durationMin) ?? 0;
    if (leg.distanceKm === undefined) target.noKm += 1;
    else target.km += leg.distanceKm;
  }

  const gaps = dayGaps(schedule);
  const start = rows[0]!;
  const last = schedule.items.reduce((latest, row) => (row.end > latest.end ? row : latest), schedule.items[0]!);
  return {
    start: start.startLocal,
    end: last.endLocal,
    endDate: last.endDate,
    spanMin: Math.round((last.end - start.start) / 60_000),
    points: rows.length,
    moves: ORDER.flatMap((kind) => {
      const found = moves.get(kind);
      return found === undefined ? [] : [{ ...found, km: Math.round(found.km * 10) / 10 }];
    }),
    stays: (['sights', 'meals', 'other'] as const).flatMap((kind) => stays.get(kind) ?? []),
    freeMin: gaps.reduce((sum, gap) => sum + gap.minutes, 0),
    freeCount: gaps.length,
    bufferMin,
  };
}

export type TripStatistics = {
  days: number;
  points: number;
  moves: MoveStats[];
  stays: StayStats[];
  freeMin: number;
  /** Czas w ruchu łącznie (wszystkie środki, bez postojów). */
  movingMin: number;
  /** Dzień od pierwszej do ostatniej godziny planu najdłuższy, najwięcej km pieszo, największe podejście. */
  longestDay?: { date: string; spanMin: number };
  mostFoot?: { date: string; km: number };
  mostAscent?: { date: string; ascentM: number };
};

/** Statystyki całego wyjazdu: suma `dayStatistics` dni (te same warianty i scenariusz) i dni z rekordami. */
export function tripStatistics(doc: Doc, schedules: readonly DaySchedule[]): TripStatistics | null {
  const days = schedules.flatMap((schedule) => {
    const stats = dayStatistics(doc, schedule);
    return stats === null ? [] : [{ date: schedule.date, stats }];
  });
  if (days.length === 0) return null;
  const moves = new Map<MoveKind, MoveStats>();
  const stays = new Map<StayKind, StayStats>();
  let longestDay: TripStatistics['longestDay'];
  let mostFoot: TripStatistics['mostFoot'];
  let mostAscent: TripStatistics['mostAscent'];
  for (const { date, stats } of days) {
    for (const move of stats.moves) {
      const sum = moves.get(move.kind) ?? { kind: move.kind, count: 0, km: 0, noKm: 0, minutes: 0, stopsMin: 0, ascentM: 0, descentM: 0 };
      moves.set(move.kind, { kind: move.kind, count: sum.count + move.count, km: sum.km + move.km, noKm: sum.noKm + move.noKm, minutes: sum.minutes + move.minutes, stopsMin: sum.stopsMin + move.stopsMin, ascentM: sum.ascentM + move.ascentM, descentM: sum.descentM + move.descentM });
    }
    for (const stay of stats.stays) {
      const sum = stays.get(stay.kind) ?? { kind: stay.kind, count: 0, minutes: 0, untimed: 0 };
      stays.set(stay.kind, { kind: stay.kind, count: sum.count + stay.count, minutes: sum.minutes + stay.minutes, untimed: sum.untimed + stay.untimed });
    }
    if (longestDay === undefined || stats.spanMin > longestDay.spanMin) longestDay = { date, spanMin: stats.spanMin };
    const foot = stats.moves.find((move) => move.kind === 'foot');
    if (foot !== undefined && foot.km > 0 && (mostFoot === undefined || foot.km > mostFoot.km)) mostFoot = { date, km: foot.km };
    const ascentM = stats.moves.reduce((sum, move) => sum + move.ascentM, 0);
    if (ascentM > 0 && (mostAscent === undefined || ascentM > mostAscent.ascentM)) mostAscent = { date, ascentM };
  }
  const moveList = ORDER.flatMap((kind) => {
    const found = moves.get(kind);
    return found === undefined ? [] : [{ ...found, km: Math.round(found.km * 10) / 10 }];
  });
  return {
    days: days.length,
    points: days.reduce((sum, day) => sum + day.stats.points, 0),
    moves: moveList,
    stays: (['sights', 'meals', 'other'] as const).flatMap((kind) => stays.get(kind) ?? []),
    freeMin: days.reduce((sum, day) => sum + day.stats.freeMin, 0),
    movingMin: moveList.reduce((sum, move) => sum + move.minutes, 0),
    ...(longestDay ? { longestDay } : {}),
    ...(mostFoot ? { mostFoot } : {}),
    ...(mostAscent ? { mostAscent } : {}),
  };
}

/**
 * Warianty, z którymi liczą się statystyki dnia: wybrany wariant każdej grupy tego dnia („Bagaż: Skrytka przy
 * Pl. Catalunya”). `active` = `activeVariants` widoku planu; grupy na cały wyjazd, rezerwacji i ankiety pomija.
 */
export function dayVariantLabels(doc: Doc, dayRef: string, active: ReadonlySet<string>): string[] {
  return doc.variantGroups
    .filter((group) => group.dayRef === dayRef && group.scope !== 'trip' && group.scope !== 'booking' && group.scope !== 'poll')
    .flatMap((group) => {
      const chosen = doc.variants.find((variant) => variant.groupRef === group.ref && active.has(variant.ref));
      return chosen === undefined ? [] : [`${group.title}: ${chosen.label}`];
    });
}

/** „12,4 km · 3 h 10 min · ↑ 650 m ↓ 600 m · 4 odcinki (1 bez km) · postoje 30 min”. */
export function moveLine(stats: MoveStats): string {
  const parts = [
    stats.km > 0 ? formatKm(stats.km) : '',
    stats.minutes > 0 ? formatMinutes(stats.minutes) : '',
    stats.ascentM > 0 || stats.descentM > 0 ? [stats.ascentM > 0 ? `↑ ${stats.ascentM} m` : '', stats.descentM > 0 ? `↓ ${stats.descentM} m` : ''].filter(Boolean).join(' ') : '',
    `${plural(stats.count, ['odcinek', 'odcinki', 'odcinków'])}${stats.noKm > 0 ? ` (${stats.noKm} bez km)` : ''}`,
    stats.stopsMin > 0 ? `postoje ${formatMinutes(stats.stopsMin)}` : '',
  ];
  return parts.filter((part) => part !== '').join(' · ');
}

/** „6 punktów (2 bez czasu) · 5 h 20 min”. */
export function stayLine(stats: StayStats): string {
  const count = `${plural(stats.count, ['punkt', 'punkty', 'punktów'])}${stats.untimed > 0 && stats.untimed < stats.count ? ` (${stats.untimed} bez czasu)` : stats.untimed > 0 ? ' (bez czasu w planie)' : ''}`;
  return [count, stats.minutes > 0 ? formatMinutes(stats.minutes) : ''].filter(Boolean).join(' · ');
}
