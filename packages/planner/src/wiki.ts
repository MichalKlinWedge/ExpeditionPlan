import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import { type GuideContent, GuideDraft, type GuideImage } from '@expeditionplan/core';

import { SYSTEM } from './prompts.ts';

/**
 * Przewodnik po miejscu z Wikipedii (SPECYFIKACJA M8): artykuł znaleziony po nazwie i współrzędnych,
 * zdjęcia z Commons z licencją i autorem, streszczenie przez AI wyłącznie z tekstu artykułu.
 * Wikimedia API: identyfikujący User-Agent, zapytania po kolei (bez równoległych serii).
 * Tekst artykułu: CC BY-SA 4.0 — opis pochodny ma tę licencję i link do artykułu.
 */

const UA = 'ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)';
const MAX_TEXT = 12_000;

export type WikiArticle = { title: string; url: string; lang: string; text: string };
type Fetch = typeof fetch;

async function api(lang: string, params: Record<string, string>, fetchImpl: Fetch): Promise<Record<string, unknown>> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value);
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Wikipedia ${lang}: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

type Page = { title: string; fullurl?: string; coordinates?: { lat: number; lon: number }[]; missing?: boolean };

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

/** Odległość edycyjna ≤ 1 (literówka, inna transkrypcja: „Fna” / „Fana”). */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const tail = (x: string, skip: number) => x.slice(i + skip);
  return tail(a, 1) === tail(b, 1) || tail(a, 1) === tail(b, 0) || tail(a, 0) === tail(b, 1);
}

/** Ile słów nazwy jest w tytule (0–1), z tolerancją jednej litery. */
export function titleMatch(name: string, title: string): number {
  const wanted = words(name);
  if (wanted.length === 0) return 0;
  const have = words(title);
  return wanted.filter((word) => have.some((each) => nearlySame(word, each))).length / wanted.length;
}

