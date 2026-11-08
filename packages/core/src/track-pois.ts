import { projectOnSegment, simplifyTrack, type TrackLine, type TrackPoint } from './gpx.ts';
import { distanceM, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Woda, schroniska i zejścia awaryjne wzdłuż śladu GPX z OpenStreetMap (Overpass, na kliknięcie —
 * `planner/src/track-osm.ts`). Tu: co z OSM jest czym, jak daleko od śladu wolno szukać, km od startu
 * i przerzedzenie, żeby lista była do czytania w terenie (offline, z planu).
 */

type Track = TripDocument['tracks'][number];
export type TrackPois = NonNullable<Track['pois']>;
export type TrackPoi = TrackPois['items'][number];
export type TrackPoiKind = TrackPoi['kind'];

/** Element OSM sprowadzony do punktu: id (`node/123`), współrzędne i tagi. */
export type OsmFeature = { id: string; lat: number; lng: number; tags: Record<string, string> };

export const TRACK_POI_KIND: Record<TrackPoiKind, string> = { water: 'woda', shelter: 'schronienie', exit: 'zejście awaryjne' };

export const TRACK_POI_TYPE: Record<string, string> = {
  drinking_water: 'woda pitna',
  water_point: 'punkt poboru wody',
  water_tap: 'kran',
  spring: 'źródło',
  alpine_hut: 'schronisko',
  wilderness_hut: 'chatka',
  shelter: 'wiata',
  village: 'wieś',
  hamlet: 'przysiółek',
  town: 'miasto',
  bus_stop: 'przystanek',
  mountain_rescue: 'ratownictwo górskie',
};

/** Jak daleko od śladu (m) szukać danego rodzaju: wioska może być dalej niż źródło. */
export const TRACK_POI_RADIUS: Record<string, number> = {
  drinking_water: 300,
  water_point: 300,
  water_tap: 300,
  spring: 300,
  alpine_hut: 500,
  wilderness_hut: 500,
  shelter: 300,
  village: 1500,
  hamlet: 1000,
  town: 2000,
  bus_stop: 500,
  mountain_rescue: 2000,
};

/** Rodzaj punktu z tagów OSM; `null` — nie nasz (np. wiata przystanku). */
export function classifyOsm(tags: Record<string, string>): { kind: TrackPoiKind; type: string; potable?: boolean } | null {
  const potable = tags.drinking_water === 'yes' ? true : tags.drinking_water === 'no' ? false : undefined;
  const water = (type: string, fallback?: boolean) => ({ kind: 'water' as const, type, ...((potable ?? fallback) !== undefined ? { potable: (potable ?? fallback)! } : {}) });
  if (tags.amenity === 'drinking_water') return water('drinking_water', true);
  if (tags.amenity === 'water_point') return water('water_point');
  if (tags.man_made === 'water_tap') return water('water_tap');
  if (tags.natural === 'spring') return water('spring');
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') return { kind: 'shelter', type: tags.tourism };
  if (tags.amenity === 'shelter') return tags.shelter_type === 'public_transport' ? null : { kind: 'shelter', type: 'shelter' };
  if (tags.emergency === 'mountain_rescue') return { kind: 'exit', type: 'mountain_rescue' };
  if (tags.highway === 'bus_stop') return { kind: 'exit', type: 'bus_stop' };
  if (tags.place === 'village' || tags.place === 'hamlet' || tags.place === 'town') return { kind: 'exit', type: tags.place };
  return null;
}

/** Km od startu śladu i odległość punktu od śladu (m). */
export function placeOnTrack(line: TrackLine, at: { lat: number; lng: number }): { km: number; offM: number } {
  const points = line.coordinates;
  const point: LngLat = [at.lng, at.lat];
  const flat = (each: TrackPoint): LngLat => [each[0], each[1]];
  let best = { offM: Infinity, km: 0 };
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distanceM(flat(points[i - 1]!), flat(points[i]!));
    const { offM, t } = projectOnSegment(point, flat(points[i - 1]!), flat(points[i]!));
    if (offM < best.offM) best = { offM, km: (meters + length * t) / 1000 };
    meters += length;
  }
  return { km: Math.round(best.km * 10) / 10, offM: Math.round(best.offM) };
}

/** Uproszczony ślad do zapytania Overpass (`around` po linii): mało punktów, błąd do ~40 m. */
export function trackQueryPoints(line: TrackLine, maxPoints = 80): LngLat[] {
  return simplifyTrack(line.coordinates, maxPoints, 40).map((point) => [point[0], point[1]]);
}

/** Najwięcej punktów na liście; zejścia — najwyżej jedno na km śladu, najbliższe. */
const MAX_POIS = 60;

/** Punkty OSM przy śladzie, po kolei od startu: bez dalekich, bez powtórzeń i bez nadmiaru wiosek. */
export function trackPoisFromOsm(line: TrackLine, features: readonly OsmFeature[]): TrackPoi[] {
  const found: TrackPoi[] = [];
  for (const feature of features) {
    const kind = classifyOsm(feature.tags);
    if (kind === null) continue;
    const where = placeOnTrack(line, feature);
    if (where.offM > (TRACK_POI_RADIUS[kind.type] ?? 300)) continue;
    const name = feature.tags.name?.trim();
    found.push({ ...kind, ...(name ? { name } : {}), lat: Math.round(feature.lat * 1e5) / 1e5, lng: Math.round(feature.lng * 1e5) / 1e5, ...where, osmId: feature.id });
  }
  found.sort((a, b) => a.km - b.km || a.offM - b.offM);
  const kept: TrackPoi[] = [];
  for (const poi of found) {
    // Ta sama rzecz dwa razy (węzeł i obrys, źródło i kran obok): ten sam rodzaj w promieniu 100 m.
    if (kept.some((each) => each.kind === poi.kind && distanceM([each.lng, each.lat], [poi.lng, poi.lat]) < 100)) continue;
    // Zejścia: jedno na kilometr śladu — najbliższe śladu.
    if (poi.kind === 'exit') {
      const rival = kept.findIndex((each) => each.kind === 'exit' && Math.floor(each.km) === Math.floor(poi.km));
      if (rival >= 0) {
        if (kept[rival]!.offM > poi.offM) kept[rival] = poi;
        continue;
      }
    }
    kept.push(poi);
  }
  return kept.sort((a, b) => a.km - b.km).slice(0, MAX_POIS);
}

/** Zapisuje punkty przy śladzie; `null` — nie ma takiego śladu albo nie ma linii. */
export function setTrackPois(doc: TripDocument, trackRef: string, items: TrackPoi[], today: string): { doc: TripDocument; track: Track } | null {
  const current = doc.tracks.find((track) => track.ref === trackRef);
  if (current?.geojson === undefined) return null;
  const track: Track = { ...current, pois: { fetchedAt: today, items } };
  return { doc: { ...doc, tracks: doc.tracks.map((each) => (each.ref === trackRef ? track : each)) }, track };
}

/** Linia GeoJSON śladu z planu jako `TrackLine` (schemat dopuszcza 2–3 liczby w punkcie). */
export const trackLine = (track: Pick<Track, 'geojson'>): TrackLine | undefined => track.geojson as TrackLine | undefined;
