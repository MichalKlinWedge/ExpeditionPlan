import { type MapArea, tripMapAreas, type TripDocument } from '@expeditionplan/core';

/**
 * „✈ Dojazd i powrót” w zakładce Mapa — zapamiętany dla wyjazdu. Wyłączony (domyślnie) chowa
 * miejsca tylko dojazdu i powrotu (lotnisko w domu), więc mapa skupia się na miejscu, a mapa
 * offline (`tripMapAreas`) pobiera tylko obszar podróży. Ten sam wybór czyta „Pobierz wyjazd offline”.
 */

const KEY = (tripId: string) => `map_transit_${tripId}`;

export function mapTransit(tripId: string): boolean {
  try {
    return localStorage.getItem(KEY(tripId)) === '1';
  } catch {
    return false;
  }
}

export function setMapTransit(tripId: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY(tripId), '1');
    else localStorage.removeItem(KEY(tripId));
  } catch {
    // Bez zapisu przełącznik wraca do „wyłączony” przy następnym otwarciu.
  }
}

/** Obszary mapy offline wyjazdu zgodnie z przełącznikiem dojazdu. */
export const offlineAreas = (tripId: string, doc: TripDocument): MapArea[] => tripMapAreas(doc, { transit: mapTransit(tripId) });