function km(a: { lat: number; lng: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * Artykuł o miejscu: wyszukiwanie po nazwie (przy współrzędnych — tylko hasła w promieniu 15 km
 * albo bez współrzędnych, ale z pasującym tytułem), a gdy nic — najbliższe hasło w promieniu 1 km
 * z większością słów nazwy w tytule („Twierdza Szybenik” nie dostanie artykułu o mieście). `null` = nie ma pewnego dopasowania.
 */
export async function findArticle(name: string, at: { lat: number; lng: number } | null, lang: string, fetchImpl: Fetch = fetch): Promise<{ title: string; url: string } | null> {
  const found = await api(lang, { generator: 'search', gsrsearch: name, gsrlimit: '6', prop: 'coordinates|info', inprop: 'url' }, fetchImpl);
  const pages = (((found.query as { pages?: Page[] } | undefined)?.pages ?? []) as (Page & { index?: number })[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const near = pages.find((page) => {
    const where = page.coordinates?.[0];
    if (at !== null && where !== undefined) return km(at, where) <= 15 && titleMatch(name, page.title) >= 0.6;
    return titleMatch(name, page.title) >= 0.75;
  });
  if (near?.fullurl) return { title: near.title, url: near.fullurl };
  if (at === null) return null;
  const geo = await api(lang, { generator: 'geosearch', ggscoord: `${at.lat}|${at.lng}`, ggsradius: '1000', ggslimit: '10', prop: 'info', inprop: 'url' }, fetchImpl);
  const close = ((geo.query as { pages?: Page[] } | undefined)?.pages ?? []).filter((page) => titleMatch(name, page.title) >= 0.6).sort((a, b) => titleMatch(name, b.title) - titleMatch(name, a.title))[0];
  return close?.fullurl ? { title: close.title, url: close.fullurl } : null;
}

export async function articleText(title: string, lang: string, fetchImpl: Fetch = fetch): Promise<string> {
  const data = await api(lang, { prop: 'extracts', explaintext: '1', exsectionformat: 'plain', titles: title, redirects: '1' }, fetchImpl);
  const page = ((data.query as { pages?: { extract?: string }[] } | undefined)?.pages ?? [])[0];
  return (page?.extract ?? '').slice(0, MAX_TEXT);
}

const SKIP_IMAGE = /flag|logo|icon|ikona|herb|coat_of_arms|locator|location|map|mapa|plan|diagram|signature|podpis|commons-logo|wiki/i;
const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

type ImagePage = { title: string; imageinfo?: { url: string; thumburl?: string; descriptionurl: string; mime: string; width: number; extmetadata?: Record<string, { value: string } | undefined> }[] };

/** Zdjęcia z artykułu (pliki Commons): JPEG/PNG, bez flag, map i herbów, z licencją i autorem. */
export async function articleImages(title: string, lang: string, limit = 4, fetchImpl: Fetch = fetch): Promise<GuideImage[]> {
  const data = await api(
    lang,
    { generator: 'images', titles: title, gimlimit: '40', redirects: '1', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName' },
    fetchImpl,
  );
  const pages = ((data.query as { pages?: ImagePage[] } | undefined)?.pages ?? []).filter((page) => !SKIP_IMAGE.test(page.title));
  const images: GuideImage[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (info === undefined || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 500) continue;
    const meta = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value;
    // Bez licencji w metadanych nie pokazujemy (nie wiadomo, jak podpisać).
    const name = stripHtml(meta.ObjectName?.value ?? page.title.replace(/^(File|Plik):/, '').replace(/\.[a-z]+$/i, ''));
    if (!license || images.some((each) => each.url === info.url || each.title === name)) continue;
    images.push({
      url: info.url,
      thumbUrl: info.thumburl ?? info.url,
      title: name,
      author: meta.Artist?.value ? stripHtml(meta.Artist.value).slice(0, 120) : undefined,
      license,
      licenseUrl: meta.LicenseUrl?.value?.startsWith('http') ? meta.LicenseUrl.value : undefined,
      sourceUrl: info.descriptionurl,
    });
    if (images.length >= limit) break;
  }
  return images;
}

export function guidePrompt(place: { name: string; kind: string; country?: string }, article: WikiArticle): string {
  return [
    `Przygotuj krótki przewodnik po miejscu „${place.name}” (${place.kind}) dla rodziny zwiedzającej je podczas wyjazdu.`,
    '',
    'Zasady:',
    '1. Korzystaj WYŁĄCZNIE z tekstu artykułu poniżej. Nie dodawaj faktów, dat ani liczb spoza niego. Gdy artykuł czegoś nie mówi — pomiń to.',
    '2. `summary`: 2–3 zdania, czym jest to miejsce i dlaczego warto je zobaczyć.',
    '3. `facts`: 3–8 ciekawostek, każda jednym zdaniem — zaskakujące, konkretne, takie, które chce się opowiedzieć na miejscu (także dzieciom).',
    '4. `history`: najważniejsze w historii miejsca, do 5 zdań; pomiń, gdy artykuł jej nie ma.',
    '5. `tips`: tylko wskazówki wynikające z artykułu (np. co obejrzeć w środku); bez godzin otwarcia i cen.',
    '6. Po polsku, prostym językiem, bez wstępów typu „Artykuł mówi”.',
    '',
    `Artykuł „${article.title}” (${article.lang}.wikipedia.org):`,
    article.text,
  ].join('\n');
}

export type GuideDeps = { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void; fetchImpl?: Fetch };

/**
 * Przewodnik po miejscu: artykuł w polskiej Wikipedii, a gdy go nie ma — w angielskiej (opis i tak
 * po polsku). `null` = brak artykułu, którego dopasowanie jest pewne (lepiej nic niż zmyślenia).
 */
export async function describePlace(place: { name: string; kind: string; lat?: number; lng?: number }, deps: GuideDeps): Promise<GuideContent | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const at = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : null;
  let article: WikiArticle | null = null;
  for (const lang of ['pl', 'en']) {
    const found = await findArticle(place.name, at, lang, fetchImpl);
    if (found === null) continue;
    const text = await articleText(found.title, lang, fetchImpl);
    if (text.length < 300) continue;
    article = { ...found, lang, text };
    break;
  }
  if (article === null) return null;
  const answer = await askStructured(deps.client, GuideDraft, guidePrompt(place, article), {
    system: SYSTEM,
    maxTokens: 3000,
    timeoutMs: deps.timeoutMs ?? 60_000,
    label: `przewodnik ${place.name}`,
    ...(deps.onUsage ? { onUsage: deps.onUsage } : {}),
  });
  const images = await articleImages(article.title, article.lang, 4, fetchImpl).catch(() => []);
  return { ...answer.data, images, article: { title: article.title, url: article.url, lang: article.lang } };
}
