import type { LatLng } from './coordinates.ts';
import { legEnds } from './item-route.ts';
import { decodePolyline, type LngLat } from './polyline.ts';
import type { TripDocument } from './schemas/trip-document.ts';

/**
 * Mapa jednego punktu planu (szczegóły punktu na telefonie): miejsce punktu, a przy przejeździe —
 * start, cel, postoje w trasie i linia. Linia: ślad z „Tras” (`activity.trackRef` pieszo, `leg.trackRef`
 * autem), potem przebieg zapisany w przejeździe (`leg.geometry`), a bez nich prosta od startu do celu.
 * Start i cel bez własnego „skąd/dokąd” bierze się z sąsiadów dnia jak link trasy (`legEnds`), a przy
 * śladzie bez końców w planie — z pierwszego i ostatniego punktu śladu. Nic nie jest zapisywane.
 */

type Doc = TripDocument;
type Item = Doc['items'][number];

export type ItemMapPoint = { kind: 'place' | 'start' | 'end' | 'stop'; name: string; lat: number; lng: number };
export type ItemMap = {
  points: ItemMapPoint[];
  /** Linie [lng, lat]; `straight` — bez zapisanego przebiegu, sama prosta start → cel. */
  lines: { coordinates: LngLat[]; straight: boolean; foot: boolean }[];
};

const FOOT_MODES: ReadonlySet<string> = new Set(['walk', 'hike', 'bike']);

const same = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

export function itemMap(doc: Doc, item: Item): ItemMap {
  const places = new Map(doc.places.map((place) => [place.ref, place]));
  const tracks = new Map(doc.tracks.map((track) => [track.ref, track]));
  const located = (ref: string | undefined) => {
    const place = ref === undefined ? undefined : places.get(ref);
    return place?.lat === undefined || place.lng === undefined ? undefined : { name: place.name, lat: place.lat, lng: place.lng };
  };
  const points: ItemMapPoint[] = [];
  const lines: ItemMap['lines'] = [];

  const trackRef = item.kind === 'transport' ? (item.leg?.trackRef ?? item.activity?.trackRef) : item.activity?.trackRef;
  const track = trackRef === undefined ? undefined : tracks.get(trackRef);
  const trackLine = track?.geojson?.coordinates.map((point) => [point[0]!, point[1]!] as LngLat);
  const leg = item.kind === 'transport' ? item.leg : undefined;
  const foot = leg === undefined ? track?.route?.mode !== 'car' : FOOT_MODES.has(leg.mode);

  if (leg === undefined && trackLine === undefined) {
    const place = located(item.placeRef);
    if (place !== undefined) points.push({ kind: 'place', ...place });
    return { points, lines };
  }

  // Przejazd albo aktywność ze śladem: start i cel.
  const guessed = leg === undefined ? {} : legEnds(doc, item);
  const fromPlace = located(leg?.fromPlaceRef);
  const toPlace = located(leg === undefined ? undefined : (leg.toPlaceRef ?? item.placeRef));
  const lineFirst = trackLine?.[0];
  const lineLast = trackLine?.at(-1);
  const from = fromPlace ?? (guessed.from ? { name: 'Start', ...guessed.from } : undefined) ?? (track?.route?.from ? { ...track.route.from } : undefined) ?? (lineFirst ? { name: 'Start', lng: lineFirst[0], lat: lineFirst[1] } : undefined);
  const to = toPlace ?? (guessed.to ? { name: 'Cel', ...guessed.to } : undefined) ?? (track?.route?.to ? { ...track.route.to } : undefined) ?? (lineLast ? { name: 'Cel', lng: lineLast[0], lat: lineLast[1] } : undefined);

  if (trackLine !== undefined) lines.push({ coordinates: trackLine, straight: false, foot });
  else if (leg?.geometry !== undefined) {
    const route = decodePolyline(leg.geometry);
    if (route.length >= 2) lines.push({ coordinates: route, straight: false, foot });
  }
  if (lines.length === 0 && from !== undefined && to !== undefined && !same(from, to)) {
    lines.push({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]], straight: true, foot });
  }

  // Pętla (start = cel) — jedna pinezka startu.
  if (from !== undefined) points.push({ kind: 'start', ...from });
  if (to !== undefined && (from === undefined || !same(from, to))) points.push({ kind: 'end', ...to });
  // Aktywność ze śladem ma też własne miejsce (np. szczyt) — gdy nie jest startem ani celem.
  if (leg === undefined) {
    const place = located(item.placeRef);
    if (place !== undefined && !points.some((point) => same(point, place))) points.push({ kind: 'place', ...place });
  }
  // Postoje w trasie: podpunkty przejazdu z miejscem (także wspólne dla wariantów, `routeParentRefs`).
  if (leg !== undefined) {
    for (const child of doc.items) {
      if (child.parentRef !== item.ref && !child.routeParentRefs.includes(item.ref)) continue;
      const place = located(child.placeRef);
      if (place !== undefined && !points.some((point) => same(point, place))) points.push({ kind: 'stop', ...place, name: child.title });
    }
  }
  return { points, lines };
}
