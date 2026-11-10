import { type Eatery, type EateryKind, type EateryTip, metersBetween, plainName, type EateryPriceTier } from '@expeditionplan/core';

import { queryHost } from './wiki.ts';

/**
 * Polecenia knajp z Wikivoyage (angielskiej): artykuły miast i dzielnic w pobliżu (`list=geosearch`), a w nich
 * wpisy `{{eat …}}` / `{{drink …}}` z sekcji „Eat” i „Drink”. Przedział cen bierzemy z nagłówka podsekcji
 * („Budget”, „Mid-range”, „Splurge”). To nie jest średnia ocen, tylko lista wybrana przez autorów przewodnika:
 * znaczek „polecane” przy wyniku z Geoapify (ta sama nazwa, blisko), a wpis bez odpowiednika w OSM staje się
 * osobnym wynikiem. Tekst wpisów to CC BY-SA 4.0: pokazujemy go w wynikach z linkiem do artykułu i licencją,
 * a do planu trafia tylko link (`eateryPlace`). Zapytania do Wikimedia po kolei, z User-Agentem (`queryHost`).
 */

type Fetch = typeof fetch;

const HOST = 'en.wikivoyage.org';
const MAX_ARTICLES = 8;
const MAX_TEXT = 220;

export type WikivoyageListing = {
  name: string;
  kind: 'eat' | 'drink';
  lat?: number;
  lng?: number;
  address?: string;
  url?: string;
  phone?: string;
  tip: EateryTip;
};

export const articleUrl = (title: string) => `https://${HOST}/wiki/${encodeURI(title.replaceAll(' ', '_'))}`;

const TIERS: [RegExp, EateryPriceTier][] = [
  [/^(budget|cheap|inexpensive)/i, 'budget'],
  [/^(mid|moderate)/i, 'mid'],
  [/^(splurge|expensive|upscale|high[- ]end|fine dining)/i, 'splurge'],
];

/** Koniec szablonu zaczynającego się w `start` (`{{`), z zagnieżdżonymi; -1 = niedomknięty. */
function templateEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++;
      i++;
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Podział wnętrza szablonu po `|` na najwyższym poziomie (bez `|` w `{{…}}` i `[[…]]`). */
function splitParams(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const pair = inner.slice(i, i + 2);
    if (pair === '{{' || pair === '[[') {
      depth++;
      current += pair;
      i++;
    } else if ((pair === '}}' || pair === ']]') && depth > 0) {
      depth--;
      current += pair;
      i++;
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += inner[i];
  }
  parts.push(current);
  return parts;
}

