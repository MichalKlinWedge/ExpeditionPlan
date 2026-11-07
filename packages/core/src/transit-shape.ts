import { isTransitItem } from './item-kind.ts';
import { legEnds } from './item-route.ts';
import { distanceM, encodePolyline, type LngLat, simplifyPath } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Linia przejazdu komunikacją na mapie dnia, z danych OpenStreetMap: relacje linii (`type=route`)
 * z ich drogami i przystankami. Z odcinków trasy wklejonej przez użytkownika (linia, skąd, dokąd)
 * bierzemy kawałek właściwej relacji między przystankami, a dojścia pieszo są prostymi. Czysta
 * geometria: zapytanie do Overpass robi `planner/src/transit-osm.ts`. Wynik idzie do `leg.geometry`
 * i rysuje się jak trasa z OpenRouteService (`dayMap`). Dane © OpenStreetMap (ODbL), docs/USLUGI.md.
 */

type Item = TripDocument['items'][number];
type Segment = NonNullable<NonNullable<Item['leg']>['segments']>[number];

/** Relacja linii z OSM: drogi w kolejności relacji i przystanki po kolei. */
export type OsmRoute = { id: number; ref: string; route: string; ways: LngLat[][]; stops: { name: string; at: LngLat }[] };

/** Jakie typy relacji OSM pasują do środka z planu. */
const ROUTE_TYPES: Record<string, readonly string[]> = {
  metro: ['subway', 'light_rail', 'monorail'],
  tram: ['tram', 'light_rail'],
  bus: ['bus', 'trolleybus', 'coach'],
  train: ['train', 'light_rail', 'subway', 'railway'],
  ferry: ['ferry'],
  cable_car: ['aerialway', 'funicular'],
};
export const OSM_ROUTE_TYPES = [...new Set(Object.values(ROUTE_TYPES).flat())];

/** Przystanek bywa w OSM z dopiskiem („Estació de Drassanes”, „Palau Reial (L3)”). */
const STOP_WORDS = new Set(['estacio', 'estacion', 'station', 'stacja', 'metro', 'parada', 'gare', 'bahnhof', 'de', 'del', 'la', 'el', 'l', 'd']);
const words = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && !STOP_WORDS.has(word));

