import { distanceM, type LngLat } from './polyline.ts';

/**
 * Ślady GPX (Etap 7): odczyt pliku, statystyki, uproszczenie do zapisu w planie i położenie
 * na śladzie w terenie. Bez parsera XML (Deno, Hermes, przeglądarka) — GPX to proste znaczniki
 * `trkpt`/`rtept` z `lat`/`lon` i opcjonalnym `ele`. Czas przejścia wg DIN 33466: 4 km/h
 * w poziomie, 300 m/h w górę, 500 m/h w dół; dłuższy z czasów + połowa krótszego.
 */

/** Punkt śladu: [lng, lat] albo [lng, lat, wysokość m]. */
export type TrackPoint = [number, number] | [number, number, number];
export type TrackLine = { type: 'LineString'; coordinates: TrackPoint[] };
export type GpxTrack = { name: string | null; points: TrackPoint[] };
export type TrackStats = { distanceKm: number; ascentM: number | null; descentM: number | null; durationMin: number };

const attribute = (attrs: string, name: string) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([-+\\d.eE]+)["']`).exec(attrs);
  return match === null ? NaN : Number(match[1]);
};

/** Punkty śladu (`trkpt`, a gdy ich nie ma — `rtept`) i nazwa; pusty ślad = błąd. */
export function parseGpx(xml: string): GpxTrack {
  const read = (tag: 'trkpt' | 'rtept') => {
    const points: TrackPoint[] = [];
    const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g');
    for (const match of xml.matchAll(pattern)) {
      const lat = attribute(match[1] ?? '', 'lat');
      const lng = attribute(match[1] ?? '', 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      const ele = /<ele>\s*([-+\d.eE]+)\s*<\/ele>/.exec(match[2] ?? '');
      const height = ele === null ? NaN : Number(ele[1]);
      points.push(Number.isFinite(height) ? [lng, lat, height] : [lng, lat]);
    }
    return points;
  };
  const track = read('trkpt');
  const points = track.length > 0 ? track : read('rtept');
  if (points.length < 2) throw new Error('W pliku nie ma śladu (punktów trkpt ani rtept).');
  const name = /<(?:trk|rte)\b[^>]*>[\s\S]*?<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/.exec(xml)?.[1]?.trim();
  return { name: name ? decodeEntities(name) : null, points };
}

const decodeEntities = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const flat = (point: TrackPoint): LngLat => [point[0], point[1]];

/**
 * Podejścia i zejścia po punktach zwrotnych: zmiana kierunku liczy się dopiero, gdy wysokość
 * odejdzie od szczytu (dołka) o `thresholdM` — szum GPS i barometru nie dokłada metrów.
 */
function climb(points: readonly TrackPoint[], thresholdM = 5): { ascentM: number; descentM: number } | null {
  const heights = points.map((point) => point[2]).filter((height): height is number => height !== undefined);
  if (heights.length < points.length * 0.8 || heights.length < 2) return null;
  let ascent = 0;
  let descent = 0;
  let anchor = heights[0]!;
  let peak = anchor;
  let direction = 0;
  const commit = () => {
    if (peak > anchor) ascent += peak - anchor;
    else descent += anchor - peak;
  };
  for (const height of heights) {
    if (direction === 0) {
      // Początek: czekamy, aż wysokość wyraźnie pójdzie w górę albo w dół.
      if (Math.abs(height - anchor) > Math.abs(peak - anchor)) peak = height;
      if (Math.abs(peak - anchor) >= thresholdM) direction = peak > anchor ? 1 : -1;
    } else if ((height - peak) * direction >= 0) {
      peak = height;
    } else if (Math.abs(height - peak) >= thresholdM) {
      commit();
      anchor = peak;
      peak = height;
      direction = -direction;
    }
  }
  commit();
  return { ascentM: Math.round(ascent), descentM: Math.round(descent) };
}

/** Czas przejścia (min, zaokrąglony do 5) wg DIN 33466. */
export function hikingMinutes(distanceKm: number, ascentM: number, descentM: number): number {
  const horizontal = distanceKm / 4;
  const vertical = ascentM / 300 + descentM / 500;
  const hours = Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2;
  return Math.max(5, Math.round((hours * 60) / 5) * 5);
}

export function trackStats(points: readonly TrackPoint[]): TrackStats {
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += distanceM(flat(points[i - 1]!), flat(points[i]!));
  const distanceKm = Math.round(meters / 100) / 10;
  const heights = climb(points);
  return { distanceKm, ascentM: heights?.ascentM ?? null, descentM: heights?.descentM ?? null, durationMin: hikingMinutes(distanceKm, heights?.ascentM ?? 0, heights?.descentM ?? 0) };
}

/** Odległość punktu od odcinka w metrach i położenie rzutu na odcinku (0…1), w rzucie płaskim wokół punktu. */
function project(point: LngLat, a: LngLat, b: LngLat): { offM: number; t: number } {
  const scale = Math.cos((point[1] * Math.PI) / 180);
  const M = 111_320;
  const ax = (a[0] - point[0]) * scale * M;
  const ay = (a[1] - point[1]) * M;
  const bx = (b[0] - point[0]) * scale * M;
  const by = (b[1] - point[1]) * M;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return { offM: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** Douglas–Peucker (metry); tolerancja rośnie, aż zostanie najwyżej `maxPoints` punktów. */
export function simplifyTrack(points: readonly TrackPoint[], maxPoints = 1500, toleranceM = 3): TrackPoint[] {
  const run = (tolerance: number) => {
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length > 0) {
      const [from, to] = stack.pop()!;
      let worst = -1;
      let index = -1;
      for (let i = from + 1; i < to; i++) {
        const { offM } = project(flat(points[i]!), flat(points[from]!), flat(points[to]!));
        if (offM > worst) {
          worst = offM;
          index = i;
        }
      }
      if (index !== -1 && worst > tolerance) {
        keep[index] = 1;
        stack.push([from, index], [index, to]);
      }
    }
    return points.filter((_, i) => keep[i] === 1);
  };
  let tolerance = toleranceM;
  let result = run(tolerance);
  while (result.length > maxPoints) {
    tolerance *= 2;
    result = run(tolerance);
  }
  // Zapis: ~1 m dokładności i pełne metry wysokości — mniej danych w planie i na telefonie.
  return result.map((point) => {
    const lng = Math.round(point[0] * 1e5) / 1e5;
    const lat = Math.round(point[1] * 1e5) / 1e5;
    return point[2] === undefined ? [lng, lat] : [lng, lat, Math.round(point[2])];
  });
}

/** GPX → linia do planu i statystyki (z pełnego śladu, przed uproszczeniem). */
export function trackFromGpx(xml: string): { name: string | null; line: TrackLine; stats: TrackStats } {
  const { name, points } = parseGpx(xml);
  return { name, line: { type: 'LineString', coordinates: simplifyTrack(points) }, stats: trackStats(points) };
}

export type TrackPosition = {
  /** Odległość od śladu (m). */
  offTrackM: number;
  doneKm: number;
  leftKm: number;
  /** Podejścia od tego miejsca do końca; `null` — ślad bez wysokości. */
  leftAscentM: number | null;
};

/** Gdzie jestem na śladzie: najbliższy odcinek, przebyte i pozostałe km, pozostałe podejścia. */
export function trackPosition(line: TrackLine, here: { lat: number; lng: number }): TrackPosition {
  const points = line.coordinates;
  const point: LngLat = [here.lng, here.lat];
  let best = { offM: Infinity, segment: 0, t: 0 };
  for (let i = 1; i < points.length; i++) {
    const { offM, t } = project(point, flat(points[i - 1]!), flat(points[i]!));
    if (offM < best.offM) best = { offM, segment: i - 1, t };
  }
  let done = 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distanceM(flat(points[i - 1]!), flat(points[i]!));
    total += length;
    if (i - 1 < best.segment) done += length;
    else if (i - 1 === best.segment) done += length * best.t;
  }
  const rest = points.slice(best.segment + 1);
  const heights = climb(rest);
  return {
    offTrackM: Math.round(best.offM),
    doneKm: Math.round(done / 100) / 10,
    leftKm: Math.round((total - done) / 100) / 10,
    leftAscentM: rest.length < 2 ? 0 : (heights?.ascentM ?? null),
  };
}