/** Tekst bez znaczników wiki: linki → ich tekst, szablony i HTML precz. */
export function plainWikitext(value: string): string {
  let text = value;
  // Zagnieżdżone szablony ({{rint…}}, {{station…}}) — od najgłębszych.
  for (let guard = 0; guard < 10 && /\{\{[^{}]*\}\}/.test(text); guard++) text = text.replace(/\{\{[^{}]*\}\}/g, '');
  return text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const shorten = (text: string) => {
  if (text.length <= MAX_TEXT) return text;
  const cut = text.slice(0, MAX_TEXT);
  const sentence = cut.lastIndexOf('. ');
  return sentence > 80 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

const number = (value: string | undefined) => {
  const parsed = Number(value?.trim());
  return value !== undefined && value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
};

/** Wpisy `{{eat}}` / `{{drink}}` (też `{{listing | type=eat}}`) z tekstu artykułu. */
export function parseListings(wikitext: string, article: string): WikivoyageListing[] {
  const headings = [...wikitext.matchAll(/^(={2,4})\s*([^=\n]+?)\s*\1\s*$/gm)].map((match) => ({ at: match.index, level: match[1]!.length, title: match[2]! }));
  const url = articleUrl(article);
  const listings: WikivoyageListing[] = [];
  for (let start = wikitext.indexOf('{{'); start !== -1; start = wikitext.indexOf('{{', start + 2)) {
    const end = templateEnd(wikitext, start);
    if (end === -1) break;
    const [head = '', ...rest] = splitParams(wikitext.slice(start + 2, end - 2));
    const params = new Map<string, string>();
    for (const part of rest) {
      const eq = part.indexOf('=');
      if (eq > 0) params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }
    const template = head.trim().toLowerCase();
    const kind = template === 'eat' || template === 'drink' ? template : (template === 'listing' || template === 'marker') && /^(eat|drink)$/i.test(params.get('type') ?? '') ? (params.get('type')!.toLowerCase() as 'eat' | 'drink') : undefined;
    if (kind === undefined) continue;
    start = end - 2;
    const name = plainWikitext(params.get('name') ?? '');
    if (name === '') continue;
    // Przedział cen: ostatni nagłówek 3. poziomu po ostatnim 2. poziomu przed wpisem.
    const before = headings.filter((heading) => heading.at < start);
    const section = [...before].reverse().find((heading) => heading.level === 2);
    const sub = [...before].reverse().find((heading) => heading.level === 3 && (section === undefined || heading.at > section.at));
    const tier = sub === undefined ? undefined : TIERS.find(([pattern]) => pattern.test(sub.title))?.[1];
    const lat = number(params.get('lat'));
    const lng = number(params.get('long') ?? params.get('lng'));
    const text = shorten(plainWikitext(params.get('content') ?? params.get('description') ?? ''));
    const price = plainWikitext(params.get('price') ?? '');
    const year = Number(/^(\d{4})-/.exec(params.get('lastedit') ?? '')?.[1]);
    const address = plainWikitext(params.get('address') ?? '');
    const site = (params.get('url') ?? '').trim();
    const phone = plainWikitext(params.get('phone') ?? '');
    listings.push({
      name,
      kind,
      ...(lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : {}),
      ...(address ? { address } : {}),
      ...(/^https?:\/\//i.test(site) ? { url: site } : {}),
      ...(phone ? { phone } : {}),
      tip: { source: 'wikivoyage', article, url, ...(tier ? { tier } : {}), ...(price ? { price: price.slice(0, 80) } : {}), ...(text ? { text } : {}), ...(year > 2000 ? { year } : {}) },
    });
  }
  return listings;
}

/** Artykuły (tekst) trzymamy w pamięci serwera pół dnia: te same dzielnice przy kolejnych posiłkach. */
const cache = new Map<string, { at: number; listings: WikivoyageListing[] }>();
const TTL_MS = 12 * 3_600_000;

type Area = { lat: number; lng: number; radiusM: number };

/** Wpisy z artykułów Wikivoyage wokół obszaru (te ze współrzędnymi tylko w obszarze, z zapasem 300 m). */
export async function wikivoyageListings(area: Area, fetchImpl: Fetch = fetch, now = Date.now()): Promise<WikivoyageListing[]> {
  const near = await queryHost(HOST, { list: 'geosearch', gscoord: `${area.lat}|${area.lng}`, gsradius: String(Math.min(10_000, Math.round(area.radiusM + 5000))), gslimit: String(MAX_ARTICLES) }, fetchImpl);
  const titles = ((near.query as { geosearch?: { title: string }[] } | undefined)?.geosearch ?? []).map((page) => page.title);
  const missing = titles.filter((title) => {
    const cached = cache.get(title);
    return cached === undefined || cached.at < now - TTL_MS;
  });
  if (missing.length > 0) {
    const body = await queryHost(HOST, { prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: missing.join('|') }, fetchImpl);
    const pages = (body.query as { pages?: { title: string; revisions?: { slots?: { main?: { content?: string } } }[] }[] } | undefined)?.pages ?? [];
    for (const page of pages) cache.set(page.title, { at: now, listings: parseListings(page.revisions?.[0]?.slots?.main?.content ?? '', page.title) });
    if (cache.size > 300) for (const key of [...cache.keys()].slice(0, cache.size - 300)) cache.delete(key);
  }
  return titles.flatMap((title) => cache.get(title)?.listings ?? []).filter((listing) => listing.lat === undefined || listing.lng === undefined || metersBetween(area, { lat: listing.lat, lng: listing.lng! }) <= area.radiusM + 300);
}

const located = (listing: WikivoyageListing): listing is WikivoyageListing & { lat: number; lng: number } => listing.lat !== undefined && listing.lng !== undefined;

/** Ta sama knajpa: ta sama nazwa najwyżej 200 m dalej albo nazwa zawierająca drugą (≥ 5 znaków) najwyżej 100 m dalej; wpis bez współrzędnych — tylko ta sama nazwa. */
function sameVenue(eatery: Eatery, listing: WikivoyageListing): boolean {
  const a = plainName(eatery.name);
  const b = plainName(listing.name);
  if (a === '' || b === '') return false;
  if (!located(listing)) return a === b;
  const distance = metersBetween(eatery, listing);
  if (a === b) return distance <= 200;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 5 && ` ${long} `.includes(` ${short} `) && distance <= 100;
}

const fitsKinds = (listing: WikivoyageListing, kinds: readonly EateryKind[]) =>
  kinds.length === 0 || (listing.kind === 'eat' ? kinds.includes('restaurant') || kinds.includes('fast_food') : kinds.includes('pub') || kinds.includes('cafe'));

/**
 * Polecenia do wyników: knajpa z Geoapify dostaje `tip` pasującego wpisu, a wpis ze współrzędnymi bez
 * odpowiednika (i pasujący do rodzajów) dochodzi jako osobna knajpa — chyba że szukamy z filtrem diety,
 * którego wpis nie potwierdza. Zwraca też artykuły, z których coś wzięto.
 */
export function withTips(found: readonly Eatery[], listings: readonly WikivoyageListing[], kinds: readonly EateryKind[], dietFilter: boolean): { eateries: Eatery[]; sources: { title: string; url: string }[] } {
  const eateries = found.map((eatery) => ({ ...eatery }));
  const used = new Map<string, string>();
  for (const listing of listings) {
    const match = eateries.find((eatery) => eatery.tip === undefined && sameVenue(eatery, listing));
    if (match !== undefined) {
      match.tip = listing.tip;
      used.set(listing.tip.article, listing.tip.url);
    } else if (located(listing) && !dietFilter && fitsKinds(listing, kinds) && !eateries.some((eatery) => sameVenue(eatery, listing))) {
      eateries.push({
        name: listing.name,
        lat: listing.lat,
        lng: listing.lng,
        kind: listing.kind === 'eat' ? 'restaurant' : 'pub',
        ...(listing.address ? { address: listing.address } : {}),
        ...(listing.url ? { website: listing.url } : {}),
        ...(listing.phone ? { phone: listing.phone } : {}),
        tip: listing.tip,
      });
      used.set(listing.tip.article, listing.tip.url);
    }
  }
  return { eateries, sources: [...used].map(([title, url]) => ({ title, url })) };
}
