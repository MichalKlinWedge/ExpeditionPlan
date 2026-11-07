import type { LngLat } from './polyline.ts';

/**
 * Punkty pośrednie z linku do trasy w Mapach Google, który wkleił użytkownik (`leg.routeUrl`).
 * Z linku bierzemy tylko współrzędne, które użytkownik sam wskazał (przystanki i przeciągnięte
 * punkty trasy); drogę między nimi liczy openrouteservice, z Google niczego nie zapisujemy
 * (docs/USLUGI.md §3 „Linki do tras”). Format `api=1` jest udokumentowany (Maps URLs), adres
 * `/maps/dir/…/data=…` po rozwinięciu skróconego linku — nie, więc czytamy go ostrożnie: tylko
 * współrzędne, a niezrozumiały kawałek po prostu pomijamy.
 */

const GOOGLE_HOST = /^(www\.)?google\.[a-z.]+$/i;
/** Skrócone linki Map Google; rozwija je serwer (`resolveGoogleLink` w packages/planner). */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
/** Najwięcej punktów pośrednich (Maps URLs: 9; openrouteservice przyjmuje więcej). */
const MAX_VIAS = 9;

const parse = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed : null;
  } catch {
    return null;
  }
};

/** Skrócony link Map Google (`maps.app.goo.gl/…`, `goo.gl/maps/…`) — trzeba go rozwinąć, żeby zobaczyć punkty. */
export function isGoogleShortLink(url: string): boolean {
  const parsed = parse(url);
  if (parsed === null || !SHORT_HOSTS.has(parsed.hostname.toLowerCase())) return false;
  return parsed.hostname.toLowerCase() === 'maps.app.goo.gl' || parsed.pathname.startsWith('/maps/');
}

/** Link do trasy w Mapach Google (rozwinięty). */
export function isGoogleDirections(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && GOOGLE_HOST.test(parsed.hostname) && parsed.pathname.startsWith('/maps/dir');
}

/** „42.17835,42.49101” → [lng, lat]; nazwa miejsca → `null`. */
function latLng(text: string): LngLat | null {
  const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(decodeURIComponent(text.replace(/\+/g, ' ')));
  if (match === null) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}

/**
 * Punkty pośrednie trasy z linku Google, po kolei, bez startu i celu (te są w „skąd” i „dokąd”).
 * `null` = to nie jest link do trasy w Mapach Google (albo jest skrócony — najpierw rozwinąć).
 * Pusta lista = trasa bez punktów pośrednich. Przystanek podany nazwą (nie współrzędnymi) pomijamy.
 */
export function googleRouteVias(url: string): LngLat[] | null {
  const parsed = parse(url);
  if (parsed === null || !isGoogleDirections(url)) return null;
  // Udokumentowane: /maps/dir/?api=1&origin=…&destination=…&waypoints=a|b
  if (parsed.searchParams.get('api') === '1') {
    const waypoints = parsed.searchParams.get('waypoints');
    return (waypoints ?? '')
      .split('|')
      .map(latLng)
      .filter((point): point is LngLat => point !== null)
      .slice(0, MAX_VIAS);
  }
  // Rozwinięty link z aplikacji: /maps/dir/<start>/<przystanek>/…/<cel>/@<widok>/data=<…>
  const segments = parsed.pathname.split('/').slice(3);
  const stops: string[] = [];
  let data = '';
  for (const segment of segments) {
    if (segment.startsWith('@')) continue;
    if (segment.startsWith('data=')) {
      data = decodeURIComponent(segment.slice(5));
      continue;
    }
    if (segment !== '') stops.push(segment);
  }
  const vias: LngLat[] = [];
  // Przystanki między startem a celem, gdy są współrzędnymi.
  for (const stop of stops.slice(1, -1)) {
    const point = latLng(stop);
    if (point !== null) vias.push(point);
  }
  // Przeciągnięte punkty trasy: w `data` jako `!3m<n>!1m2!1d<lng>!2d<lat>` przy odcinku (start i cel to `!2m2!1d…`).
  for (const match of data.matchAll(/!3m\d+!1m2!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)) {
    const lng = Number(match[1]);
    const lat = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) vias.push([lng, lat]);
  }
  return vias.slice(0, MAX_VIAS);
}
