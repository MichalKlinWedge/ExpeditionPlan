import { googleRouteVias, isGoogleDirections, isGoogleShortLink } from '@expeditionplan/core';

import type { LatLng } from './routing.ts';

/**
 * Punkty pośrednie z linku Google do trasy, który wkleił użytkownik (`leg.routeUrl`).
 * Skrócony link (`maps.app.goo.gl/…`) rozwijamy jednym zapytaniem bez przechodzenia na stronę:
 * czytamy tylko nagłówek `Location` przekierowania (docs/USLUGI.md §3 „Linki do tras”).
 * Niczego z Google nie zapisujemy — współrzędne z linku idą do openrouteservice.
 */

const UA = 'ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)';
/** Ile przekierowań w łańcuchu skróconego linku (zwykle jedno). */
const MAX_HOPS = 3;

/** Rozwinięty adres trasy w Mapach Google albo `null` (nie ten link, przekierowanie gdzie indziej, błąd). */
export async function resolveGoogleLink(url: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<string | null> {
  if (isGoogleDirections(url)) return url;
  if (!isGoogleShortLink(url)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) });
    } catch {
      return null;
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (location === null) return null;
    const next = new URL(location, current).toString();
    if (isGoogleDirections(next)) return next;
    if (!isGoogleShortLink(next)) return null;
    current = next;
  }
  return null;
}

export type LinkVias = { vias: LatLng[]; status: 'vias' | 'none' | 'not_google' | 'unresolved' };

/** Punkty pośrednie linku do trasy: `none` = link bez punktów pośrednich, `unresolved` = skróconego linku nie udało się rozwinąć. */
export async function googleLinkVias(url: string | undefined, options: Parameters<typeof resolveGoogleLink>[1] = {}): Promise<LinkVias> {
  if (url === undefined || (!isGoogleDirections(url) && !isGoogleShortLink(url))) return { vias: [], status: 'not_google' };
  const expanded = await resolveGoogleLink(url, options);
  if (expanded === null) return { vias: [], status: 'unresolved' };
  const vias = (googleRouteVias(expanded) ?? []).map(([lng, lat]) => ({ lat, lng }));
  return { vias, status: vias.length > 0 ? 'vias' : 'none' };
}
