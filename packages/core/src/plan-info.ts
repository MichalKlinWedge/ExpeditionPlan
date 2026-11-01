import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Co plan wie o mapie: skąd czas przejazdu (trasa czy szacunek), dystans, które miejsca mają
 * współrzędne. Ten sam opis na webie i w telefonie — bez tego wyniki „Przelicz przejazdy”
 * i „Uzupełnij współrzędne” widać tylko po przesuniętych godzinach.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

/** Tryby, dla których umiemy policzyć trasę (auto, pieszo, rower) — reszta to rozkład jazdy. */
export const ROUTABLE_MODES: ReadonlySet<string> = new Set(['car', 'rental_car', 'taxi', 'hired_driver', 'walk', 'hike', 'bike']);

/** 84 → „1 h 24 min”, 45 → „45 min”, 120 → „2 h”. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const km = (value: number) => `${value.toLocaleString('pl-PL', { maximumFractionDigits: value < 10 ? 1 : 0 })} km`;

/**
 * Opis przejazdu: „63,6 km · 1 h 24 min, w gorszym razie 1 h 49 min (trasa z mapy)” albo
 * „ok. 75 min, ok. 70 km (szacunek)”. Czas wpisany w punkt (edycja ręczna) wygrywa z `leg`
 * tak samo jak w silniku. `null` = punkt nie jest przejazdem albo nie ma czego pokazać.
 */
export function legLabel(item: Item): string | null {
  const leg = item.leg;
  if (item.kind !== 'transport' || leg === undefined) return null;
  if (item.durationMin !== undefined) return `${formatMinutes(item.durationMin)} (wpisane ręcznie)`;
  if (leg.routed && leg.durationMin !== undefined) {
    const worse = leg.durationMaxMin !== undefined && leg.durationMaxMin > leg.durationMin ? `, w gorszym razie ${formatMinutes(leg.durationMaxMin)}` : '';
    return `${leg.distanceKm !== undefined ? `${km(leg.distanceKm)} · ` : ''}${formatMinutes(leg.durationMin)}${worse} (trasa z mapy)`;
  }
  const parts = [leg.durationMin === undefined ? null : `ok. ${formatMinutes(leg.durationMin)}`, leg.distanceKm === undefined ? null : `ok. ${km(leg.distanceKm)}`].filter((part) => part !== null);
  return parts.length === 0 ? null : `${parts.join(', ')} (szacunek)`;
}

/** Miejsce punktu bez współrzędnych — nie ma go na mapie, nie policzy się do niego trasy. */
export function missingOnMap(doc: Doc, item: Item): boolean {
  if (item.placeRef === undefined) return false;
  const place = doc.places.find((each) => each.ref === item.placeRef);
  return place !== undefined && (place.lat === undefined || place.lng === undefined);
}

export type MapCoverage = {
  /** Miejsca użyte w planie (punkty, bazy dni, końce przejazdów) — ile ma współrzędne. */
  places: { onMap: number; total: number };
  /** Przejazdy autem/pieszo/rowerem — ile ma czas z trasy. */
  legs: { routed: number; routable: number };
};

export function mapCoverage(doc: Doc): MapCoverage {
  const used = new Set<string>();
  for (const item of doc.items) {
    for (const ref of [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]) if (ref !== undefined) used.add(ref);
  }
  for (const day of doc.days) if (day.baseRef !== undefined) used.add(day.baseRef);
  const places = doc.places.filter((place) => used.has(place.ref));
  const routable = doc.items.filter((item) => item.kind === 'transport' && item.leg !== undefined && ROUTABLE_MODES.has(item.leg.mode));
  return {
    places: { onMap: places.filter((place) => place.lat !== undefined && place.lng !== undefined).length, total: places.length },
    legs: { routed: routable.filter((item) => item.leg!.routed === true && item.durationMin === undefined).length, routable: routable.length },
  };
}
