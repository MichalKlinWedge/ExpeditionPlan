import { type LngLat, OSM_ROUTE_TYPES, type OsmRoute } from '@expeditionplan/core';

/**
 * Relacje linii komunikacji z OpenStreetMap przez Overpass API (serwer FOSSGIS, overpass-api.de).
 * Warunki (docs/USLUGI.md): identyfikujący User-Agent, jedno zapytanie naraz, małe użycie
 * (jedno zapytanie na kliknięcie), podpis „© OpenStreetMap” z linkiem „zgłoś błąd” przy mapie
 * i e-mail operatora na stronie. Adres serwera z konfiguracji, nie wpisany na sztywno.
 */

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const UA = 'ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)';

export type Bbox = { south: number; west: number; north: number; east: number };

/** Prostokąt wokół punktów z zapasem; dalekie końce (pociąg na lotnisko) mieszczą się w nim oba. */
export function bboxAround(points: readonly LngLat[], marginKm = 3): Bbox {
  const lat = points.map((point) => point[1]);
  const lng = points.map((point) => point[0]);
  const dLat = marginKm / 111;
  const mid = (Math.min(...lat) + Math.max(...lat)) / 2;
  const dLng = marginKm / (111 * Math.max(0.2, Math.cos((mid * Math.PI) / 180)));
  return { south: Math.min(...lat) - dLat, west: Math.min(...lng) - dLng, north: Math.max(...lat) + dLat, east: Math.max(...lng) + dLng };
}

/** Ucieczka znaku regex wewnątrz napisu Overpass QL: w napisie odwrotny ukośnik też trzeba podwoić. */
const regexEscape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|"]/g, (char) => `\\\\${char}`);

/**
 * Zapytanie: relacje linii o tych numerach w prostokącie, z geometrią dróg, i ich przystanki z nazwami.
 * `types` — dla odcinków bez numeru wszystkie relacje tych typów (tory, tramwaje) w prostokącie.
 */
export function overpassQuery(refs: readonly string[], bbox: Bbox, types: readonly string[] = []): string {
  // „R2 Nord” bywa w OSM jako „R2N”: szukamy po początku numeru, dokładne dopasowanie robi `sameLine`.
  const pattern = refs.map((ref) => regexEscape(ref.split(/\s+/)[0]!)).join('|');
  const box = [bbox.south, bbox.west, bbox.north, bbox.east].map((value) => value.toFixed(5)).join(',');
  const parts = [
    ...(refs.length > 0 ? [`rel[type=route][route~"^(${OSM_ROUTE_TYPES.join('|')})$"][ref~"^(${pattern})",i](${box});`] : []),
    ...(types.length > 0 ? [`rel[type=route][route~"^(${types.map(regexEscape).join('|')})$"](${box});`] : []),
  ];
  return ['[out:json][timeout:25][maxsize:67108864];', `(${parts.join(' ')})->.lines;`, '.lines out geom;', 'node(r.lines);', 'out;'].join('\n');
}

type Element =
  | { type: 'relation'; id: number; tags?: Record<string, string>; members?: { type: string; ref: number; role: string; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[] }[] }
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
  | { type: 'way'; id: number };

/** Odpowiedź Overpass jako relacje: drogi (bez peronów) i przystanki z nazwą, po kolei. */
export function parseOverpass(json: unknown): OsmRoute[] {
  const elements = ((json as { elements?: Element[] } | null)?.elements ?? []) as Element[];
  const names = new Map<number, string>();
  for (const element of elements) if (element.type === 'node' && element.tags?.name) names.set(element.id, element.tags.name);
  return elements.flatMap((element): OsmRoute[] => {
    if (element.type !== 'relation' || !element.tags?.route) return [];
    const members = element.members ?? [];
    const ways = members
      .filter((member) => member.type === 'way' && !member.role.startsWith('platform') && !member.role.startsWith('stop') && (member.geometry?.length ?? 0) >= 2)
      .map((member) => member.geometry!.map((point): LngLat => [point.lon, point.lat]));
    const stops: OsmRoute['stops'] = [];
    for (const member of members) {
      if (member.type !== 'node' || !(member.role.startsWith('stop') || member.role.startsWith('platform')) || member.lat === undefined || member.lon === undefined) continue;
      const name = names.get(member.ref);
      // Stanowisko i peron tego samego przystanku stoją obok siebie w relacji: jeden wpis.
      if (name === undefined || stops.at(-1)?.name === name) continue;
      stops.push({ name, at: [member.lon, member.lat] });
    }
    // Relacja bez przystanków (sam przebieg) też się przydaje: kawałek torów między końcami przejazdu.
    return ways.length === 0 ? [] : [{ id: element.id, ref: element.tags.ref ?? '', route: element.tags.route, ways, stops }];
  });
}

/** Relacje linii z Overpass. Błąd serwera (przeciążenie, 429) to wyjątek z polskim opisem. */
export async function fetchOsmRoutes(
  refs: readonly string[],
  bbox: Bbox,
  options: { url?: string; fetchImpl?: typeof fetch; timeoutMs?: number; types?: readonly string[] } = {},
): Promise<OsmRoute[]> {
  const types = options.types ?? [];
  if (refs.length === 0 && types.length === 0) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.url ?? OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: overpassQuery(refs, bbox, types) }).toString(),
    signal: AbortSignal.timeout(options.timeoutMs ?? 40_000),
  });
  if ([429, 502, 503, 504].includes(response.status)) throw new Error('Serwer OpenStreetMap (Overpass) jest teraz zajęty. Spróbuj za minutę.');
  if (!response.ok) throw new Error(`Serwer OpenStreetMap (Overpass) odpowiedział błędem ${response.status}.`);
  return parseOverpass(await response.json());
}
