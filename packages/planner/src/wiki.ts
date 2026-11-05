import { type AiClient, type AiUsage, askStructured } from '@expeditionplan/ai';
import { type GuideContent, GuideDraft, type GuideImage } from '@expeditionplan/core';
import { z } from 'zod';

import { SYSTEM } from './prompts.ts';

/**
 * Przewodnik po miejscu z Wikipedii albo Wikivoyage (SPECYFIKACJA M8): artykuł znaleziony po nazwie
 * i współrzędnych, a gdy to nie wystarcza — tytuły podpowiedziane przez AI, sprawdzone przez kod
 * (artykuł istnieje, nie jest ujednoznacznieniem, leży przy miejscu). Zdjęcia z Commons z licencją
 * i autorem, streszczenie przez AI wyłącznie z tekstu artykułu.
 * Wikimedia API: identyfikujący User-Agent, zapytania po kolei (bez równoległych serii).
 * Tekst artykułu: CC BY-SA 4.0 — opis pochodny ma tę licencję i link do artykułu.
 */

const UA = 'ExpeditionPlan/0.1 (https://github.com/MichalKlinWedge/ExpeditionPlan)';
const MAX_TEXT = 12_000;

const schemaOf = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));

export type WikiSite = 'wikipedia' | 'wikivoyage';
export type WikiArticle = { title: string; url: string; lang: string; site: WikiSite; text: string };
type Fetch = typeof fetch;

async function api(lang: string, params: Record<string, string>, fetchImpl: Fetch, site: WikiSite = 'wikipedia'): Promise<Record<string, unknown>> {
  const url = new URL(`https://${lang}.${site}.org/w/api.php`);
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: '2', ...params })) url.searchParams.set(key, value);
  const response = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${site} ${lang}: HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

type Page = { title: string; fullurl?: string; coordinates?: { lat: number; lon: number }[]; missing?: boolean; pageprops?: { disambiguation?: string } };

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
 * z większością słów nazwy w tytule („Twierdza Szybenik” nie dostanie artykułu o mieście). Strona ujednoznaczniająca
 * nigdy nie jest artykułem o miejscu. `query` zastępuje nazwę w wyszukiwaniu, tytuł dalej porównuje się z nazwą. `null` = nie ma pewnego dopasowania.
 */