/** Ta sama nazwa przystanku mimo dopisków i znaków diakrytycznych. */
export function sameStop(a: string, b: string): boolean {
  const left = words(a).join(' ');
  const right = words(b).join(' ');
  if (left === '' || right === '') return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

/** „R2 Nord” i „R2N”, „l3” i „L3”. */
const refKey = (ref: string) => ref.toLowerCase().replace(/[^a-z0-9]/g, '');
export const sameLine = (a: string, b: string) => {
  const left = refKey(a);
  const right = refKey(b);
  return left !== '' && (left === right || (right.length >= 2 && left.startsWith(right) && /^[a-z]+$/.test(left.slice(right.length))) || (left.length >= 2 && right.startsWith(left) && /^[a-z]+$/.test(right.slice(left.length))));
};

/** Drogi relacji w jedną linię; drogę zapisaną pod prąd odwracamy, żeby końce się stykały. */
export function chainWays(ways: readonly LngLat[][]): LngLat[] {
  const line: LngLat[] = [];
  for (const way of ways) {
    if (way.length < 2) continue;
    if (line.length === 0) {
      const next = ways[ways.indexOf(way) + 1];
      // Pierwsza droga: kierunek tak, żeby jej koniec dochodził do następnej.
      const flip = next !== undefined && next.length > 0 && Math.min(distanceM(way[0]!, next[0]!), distanceM(way[0]!, next.at(-1)!)) < Math.min(distanceM(way.at(-1)!, next[0]!), distanceM(way.at(-1)!, next.at(-1)!));
      line.push(...(flip ? [...way].reverse() : way));
      continue;
    }
    const end = line.at(-1)!;
    const forward = distanceM(end, way[0]!) <= distanceM(end, way.at(-1)!);
    const piece = forward ? way : [...way].reverse();
    line.push(...(piece[0]![0] === end[0] && piece[0]![1] === end[1] ? piece.slice(1) : piece));
  }
  return line;
}

/** Najbliższy wierzchołek linii; `null`, gdy dalej niż `maxM`. */
function nearestIndex(line: readonly LngLat[], point: LngLat, maxM: number): number | null {
  let best = -1;
  let bestM = maxM;
  line.forEach((vertex, index) => {
    const m = distanceM(vertex, point);
    if (m <= bestM) {
      best = index;
      bestM = m;
    }
  });
  return best === -1 ? null : best;
}

/** Przystanek nie dalej niż tyle od linii relacji (peron obok torów). */
const STOP_ON_LINE_M = 400;
/** Przystanek bez nazwy w odcinku: najbliższy temu miejscu, jeśli jest blisko. */
const NEAREST_STOP_M = 800;

/**
 * Kawałek linii jednego odcinka: relacja o tym numerze i środku, z oboma przystankami w dobrej
 * kolejności (relacje bywają osobne dla każdego kierunku). `near` = gdzie jesteśmy, gdy odcinek nie
 * podaje „skąd”. `null` = OSM nie ma tej linii albo przystanków.
 */
export function segmentLine(routes: readonly OsmRoute[], segment: Pick<Segment, 'mode' | 'line' | 'from' | 'to'>, near?: LngLat): LngLat[] | null {
  if (segment.line === undefined || segment.to === undefined) return null;
  const types = ROUTE_TYPES[segment.mode] ?? [];
  let best: { line: LngLat[]; m: number } | null = null;
  for (const route of routes) {
    if (!types.includes(route.route) || !sameLine(route.ref, segment.line)) continue;
    const toIndex = route.stops.findIndex((stop) => sameStop(stop.name, segment.to!));
    if (toIndex === -1) continue;
    let fromIndex = segment.from === undefined ? -1 : route.stops.findIndex((stop, index) => index < toIndex && sameStop(stop.name, segment.from!));
    if (fromIndex === -1 && segment.from === undefined && near !== undefined) {
      const candidates = route.stops.slice(0, toIndex).map((stop, index) => ({ index, m: distanceM(stop.at, near) })).filter((each) => each.m <= NEAREST_STOP_M);
      fromIndex = candidates.sort((a, b) => a.m - b.m)[0]?.index ?? -1;
    }
    if (fromIndex === -1) continue;
    const line = chainWays(route.ways);
    const a = nearestIndex(line, route.stops[fromIndex]!.at, STOP_ON_LINE_M);
    const b = nearestIndex(line, route.stops[toIndex]!.at, STOP_ON_LINE_M);
    if (a === null || b === null || a === b) continue;
    const piece = a < b ? line.slice(a, b + 1) : line.slice(b, a + 1).reverse();
    const cut = [route.stops[fromIndex]!.at, ...piece, route.stops[toIndex]!.at];
    // Najkrótszy pasujący kawałek: przy linii okrężnej albo relacji z odnogami dłuższy byłby objazdem.
    const m = cut.slice(1).reduce((sum, point, index) => sum + distanceM(cut[index]!, point), 0);
    if (best === null || m < best.m) best = { line: cut, m };
  }
  return best?.line ?? null;
}

export type TransitShape = { geometry: string; matched: number; total: number };

/**
 * Linia całego przejazdu: od `start` przez kawałki linii z OSM do `end`. Dojścia pieszo i odcinki,
 * których OSM nie zna, łączą sąsiednie punkty prostą. `null` = żaden odcinek nie dał się znaleźć —
 * wtedy mapa zostaje przy prostej, jak dotąd.
 */
export function transitShape(segments: readonly Segment[], start: LngLat, end: LngLat, routes: readonly OsmRoute[]): TransitShape | null {
  const points: LngLat[] = [start];
  const rides = segments.filter((segment) => segment.mode !== 'walk');
  let matched = 0;
  for (const segment of rides) {
    const line = segmentLine(routes, segment, points.at(-1));
    if (line === null) continue;
    matched += 1;
    points.push(...line);
  }
  if (matched === 0) return null;
  points.push(end);
  return { geometry: encodePolyline(simplifyPath(points, 8)), matched, total: rides.length };
}

/** Linie do zapytania o relacje: numery odcinków, które nie są pieszo. */
export const transitRefs = (segments: readonly Segment[]): string[] => [...new Set(segments.filter((segment) => segment.mode !== 'walk' && segment.line).map((segment) => segment.line!))];

/** Co trzeba pobrać z OSM dla punktu: numery linii i końce przejazdu. `null` = brak odcinków z linią albo końców na mapie. */
export function transitShapeRequest(doc: TripDocument, item: Item): { refs: string[]; start: LngLat; end: LngLat } | null {
  const segments = item.leg?.segments ?? [];
  const refs = transitRefs(segments);
  if (!isTransitItem(item) || refs.length === 0) return null;
  const { from, to } = legEnds(doc, item);
  if (from === undefined || to === undefined) return null;
  return { refs, start: [from.lng, from.lat], end: [to.lng, to.lat] };
}

/** Zapisuje linię z OSM w przejeździe. `null` = nie ma czego rysować; `shape: null` = OSM nie zna żadnej linii, stara linia znika. */
export function applyTransitShape(doc: TripDocument, itemRef: string, routes: readonly OsmRoute[]): { doc: TripDocument; item: Item; shape: TransitShape | null } | null {
  const item = doc.items.find((each) => each.ref === itemRef);
  const request = item === undefined ? null : transitShapeRequest(doc, item);
  if (item === undefined || request === null || item.leg === undefined) return null;
  const shape = transitShape(item.leg.segments ?? [], request.start, request.end, routes);
  const { geometry: _geometry, ...leg } = item.leg;
  const next: Item = { ...item, leg: shape === null ? leg : { ...leg, geometry: shape.geometry } };
  return { doc: { ...doc, items: doc.items.map((each) => (each.ref === itemRef ? next : each)) }, item: next, shape };
}
