/**
 * Z nazwy miejsca w planie — zapytania do geokodera. Plany mają nazwy po polsku, z dopiskami
 * („Szybenik (Šibenik)”, „Sixt — biuro w terminalu”, „Dinara (1831 m n.p.m.)”), więc próbujemy
 * kilku wersji od najdokładniejszej. Miejsca prywatne i niejednoznaczne pomijamy z powodem.
 */

export type PlaceInput = {
  ref: string;
  name: string;
  /** Nazwa lokalna/angielska do wyszukania (z importu AI), próbowana jako pierwsza. */
  searchName?: string | undefined;
  category?: string | undefined;
  address?: string | undefined;
};

/** Nocleg u znajomych, „kwatera w okolicy”, lokal kolegi — nie szukamy po adresach prywatnych. */
const PRIVATE = /^(nocleg|kwatera|lokal|zakup)\b/i;
/** „La Rambla albo Portal de l’Àngel” — dwa miejsca w jednym; którego szukać, rozstrzyga plan, nie geokoder. */
const AMBIGUOUS = /\balbo\b/i;

export function skipReason(place: PlaceInput): string | null {
  if (PRIVATE.test(place.name)) return 'prywatne albo opisowe';
  if (AMBIGUOUS.test(place.name)) return 'dwa miejsca w jednej nazwie';
  return null;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

export function candidateQueries(place: PlaceInput, aliases: string[] = []): string[] {
  const name = place.name;
  const inParens = [...name.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]!);
  const withoutParens = clean(name.replace(/\([^)]*\)/g, ''));
  const beforeDash = clean(withoutParens.split(/\s[—–-]\s/)[0]!);
  // Dopiski z wysokością, numerem skrzynki, linią metra itd. to nie są nazwy miejsc.
  const nameLike = inParens.filter((text) => !/\d|metro|n\.p\.m|rafting|ostatni|unesco/i.test(text)).map(clean);

  const hints = place.searchName === undefined ? aliases : [place.searchName, ...aliases];
  const queries = [...hints, clean(name), withoutParens, beforeDash, ...nameLike];
  if (place.address !== undefined) {
    queries.push(`${beforeDash}, ${place.address}`);
    for (const alias of nameLike) queries.push(`${alias}, ${place.address}`);
  }
  return [...new Set(queries.filter((query) => query.length > 2))];
}

/** Odległość po kole wielkim w km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Środek obszaru wyjazdu: mediana współrzędnych, odporna na pojedyncze pomyłki geokodera. */
export function medianPoint(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return { lat: median(points.map((point) => point.lat)), lng: median(points.map((point) => point.lng)) };
}

/** Prostokąt wokół punktu o „promieniu” `km`. */
export function boxAround(center: { lat: number; lng: number }, km: number) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((center.lat * Math.PI) / 180));
  return { south: center.lat - dLat, north: center.lat + dLat, west: center.lng - dLng, east: center.lng + dLng };
}

/** Miejsca, które same są miejscowością albo obszarem — dla nich trafienie w miejscowość jest dokładne. */
const AREA_LIKE = new Set([
  'city', 'town', 'village', 'resort', 'district', 'neighbourhood', 'quarter', 'area', 'old_town', 'square', 'beach', 'hill',
  'national_park', 'river', 'valley', 'dunes', 'desert', 'island', 'ksar',
]);

/**
 * Trafienie zbyt ogólne: hotel z dopiskiem „(Ureki)” znaleziony jako miejscowość Ureki. Takich
 * współrzędnych nie zapisujemy — wyglądałyby na dokładne.
 */
export function tooCoarse(placeCategory: string | undefined, hitCategory: string): boolean {
  return (hitCategory === 'place' || hitCategory === 'boundary') && !AREA_LIKE.has(placeCategory ?? '');
}

/** Miasto, lotnisko — punkt startu albo powrotu może leżeć daleko od obszaru wyjazdu. */
export const FAR_OK = new Set(['airport', 'city', 'town']);
