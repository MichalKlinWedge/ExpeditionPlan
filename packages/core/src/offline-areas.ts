import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Obszary mapy offline wyjazdu (telefon): jedna paczka przeglądowa całej trasy i paczki dokładne
 * wokół skupisk miejsc planu. Warunki OpenFreeMap (docs/USLUGI.md): najwyżej 3000 kafli na jedno
 * pobranie — każdy obszar dostaje najwyższy zoom, przy którym się mieści.
 */

type Doc = TripDocument;
/** [zachód, południe, wschód, północ] w stopniach. */
export type Bounds = [number, number, number, number];
export type MapArea = { key: string; label: string; bounds: Bounds; minZoom: number; maxZoom: number; tiles: number };

/** Liczba kafli w prostokącie dla zakresu zoomu (schemat XYZ). */
export function tileCount(bounds: Bounds, minZoom: number, maxZoom: number): number {
  const [west, south, east, north] = bounds;
  const x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const y = (lat: number, z: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  };
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) total += (x(east, z) - x(west, z) + 1) * (y(south, z) - y(north, z) + 1);
  return total;
}

/** Najwyższy zoom (≤ `ceiling`), przy którym paczka mieści się w limicie kafli. */
export function maxZoomWithin(bounds: Bounds, minZoom: number, limit: number, ceiling = 16): number {
  let zoom = minZoom;
  while (zoom < ceiling && tileCount(bounds, minZoom, zoom + 1) <= limit) zoom++;
  return zoom;
}

/** Odległość w km (wzór haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function boundsOf(points: { lat: number; lng: number }[], padKm: number): Bounds {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const padLat = padKm / 111;
  const padLng = padKm / (111 * Math.cos((((south + north) / 2) * Math.PI) / 180));
  return [Math.min(...lngs) - padLng, south - padLat, Math.max(...lngs) + padLng, north + padLat];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export type AreaOptions = {
  tileLimit?: number;
  /** Miejsca dalej niż tyle od środka wyjazdu (mediana) nie wchodzą — np. lotnisko w domu. */
  outlierKm?: number;
  /** Miejsca bliżej siebie niż tyle łączą się w jedno skupisko (jedna paczka dokładna). */
  clusterKm?: number;
  maxDetailAreas?: number;
};

/**
 * Obszary do pobrania: „Cała trasa” (zoom przeglądowy) i skupiska miejsc (zoom do chodzenia po
 * mieście). Skupisko nazywa się od bazy noclegowej, inaczej od miejsca z największą liczbą punktów.
 */
export function tripMapAreas(doc: Doc, options: AreaOptions = {}): MapArea[] {
  const { tileLimit = 3000, outlierKm = 600, clusterKm = 12, maxDetailAreas = 8 } = options;
  const uses = new Map<string, number>();
  for (const item of doc.items) {
    for (const ref of [item.placeRef, item.leg?.fromPlaceRef, item.leg?.toPlaceRef]) if (ref !== undefined) uses.set(ref, (uses.get(ref) ?? 0) + 1);
  }
  const bases = new Set(doc.days.flatMap((day) => (day.baseRef === undefined ? [] : [day.baseRef])));
  const located = doc.places.flatMap((place) =>
    place.lat !== undefined && place.lng !== undefined && (uses.has(place.ref) || bases.has(place.ref)) ? [{ ref: place.ref, name: place.name, lat: place.lat, lng: place.lng }] : [],
  );
  if (located.length === 0) return [];
  const center = { lat: median(located.map((place) => place.lat)), lng: median(located.map((place) => place.lng)) };
  const places = located.filter((place) => distanceKm(place, center) <= outlierKm);

  // Skupiska: łączenie pojedyncze (miejsce dołącza do każdego skupiska, do którego ma blisko).
  const clusters: (typeof places)[] = [];
  for (const place of places) {
    const near = clusters.filter((cluster) => cluster.some((other) => distanceKm(place, other) <= clusterKm));
    const merged = [place, ...near.flat()];
    for (const cluster of near) clusters.splice(clusters.indexOf(cluster), 1);
    clusters.push(merged);
  }
  const weight = (cluster: typeof places) => cluster.reduce((sum, place) => sum + (uses.get(place.ref) ?? 0) + (bases.has(place.ref) ? 5 : 0), 0);
  const detail = clusters
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, maxDetailAreas)
    .map((cluster, index) => {
      const bounds = boundsOf(cluster, 2);
      const minZoom = 11;
      const maxZoom = maxZoomWithin(bounds, minZoom, tileLimit);
      const named = cluster.find((place) => bases.has(place.ref)) ?? [...cluster].sort((a, b) => (uses.get(b.ref) ?? 0) - (uses.get(a.ref) ?? 0))[0]!;
      return { key: `detail-${index}`, label: named.name, bounds, minZoom, maxZoom, tiles: tileCount(bounds, minZoom, maxZoom) };
    });

  const overviewBounds = boundsOf(places, 15);
  const overviewMin = 5;
  const overviewMax = Math.min(maxZoomWithin(overviewBounds, overviewMin, tileLimit), 12);
  const overview = { key: 'overview', label: 'Cała trasa', bounds: overviewBounds, minZoom: overviewMin, maxZoom: overviewMax, tiles: tileCount(overviewBounds, overviewMin, overviewMax) };
  return [overview, ...detail];
}
