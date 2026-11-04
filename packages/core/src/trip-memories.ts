import { isRouteStop } from './route-stops.ts';
import { itemsForDay, type ScheduleOptions } from './engine/schedule.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Pamiątka po wyjeździe — liczby z planu i z terenu: punkty zrobione i pominięte (zdarzenia z telefonu),
 * kilometry pieszo (z przewyższeniem), autem i komunikacją oraz kolejność punktów do mapy całej trasy.
 * Liczą się aktywne warianty i punkty wstawione w terenie z puli, pominięte nie dodają kilometrów.
 * Wydatki i dziennik dochodzą osobno (dane spoza dokumentu).
 */

type Doc = TripDocument;

export type TripMemories = {
  days: number;
  /** Punkty dni (bez podpunktów i bez puli). */
  planned: number;
  done: number;
  skipped: number;
  footKm: number;
  ascentM: number;
  driveKm: number;
  transitKm: number;
  flightKm: number;
  /** Punkty po kolei przez cały wyjazd (dzień po dniu) — do `dayMap` całej trasy. */
  routeRefs: string[];
};

const FOOT = new Set(['walk', 'hike', 'bike']);
const DRIVE = new Set(['car', 'rental_car', 'taxi', 'hired_driver']);

export function tripMemories(doc: Doc, field: Pick<ScheduleOptions, 'activeVariants' | 'pulled'> & { done: readonly { itemRef: string }[]; skipRefs: readonly string[] }): TripMemories {
  const days = [...doc.days].sort((a, b) => a.date.localeCompare(b.date));
  const options = { ...(field.activeVariants ? { activeVariants: field.activeVariants } : {}), ...(field.pulled ? { pulled: field.pulled } : {}) };
  const items = days.flatMap((day) => itemsForDay(doc, day.ref, options)).filter((item) => item.parentRef === undefined || isRouteStop(doc, item));
  const done = new Set(field.done.map((each) => each.itemRef));
  const skipped = new Set(field.skipRefs);
  const tracks = new Map(doc.tracks.map((track) => [track.ref, track]));
  const out: TripMemories = { days: days.length, planned: items.length, done: 0, skipped: 0, footKm: 0, ascentM: 0, driveKm: 0, transitKm: 0, flightKm: 0, routeRefs: [] };
  for (const item of items) {
    if (skipped.has(item.ref)) {
      out.skipped += 1;
      continue;
    }
    if (done.has(item.ref)) out.done += 1;
    out.routeRefs.push(item.ref);
    const leg = item.leg;
    if (leg?.distanceKm !== undefined) {
      if (FOOT.has(leg.mode)) out.footKm += leg.distanceKm;
      else if (DRIVE.has(leg.mode)) out.driveKm += leg.distanceKm;
      else if (leg.mode === 'flight') out.flightKm += leg.distanceKm;
      else out.transitKm += leg.distanceKm;
    }
    // Wędrówka: dystans z punktu albo z jego śladu.
    const track = item.activity?.trackRef ? tracks.get(item.activity.trackRef) : undefined;
    const km = item.activity?.distanceKm ?? track?.distanceKm;
    if (km !== undefined && leg === undefined) out.footKm += km;
    out.ascentM += item.activity?.ascentM ?? track?.ascentM ?? 0;
  }
  const round = (km: number) => Math.round(km * 10) / 10;
  return { ...out, footKm: round(out.footKm), driveKm: round(out.driveKm), transitKm: round(out.transitKm), flightKm: round(out.flightKm) };
}
