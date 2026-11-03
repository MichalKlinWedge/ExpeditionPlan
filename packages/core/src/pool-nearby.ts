import { distanceKm } from './offline-areas.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * „Z puli w pobliżu” (SPECYFIKACJA M6): przy wolnym czasie — punkty z puli najbliżej bieżącej pozycji,
 * z dojściem pieszo i tym, czy mieszczą się przed następnym punktem dnia. Liczone offline z planu
 * (współrzędne miejsc), bez routingu: dojście = odległość w linii prostej × 1,3 przy 4,5 km/h.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type NearbyPoolItem = {
  item: Item;
  /** Nazwa miejsca (gdy inna niż tytuł punktu). */
  place?: string;
  km: number;
  walkMin: number;
  /** Czas pobytu z planu; brak = nie wiadomo (do „czy się zmieści” przyjmujemy 30 min). */
  stayMin?: number;
  /** Czy dojście + pobyt mieszczą się w wolnym czasie; `null` — wolny czas nieznany. */
  fits: boolean | null;
};

const DETOUR = 1.3;
const WALK_KMH = 4.5;
const UNKNOWN_STAY_MIN = 30;
/** Pula, której nie proponujemy w terenie: odrzucone i takie, które się nie mieszczą. */
const HIDDEN = new Set(['rejected', 'does_not_fit']);

export function poolNearby(
  doc: Doc,
  here: { lat: number; lng: number },
  { gapMin = null, limit = 5, maxKm = 5, exclude = [] }: { gapMin?: number | null; limit?: number; maxKm?: number; exclude?: readonly string[] } = {},
): NearbyPoolItem[] {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const skip = new Set(exclude);
  return doc.items
    .filter((item) => item.dayRef === undefined && !HIDDEN.has(item.planStatus) && !skip.has(item.ref))
    .flatMap((item): NearbyPoolItem[] => {
      const place = item.placeRef === undefined ? undefined : places.get(item.placeRef);
      if (place?.lat === undefined || place.lng === undefined) return [];
      const km = distanceKm(here, { lat: place.lat, lng: place.lng });
      if (km > maxKm) return [];
      const walkMin = Math.max(1, Math.round(((km * DETOUR) / WALK_KMH) * 60));
      const stayMin = item.durationMin;
      return [
        {
          item,
          ...(place.name !== item.title ? { place: place.name } : {}),
          km,
          walkMin,
          ...(stayMin !== undefined ? { stayMin } : {}),
          fits: gapMin === null ? null : walkMin + (stayMin ?? UNKNOWN_STAY_MIN) <= gapMin,
        },
      ];
    })
    .sort((a, b) => Number(b.fits === true) - Number(a.fits === true) || a.km - b.km)
    .slice(0, limit);
}
