import { type LngLat, type OsmFeature, TRACK_POI_RADIUS, type TrackLine, type TrackPoi, trackPoisFromOsm, trackQueryPoints } from '@expeditionplan/core';

import { bboxAround, OVERPASS_UA, OVERPASS_URL } from './transit-osm.ts';

/**
 * Woda, schroniska i zejścia awaryjne wzdłuż śladu GPX z OpenStreetMap — jedno zapytanie Overpass
 * na kliknięcie, jak linie komunikacji (`transit-osm.ts`; te same warunki serwera FOSSGIS:
 * identyfikujący User-Agent, e-mail operatora na stronie, podpis „© OpenStreetMap” przy liście).
 * Szukamy w pasie wokół śladu (`around` po uproszczonej linii), a odsiew i km od startu robi core.
 */

/**
 * Filtry Overpass i promień (m) — największy z rodzajów danej grupy. Źródła, krany, przystanki
 * i miejscowości to w OSM punkty (`node`), schroniska i wiaty bywają obrysami (`nwr`).
 */
const FILTERS: [string, number][] = [
  ['node[amenity~"^(drinking_water|water_point)$"]', TRACK_POI_RADIUS.drinking_water!],
  ['node[man_made=water_tap]', TRACK_POI_RADIUS.water_tap!],
  ['node[natural=spring]', TRACK_POI_RADIUS.spring!],
  ['nwr[tourism~"^(alpine_hut|wilderness_hut)$"]', TRACK_POI_RADIUS.alpine_hut!],
  ['nwr[amenity=shelter]', TRACK_POI_RADIUS.shelter!],
  ['nwr[emergency=mountain_rescue]', TRACK_POI_RADIUS.mountain_rescue!],
  ['node[highway=bus_stop]', TRACK_POI_RADIUS.bus_stop!],
  ['node[place~"^(village|hamlet|town)$"]', TRACK_POI_RADIUS.town!],
];

/** Sekundy dla serwera; zapytanie HTTP czeka chwilę dłużej. */
const SERVER_TIMEOUT_S = 45;

/**
 * Zapytanie: punkty i obrysy (środek) w pasie wokół linii (lat,lon), w prostokącie śladu — prostokąt
 * pozwala serwerowi użyć indeksu, zanim policzy odległość od linii.
 */
export function trackPoiQuery(points: readonly LngLat[]): string {
  const line = points.map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(',');
  const box = bboxAround(points, 2.5);
  const bbox = [box.south, box.west, box.north, box.east].map((value) => value.toFixed(5)).join(',');
  const parts = FILTERS.map(([filter, radius]) => `${filter}(around:${radius},${line});`);
  return [`[out:json][timeout:${SERVER_TIMEOUT_S}][maxsize:33554432][bbox:${bbox}];`, `(${parts.join(' ')});`, 'out center tags qt;'].join('\n');
}

type OverpassReply = { elements?: Element[]; remark?: string };
type Element = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Odpowiedź Overpass jako punkty z tagami (obrys — jego środek). */
export function parseTrackOverpass(json: unknown): OsmFeature[] {
  const response = (json ?? {}) as OverpassReply;
  // Przekroczony czas albo pamięć: serwer odsyła pustą listę z uwagą — to nie „nic przy śladzie”.
  if (response.remark !== undefined && /error|timed out/i.test(response.remark)) throw new Error('Serwer OpenStreetMap (Overpass) nie zdążył odpowiedzieć. Spróbuj za kilka minut.');
  const elements = response.elements ?? [];
  return elements.flatMap((element): OsmFeature[] => {
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    return lat === undefined || lng === undefined ? [] : [{ id: `${element.type}/${element.id}`, lat, lng, tags: element.tags ?? {} }];
  });
}

/** Punkty przy śladzie z Overpass. Błąd serwera (przeciążenie, 429) to wyjątek z polskim opisem. */
export async function fetchTrackPois(line: TrackLine, options: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<TrackPoi[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.url ?? OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': OVERPASS_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: trackPoiQuery(trackQueryPoints(line)) }).toString(),
    signal: AbortSignal.timeout(options.timeoutMs ?? (SERVER_TIMEOUT_S + 10) * 1000),
  });
  if ([429, 502, 503, 504].includes(response.status)) throw new Error('Serwer OpenStreetMap (Overpass) jest teraz zajęty. Spróbuj za minutę.');
  if (!response.ok) throw new Error(`Serwer OpenStreetMap (Overpass) odpowiedział błędem ${response.status}.`);
  return trackPoisFromOsm(line, parseTrackOverpass(await response.json()));
}