export async function findArticle(name: string, at: { lat: number; lng: number } | null, lang: string, fetchImpl: Fetch = fetch, query = name): Promise<{ title: string; url: string } | null> {
  const found = await api(lang, { generator: 'search', gsrsearch: query, gsrlimit: '6', prop: 'coordinates|info|pageprops', inprop: 'url', ppprop: 'disambiguation' }, fetchImpl);
  const pages = (((found.query as { pages?: Page[] } | undefined)?.pages ?? []) as (Page & { index?: number })[]).filter((page) => page.pageprops?.disambiguation === undefined).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
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

export async function articleText(title: string, lang: string, fetchImpl: Fetch = fetch, site: WikiSite = 'wikipedia'): Promise<string> {
  const data = await api(lang, { prop: 'extracts', explaintext: '1', exsectionformat: 'plain', titles: title, redirects: '1' }, fetchImpl, site);
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
export async function articleImages(title: string, lang: string, limit = 4, fetchImpl: Fetch = fetch, site: WikiSite = 'wikipedia'): Promise<GuideImage[]> {
  const data = await api(
    lang,
    { generator: 'images', titles: title, gimlimit: '40', redirects: '1', prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '960', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ObjectName' },
    fetchImpl,
    site,
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

export function guidePrompt(place: { name: string; kind: string; hint?: string; which?: string }, article: WikiArticle): string {
  return [
    `Przygotuj krótki przewodnik po miejscu „${place.name}” (${place.kind}) dla rodziny zwiedzającej je podczas wyjazdu.`,
    ...(place.which ? [`Chodzi dokładnie o: „${place.which}”. Gdy artykuł wspomina inne miejsca o tej nazwie, pisz tylko o tym.`] : []),
    ...(place.hint
      ? [
          '',
          `Organizator chce się z opisu dowiedzieć przede wszystkim: „${place.hint}”. Skup się na tym w summary, facts i tips; resztę skróć.`,
          'Ceny, opłaty i sposób płatności podawaj tylko wtedy, gdy są w artykule (z jego zastrzeżeniami, np. „w 2020 r.”) — wbrew zasadzie 5. Czego artykuł nie mówi — pomiń, nie zgaduj.',
        ]
      : []),
    '',
    'Zasady:',
    '1. Korzystaj WYŁĄCZNIE z tekstu artykułu poniżej. Nie dodawaj faktów, dat ani liczb spoza niego. Gdy artykuł czegoś nie mówi — pomiń to.',
    '2. `summary`: 2–3 zdania, czym jest to miejsce i dlaczego warto je zobaczyć.',
    '3. `facts`: 3–8 ciekawostek, każda jednym zdaniem — zaskakujące, konkretne, takie, które chce się opowiedzieć na miejscu (także dzieciom).',
    '4. `history`: najważniejsze w historii miejsca, do 5 zdań; pomiń, gdy artykuł jej nie ma.',
    '5. `tips`: tylko wskazówki wynikające z artykułu (np. co obejrzeć w środku); bez godzin otwarcia i cen.',
    '6. Po polsku, prostym językiem, bez wstępów typu „Artykuł mówi”.',
    '',
    'JSON Schema odpowiedzi:',
    schemaOf(GuideDraft),
    '',
    `Artykuł „${article.title}” (${article.lang}.${article.site}.org):`,
    article.text,
  ].join('\n');
}

/** Co wiadomo o punkcie poza nazwą miejsca — dla podpowiedzi tytułów. */
export type PlaceQuery = {
  name: string;
  kind: string;
  lat?: number;
  lng?: number;
  /** Baza dnia — okolica dla miejsc bez współrzędnych. */
  near?: { lat: number; lng: number };
  context?: { itemTitle?: string; description?: string; area?: string; trip?: string };
  /** Wskazówka organizatora: o czym ma być opis („opłaty i bramki na A7”) — ma pierwszeństwo przed nazwą miejsca. */
  hint?: string;
  /** Które dokładnie miejsce, gdy wiele nosi tę nazwę („wieś w powiecie trzebnickim”); ma pierwszeństwo przed pinezką, która może stać u imienniczki. */
  which?: string;
};

const Suggestions = z.object({
  candidates: z
    .array(z.object({ site: z.enum(['wikipedia', 'wikivoyage']), lang: z.enum(['pl', 'en']), title: z.string().min(1) }))
    .max(6)
    .describe('istniejące artykuły, od najlepszego; pusto, gdy nie znasz żadnego'),
});

export function suggestPrompt(place: PlaceQuery): string {
  return [
    ...(place.hint
      ? [
          `Podaj tytuły ISTNIEJĄCYCH artykułów w Wikipedii albo Wikivoyage (polskich lub angielskich), które najlepiej odpowiadają na to, czego chce organizator: „${place.hint}” — w kontekście punktu planu poniżej.`,
          'Wskazówka ma pierwszeństwo przed nazwą miejsca (np. dla przejazdu autostradą — artykuł o tej autostradzie albo o jeździe autem w tym kraju, nie o parkingu na końcu). Może to być artykuł o drodze, regionie czy kraju, jeśli to on odpowiada na wskazówkę.',
        ]
      : [
          'Podaj tytuły ISTNIEJĄCYCH artykułów w Wikipedii albo Wikivoyage (polskich lub angielskich), które opisują to miejsce.',
          'Gdy samo miejsce nie ma artykułu, podaj artykuł o obiekcie, którego jest częścią (np. medyna dla suków, park narodowy dla szlaku w nim) — ale nie o całym mieście ani kraju.',
          ...(place.which ? [`Tę nazwę może nosić wiele miejsc. Organizator wskazał, o które chodzi: „${place.which}”. Podaj artykuły tylko o tym jednym.`] : []),
        ]),
    'Tytuł dokładnie tak, jak w Wikipedii/Wikivoyage. Nie zgaduj: kod sprawdzi, czy artykuł istnieje i leży przy miejscu, a zły tytuł tylko kosztuje. Gdy nie znasz żadnego — pusta lista.',
    '',
    'JSON Schema odpowiedzi (każdy kandydat to obiekt z `site`, `lang`, `title`):',
    schemaOf(Suggestions),
    '',
    'Miejsce:',
    JSON.stringify({ ...(place.hint ? { wskazowka: place.hint } : {}), ...(place.which ? { ktore_dokladnie: place.which } : {}), miejsce: place.name, rodzaj: place.kind, punkt: place.context?.itemTitle, opis: place.context?.description?.slice(0, 400), okolica: place.context?.area, wyjazd: place.context?.trip }),
  ].join('\n');
}

/**
 * Sprawdzenie podpowiedzi: artykuł istnieje, nie jest ujednoznacznieniem i ma współrzędne w promieniu
 * od miejsca (3 km) albo od bazy dnia (25 km). Bez punktu odniesienia — tylko przy pasującym tytule.
 * Ze wskazówką organizatora temat wskazał człowiek, a źródło widać przy opisie: wystarczy artykuł bez
 * współrzędnych (droga, „jazda autem w Maroku”) albo w promieniu 300 km (ten sam region). Tak samo po wskazaniu,
 * które to miejsce: pinezka może stać u imienniczki.
 */
export async function checkSuggestion(
  candidate: { site: WikiSite; lang: string; title: string },
  place: PlaceQuery,
  fetchImpl: Fetch = fetch,
): Promise<{ title: string; url: string } | null> {
  const data = await api(candidate.lang, { titles: candidate.title, redirects: '1', prop: 'coordinates|info|pageprops', inprop: 'url', ppprop: 'disambiguation' }, fetchImpl, candidate.site);
  const page = ((data.query as { pages?: Page[] } | undefined)?.pages ?? [])[0];
  if (page === undefined || page.missing || page.pageprops?.disambiguation !== undefined || !page.fullurl) return null;
  const where = page.coordinates?.[0];
  const exact = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : null;
  const origin = exact ?? place.near ?? null;
  if (place.hint || place.which) return where === undefined || origin === null || km(origin, where) <= 300 ? { title: page.title, url: page.fullurl } : null;
  if (origin === null) return titleMatch(place.name, page.title) >= 0.75 ? { title: page.title, url: page.fullurl } : null;
  if (where === undefined || km(origin, where) > (exact ? 3 : 25)) return null;
  return { title: page.title, url: page.fullurl };
}

export type GuideDeps = { client: AiClient; timeoutMs?: number; onUsage?: (usage: AiUsage) => void; fetchImpl?: Fetch };

/**
 * Przewodnik po miejscu: artykuł w polskiej Wikipedii, potem w angielskiej; gdy żaden nie pasuje —
 * tytuły podpowiedziane przez AI (Wikipedia i Wikivoyage), każdy sprawdzony przez `checkSuggestion`.
 * Ze wskazówką organizatora (`hint`) od razu podpowiedzi AI — nazwa miejsca może prowadzić gdzie indziej.
 * Ze wskazaniem miejsca (`which`) wyszukiwanie po nazwie i tym tekście, bez pinezki; zostaje ono w `hint` opisu do odświeżenia.
 * Opis zawsze po polsku. `null` = brak artykułu, którego dopasowanie jest pewne.
 */
export async function describePlace(place: PlaceQuery, deps: GuideDeps): Promise<GuideContent | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ai = { system: SYSTEM, timeoutMs: deps.timeoutMs ?? 60_000, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}) };
  const at = place.lat !== undefined && place.lng !== undefined ? { lat: place.lat, lng: place.lng } : (place.near ?? null);
  let article: WikiArticle | null = null;
  for (const lang of place.hint ? [] : ['pl', 'en']) {
    const found = await findArticle(place.name, place.which ? null : at, lang, fetchImpl, place.which ? `${place.name} ${place.which}` : place.name);
    if (found === null) continue;
    const text = await articleText(found.title, lang, fetchImpl);
    if (text.length < 300) continue;
    article = { ...found, lang, site: 'wikipedia', text };
    break;
  }
  if (article === null) {
    // Nieudana podpowiedź (zła odpowiedź modelu) = brak kandydatów, nie błąd całego opisu.
    const suggested = await askStructured(deps.client, Suggestions, suggestPrompt(place), { ...ai, maxTokens: 600, label: `artykuły ${place.name}` }).catch(() => null);
    for (const candidate of suggested?.data.candidates ?? []) {
      const found = await checkSuggestion(candidate, place, fetchImpl).catch(() => null);
      if (found === null) continue;
      const text = await articleText(found.title, candidate.lang, fetchImpl, candidate.site);
      if (text.length < 300) continue;
      article = { ...found, lang: candidate.lang, site: candidate.site, text };
      break;
    }
  }
  if (article === null) return null;
  const answer = await askStructured(deps.client, GuideDraft, guidePrompt(place, article), { ...ai, maxTokens: 3000, label: `przewodnik ${place.name}` });
  const images = await articleImages(article.title, article.lang, 4, fetchImpl, article.site).catch(() => []);
  return { ...answer.data, images, article: { title: article.title, url: article.url, lang: article.lang, site: article.site }, ...(place.hint || place.which ? { hint: place.hint ?? place.which } : {}) };
}
