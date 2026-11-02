/**
 * Linia trasy przejazdu w dokumencie: zakodowana polilinia (format Google, precyzja 5 — ten sam,
 * który zwraca OpenRouteService). Kilkaset punktów zamiast kilkunastu kilobajtów tablicy liczb
 * w każdym `pull_changes`. Punkty w kolejności GeoJSON / MapLibre: [lng, lat].
 */

export type LngLat = [lng: number, lat: number];

const FACTOR = 1e5;

function encodeValue(value: number): string {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (rest >= 0x20) {
    out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  return out + String.fromCharCode(rest + 63);
}

/** [[lng, lat], …] → „_p~iF~ps|U…” (w zapisie najpierw szerokość, jak w formacie Google). */
export function encodePolyline(points: readonly LngLat[]): string {
  let lat = 0;
  let lng = 0;
  let out = '';
  for (const [x, y] of points) {
    const nextLat = Math.round(y * FACTOR);
    const nextLng = Math.round(x * FACTOR);
    out += encodeValue(nextLat - lat) + encodeValue(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
  }
  return out;
}

/** Odwrotność `encodePolyline`; uszkodzony napis daje punkty do miejsca uszkodzenia. */
export function decodePolyline(encoded: string): LngLat[] {
  const points: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | undefined => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) return undefined;
      const byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === undefined || dLng === undefined) break;
    lat += dLat;
    lng += dLng;
    points.push([lng / FACTOR, lat / FACTOR]);
  }
  return points;
}

const EARTH_M = 6_371_000;
const RAD = Math.PI / 180;

/** Odległość po kuli w metrach. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Odległość punktu od odcinka w metrach (rzut płaski wokół punktu — wystarcza na kilometry). */
function offsetM(point: LngLat, a: LngLat, b: LngLat): number {
  const scale = Math.cos(point[1] * RAD);
  const ax = (a[0] - point[0]) * scale;
  const ay = a[1] - point[1];
  const bx = (b[0] - point[0]) * scale;
  const by = b[1] - point[1];
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + t * dx, ay + t * dy) * RAD * EARTH_M;
}

/**
 * Douglas–Peucker: zostają punkty, bez których linia odjechałaby o więcej niż `toleranceM`.
 * Pierwszy i ostatni punkt zostają zawsze.
 */
export function simplifyPath(points: readonly LngLat[], toleranceM: number): LngLat[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let worstM = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const offset = offsetM(points[i]!, points[first]!, points[last]!);
      if (offset > worstM) {
        worst = i;
        worstM = offset;
      }
    }
    if (worst === -1) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }
  return points.filter((_, i) => keep[i] === 1);
}
